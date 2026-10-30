"""
Form <-> visual-editor binding.

A website can be edited two ways: the Super App's form (`values`) and the
/admin visual editor (`editor_content`, stored page HTML). Before this module
the first visual save froze the page — form answers and merchant-Profile
changes stopped reaching it until "Rebuild from form" threw the visual edits
away. Now both editors work on the same data:

* The site template tags every element it renders from a form answer when it
  builds the editor's starting snapshot (nextjs-site, snapshot mode):

      data-bind="hero.headline"            element text  <-> values path
      data-bind-href="hero.ctaLink"        href          <-> values path
      data-bind-href-fmt="tel"|"mailto"    href is derived (tel:/mailto:) from the path
      data-bind-src="about.image"          img src       <-> values path
      data-bind-list="offerings.items"     container of a repeating list
      data-bind-item                       one row of that list; paths inside it
                                           start with "." (".name" -> items[i].name)

* On every READ of the edited pages (`fill`): an element whose answer changed
  since it was last filled gets the new answer; everything else — layout,
  styles, text added only in the visual editor — is left exactly as it is.
  Lists grow / shrink to match the form (new rows copy the look of the last row).

* On every visual SAVE (`extract`): an element whose text / link / image the
  user changed in the editor is written back into `values`, so the form shows
  it too. Rows deleted, duplicated or reordered in the editor update the list.

* Fields the merchant Profile owns (a linked site's name, phone, email,
  address, city, hours) are marked `data-bind-profile`. They are edited like
  any other field; the caller (editor.py) saves those edits to the merchant
  Profile instead of the site's answers — PRD C-08: editing hours / business
  info on the website writes back to the Profile.

Change detection uses two short hashes stamped on each bound element:
`…-v` = the answer it was last filled from, `…-t` = what it rendered. Form
changed  <=> answer hash != -v.  Edited visually  <=> rendered hash != -t.

Pure standard library (html.parser): the editor HTML is browser-serialised
innerHTML, i.e. well-formed with explicit end tags, which a small tree builder
round-trips faithfully. Untouched markup is re-emitted byte for byte.
"""
from __future__ import annotations

import copy
import hashlib
import html as _html
import re
from dataclasses import dataclass, field
from html.parser import HTMLParser
from typing import Any, Callable, Optional, Union

VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}
BLOCK_BREAK = {"div", "p", "li", "h1", "h2", "h3", "h4", "h5", "h6"}
PROFILE_ATTR = "data-bind-profile"
LEGACY_LOCK_ATTR = "data-bind-lock"  # earlier name; stripped on sight
EDITOR_ID_ATTR = "data-sb-id"  # visual editor's per-element id (styles hang off it)


# ------------------------------------------------------------------ tree ----

@dataclass
class Element:
    tag: str
    attrs: list[list[Optional[str]]]
    raw_start: str
    children: list["Node"] = field(default_factory=list)
    self_closing: bool = False
    has_end: bool = True
    dirty: bool = False
    parent: Optional["Element"] = None

    def get(self, name: str) -> Optional[str]:
        for k, v in self.attrs:
            if k == name:
                return v if v is not None else ""
        return None

    def has(self, name: str) -> bool:
        return any(k == name for k, _ in self.attrs)

    def set(self, name: str, value: Optional[str]) -> None:
        for pair in self.attrs:
            if pair[0] == name:
                if pair[1] != value:
                    pair[1] = value
                    self.dirty = True
                return
        self.attrs.append([name, value])
        self.dirty = True

    def remove(self, name: str) -> None:
        before = len(self.attrs)
        self.attrs = [p for p in self.attrs if p[0] != name]
        if len(self.attrs) != before:
            self.dirty = True

    def iter(self):
        """Depth-first over descendant elements (not self)."""
        for c in self.children:
            if isinstance(c, Element):
                yield c
                yield from c.iter()


@dataclass
class Raw:
    """Text, entity, comment, doctype — re-emitted verbatim."""
    text: str
    is_text: bool = True


Node = Union[Element, Raw]


class _Builder(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=False)
        self.root = Element("#root", [], "")
        self.stack = [self.root]

    def _add(self, node: Node) -> None:
        parent = self.stack[-1]
        if isinstance(node, Element):
            node.parent = parent
        parent.children.append(node)

    def handle_starttag(self, tag, attrs):
        el = Element(tag, [[k, v] for k, v in attrs], self.get_starttag_text() or f"<{tag}>")
        self._add(el)
        if tag in VOID:
            el.has_end = False
        else:
            self.stack.append(el)

    def handle_startendtag(self, tag, attrs):
        el = Element(tag, [[k, v] for k, v in attrs], self.get_starttag_text() or f"<{tag}/>", self_closing=True, has_end=False)
        self._add(el)

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, 0, -1):
            if self.stack[i].tag == tag:
                del self.stack[i:]
                return
        # stray end tag: drop it (browsers do the same)

    def handle_data(self, data):
        self._add(Raw(data))

    def handle_entityref(self, name):
        self._add(Raw(f"&{name};"))

    def handle_charref(self, name):
        self._add(Raw(f"&#{name};"))

    def handle_comment(self, data):
        self._add(Raw(f"<!--{data}-->", is_text=False))

    def handle_decl(self, decl):
        self._add(Raw(f"<!{decl}>", is_text=False))

    def handle_pi(self, data):
        self._add(Raw(f"<?{data}>", is_text=False))

    def unknown_decl(self, data):
        self._add(Raw(f"<![{data}]>", is_text=False))


def parse(html: str) -> Element:
    b = _Builder()
    b.feed(html or "")
    b.close()
    return b.root


def _start(el: Element) -> str:
    if not el.dirty:
        return el.raw_start
    parts = [el.tag]
    for k, v in el.attrs:
        parts.append(k if v is None else f'{k}="{_html.escape(v, quote=True)}"')
    return "<" + " ".join(parts) + ("/>" if el.self_closing else ">")


def serialize(node: Node) -> str:
    if isinstance(node, Raw):
        return node.text
    inner = "".join(serialize(c) for c in node.children)
    if node.tag == "#root":
        return inner
    return _start(node) + inner + (f"</{node.tag}>" if node.has_end else "")


# ------------------------------------------------------------------ text ----

def text_of(el: Element) -> str:
    """Visible text with <br>/blocks as newlines, whitespace-normalised."""
    out: list[str] = []

    def walk(n: Node, top: bool) -> None:
        if isinstance(n, Raw):
            if n.is_text:
                out.append(_html.unescape(n.text))
            return
        if n.tag in ("script", "style", "template"):
            return
        if n.tag == "br":
            out.append("\n")
            return
        if not top and n.tag in BLOCK_BREAK and out and not out[-1].endswith("\n"):
            out.append("\n")
        for c in n.children:
            walk(c, False)

    walk(el, True)
    s = "".join(out).replace("\xa0", " ")
    lines = [re.sub(r"[ \t\r\f\v]+", " ", line).strip() for line in s.split("\n")]
    while lines and not lines[0]:
        lines.pop(0)
    while lines and not lines[-1]:
        lines.pop()
    return "\n".join(lines)


def norm_text(value: str) -> str:
    """An answer normalised the way `text_of` reads the page, so the two compare."""
    s = str(value or "").replace("\xa0", " ")
    lines = [re.sub(r"[ \t\r\f\v]+", " ", line).strip() for line in s.split("\n")]
    while lines and not lines[0]:
        lines.pop(0)
    while lines and not lines[-1]:
        lines.pop()
    return "\n".join(lines)


def set_text(el: Element, value: str) -> None:
    lines = value.split("\n")
    children: list[Node] = []
    for i, line in enumerate(lines):
        if i:
            br = Element("br", [], "<br>", has_end=False, parent=el)
            children.append(br)
        children.append(Raw(_html.escape(line, quote=False)))
    el.children = children


def h(value: Any) -> str:
    return hashlib.sha1(str(value if value is not None else "").encode("utf-8")).hexdigest()[:10]


# ---------------------------------------------------------------- values ----

def _get(values: Any, path: str) -> Any:
    node = values
    for key in path.split("."):
        if isinstance(node, list):
            try:
                node = node[int(key)]
            except (ValueError, IndexError):
                return None
        elif isinstance(node, dict):
            node = node.get(key)
        else:
            return None
    return node


def _set(values: dict, path: str, value: Any) -> None:
    parts = path.split(".")
    node: Any = values
    for i, key in enumerate(parts[:-1]):
        nxt_is_index = parts[i + 1].isdigit()
        if isinstance(node, list):
            idx = int(key)
            while len(node) <= idx:
                node.append({})
            if not isinstance(node[idx], (dict, list)):
                node[idx] = [] if nxt_is_index else {}
            node = node[idx]
        else:
            if not isinstance(node.get(key), (dict, list)):
                node[key] = [] if nxt_is_index else {}
            node = node[key]
    last = parts[-1]
    if isinstance(node, list):
        idx = int(last)
        while len(node) <= idx:
            node.append({})
        node[idx] = value
    else:
        node[last] = value


def _str(v: Any) -> str:
    return "" if v is None else str(v).strip()


def _resolve(path: str, prefix: str) -> str:
    """".name" is relative to the current row (prefix "offerings.items.2.");
    anything else is an absolute values path."""
    if path.startswith("."):
        return f"{prefix}{path[1:]}" if prefix else path[1:]
    return path


# ------------------------------------------------------------- bindings ----

KINDS = ("text", "href", "src")
ATTR = {"text": "data-bind", "href": "data-bind-href", "src": "data-bind-src"}


def _suffix(kind: str) -> str:
    return "" if kind == "text" else f"-{kind}"


def _rendered(el: Element, kind: str) -> str:
    if kind == "text":
        return text_of(el)
    return el.get(kind) or ""


def _format_href(value: str, fmt: Optional[str]) -> str:
    if fmt == "tel":
        return "tel:" + re.sub(r"[^0-9+]", "", value)
    if fmt == "mailto":
        return "mailto:" + value
    return value


def _unformat_href(href: str, fmt: Optional[str]) -> Optional[str]:
    """href -> answer for write-back; None when the href is derived (tel/mailto)."""
    if fmt in ("tel", "mailto"):
        return None
    return href


@dataclass
class Context:
    values: dict
    locked: set[str]
    asset_url: Callable[[str], str]
    asset_path: Callable[[str], str]


def _apply(el: Element, kind: str, value: str, ctx: Context) -> None:
    if kind == "text":
        set_text(el, value)
    elif kind == "href":
        el.set("href", _format_href(value, el.get("data-bind-href-fmt")))
    else:
        el.set("src", ctx.asset_url(value))
        el.remove("srcset")
        el.remove("sizes")


def _bindings(el: Element, prefix: str) -> list[tuple[str, str]]:
    out = []
    for kind in KINDS:
        p = el.get(ATTR[kind])
        if p:
            out.append((kind, _resolve(p, prefix)))
    return out


def _fill_element(el: Element, prefix: str, ctx: Context, force: bool = False) -> None:
    for kind, path in _bindings(el, prefix):
        sfx = _suffix(kind)
        value = _str(_get(ctx.values, path))
        locked = path in ctx.locked
        vh = h(value)
        stamped = el.get(f"data-bind{sfx}-v")
        rendered_hash = h(_rendered(el, kind))
        pending_edit = kind == "text" and bool(value) and norm_text(value) != _rendered(el, kind)
        if stamped is None and not force:
            # First sight. Normally the element shows this answer already; if
            # its text differs, it was edited before the page was ever saved —
            # record that as an edit so the save writes it back.
            el.set(f"data-bind{sfx}-v", vh)
            el.set(f"data-bind{sfx}-t", h(norm_text(value)) if pending_edit else rendered_hash)
        else:
            changed_by_form = stamped != vh
            edited_visually = el.get(f"data-bind{sfx}-t") != rendered_hash
        # A visual edit not saved yet beats a stale answer; the save writes it back.
            if value and (force or (changed_by_form and not edited_visually)):
                _apply(el, kind, value, ctx)
            el.set(f"data-bind{sfx}-v", vh)
            el.set(f"data-bind{sfx}-t", h(_rendered(el, kind)))
        if el.has(LEGACY_LOCK_ATTR):
            el.remove(LEGACY_LOCK_ATTR)
        if locked:
            el.set(PROFILE_ATTR, "")
        elif el.has(PROFILE_ATTR):
            el.remove(PROFILE_ATTR)


def _items(container: Element) -> list[Element]:
    """Rows of a list: data-bind-item elements not nested in another row."""
    rows: list[Element] = []

    def walk(n: Element) -> None:
        for c in n.children:
            if isinstance(c, Element):
                if c.has("data-bind-item"):
                    rows.append(c)
                elif not c.has("data-bind-list"):
                    walk(c)

    walk(container)
    return rows


def _strip_editor_ids(el: Element) -> None:
    for n in [el, *el.iter()]:
        if n.has(EDITOR_ID_ATTR):
            n.remove(EDITOR_ID_ATTR)


def _clone(el: Element) -> Element:
    c = copy.deepcopy(el)
    c.parent = el.parent

    def relink(n: Element) -> None:
        for ch in n.children:
            if isinstance(ch, Element):
                ch.parent = n
                relink(ch)

    relink(c)
    _strip_editor_ids(c)
    c.set("data-bind-new", "1")
    # A clone is filled from scratch — forget the source row's hashes.
    for n in [c, *c.iter()]:
        for kind in KINDS:
            n.remove(f"data-bind{_suffix(kind)}-v")
            n.remove(f"data-bind{_suffix(kind)}-t")
    return c


def _walk_fill(node: Element, prefix: str, ctx: Context, force: bool = False) -> None:
    for c in list(node.children):
        if not isinstance(c, Element):
            continue
        list_path = c.get("data-bind-list")
        if list_path:
            _fill_element(c, prefix, ctx, force)
            _fill_list(c, _resolve(list_path, prefix), ctx, force)
            continue
        _fill_element(c, prefix, ctx, force)
        _walk_fill(c, prefix, ctx, force)


def _fill_list(container: Element, path: str, ctx: Context, force: bool) -> None:
    rows_values = _get(ctx.values, path)
    rows_values = rows_values if isinstance(rows_values, list) else []
    rows = _items(container)
    list_hash = h(repr(rows_values))
    structural = container.get("data-bind-list-v") not in (None, list_hash)

    if rows and structural:
        # Grow: new rows copy the look of the last one. Shrink: drop from the end.
        while len(rows) < len(rows_values):
            src = rows[-1]
            clone = _clone(src)
            siblings = src.parent.children
            siblings.insert(siblings.index(src) + 1, clone)
            rows.append(clone)
        while len(rows) > len(rows_values):
            gone = rows.pop()
            gone.parent.children.remove(gone)

    for i, row in enumerate(rows):
        row.set("data-bind-i", str(i))
        new_row = row.has("data-bind-new")
        row.remove("data-bind-new")
        _fill_element(row, f"{path}.{i}.", ctx, force or new_row)
        _walk_fill(row, f"{path}.{i}.", ctx, force or new_row)
    container.set("data-bind-list-v", list_hash)


def fill(html: str, values: dict, locked: set[str] | frozenset[str] = frozenset(), *,
         asset_url: Callable[[str], str] = lambda s: s,
         asset_path: Callable[[str], str] = lambda s: s) -> str:
    """Bring a page's bound elements up to date with `values`. Pages without
    any `data-bind` (legacy edits, cloned sites) come back unchanged."""
    if not html or "data-bind" not in html:
        return html
    root = parse(html)
    _walk_fill(root, "", Context(values or {}, set(locked), asset_url, asset_path))
    return serialize(root)


# ---------------------------------------------------------- mark pending ----

def _mark_element(el: Element, prefix: str, values: dict) -> None:
    for kind, path in _bindings(el, prefix):
        if kind != "text":
            continue
        value = _str(_get(values, path))
        if not value:
            continue
        rendered = _rendered(el, kind)
        if norm_text(value) == rendered:
            continue
        stamped, vh = el.get("data-bind-v"), h(value)
        if stamped is None or (stamped == vh and el.get("data-bind-t") == h(rendered)):
            # Text differs from an answer the form didn't change, and nothing
            # records it as an edit: it was edited before the page's first
            # save, or saved while Profile fields were read-only.
            el.set("data-bind-v", vh)
            el.set("data-bind-t", h(norm_text(value)))


def _walk_mark(node: Element, prefix: str, values: dict) -> None:
    for c in node.children:
        if not isinstance(c, Element):
            continue
        list_path = c.get("data-bind-list")
        if list_path:
            _mark_element(c, prefix, values)
            for i, row in enumerate(_items(c)):
                row_prefix = f"{_resolve(list_path, prefix)}.{row.get('data-bind-i') or i}."
                _mark_element(row, row_prefix, values)
                _walk_mark(row, row_prefix, values)
            continue
        _mark_element(c, prefix, values)
        _walk_mark(c, prefix, values)


def mark_pending_edits(html: str, values: dict) -> str:
    """Before extracting a save: flag bound text that differs from its answer
    without being recorded as an edit, so `extract` writes it back. Leaves
    every other element untouched."""
    if not html or "data-bind" not in html:
        return html
    root = parse(html)
    _walk_mark(root, "", values or {})
    return serialize(root)


# --------------------------------------------------------------- extract ----

def _extract_element(el: Element, prefix: str, ctx: Context, out: dict) -> None:
    for kind, path in _bindings(el, prefix):
        sfx = _suffix(kind)
        rendered = _rendered(el, kind)
        if el.get(f"data-bind{sfx}-t") == h(rendered):
            continue  # untouched in the editor
        if kind == "href":
            v = _unformat_href(rendered, el.get("data-bind-href-fmt"))
            if v is None:
                continue
        elif kind == "src":
            v = ctx.asset_path(rendered)
        else:
            v = rendered
        _set(out, path, v)


def _walk_extract(node: Element, prefix: str, ctx: Context, out: dict) -> None:
    for c in node.children:
        if not isinstance(c, Element):
            continue
        list_path = c.get("data-bind-list")
        if list_path:
            _extract_element(c, prefix, ctx, out)
            _extract_list(c, _resolve(list_path, prefix), ctx, out)
            continue
        _extract_element(c, prefix, ctx, out)
        _walk_extract(c, prefix, ctx, out)


def _extract_list(container: Element, path: str, ctx: Context, out: dict) -> None:
    old = _get(ctx.values, path)
    old = old if isinstance(old, list) else []
    rows = _items(container)
    new_rows: list[Any] = []
    used: set[int] = set()
    for pos, row in enumerate(rows):
        try:
            i = int(row.get("data-bind-i") or pos)
        except ValueError:
            i = pos
        # A row duplicated in the editor carries the same index: it becomes a
        # new row starting as a copy of the original.
        base = copy.deepcopy(old[i]) if 0 <= i < len(old) else {}
        used.add(i)
        edits: dict = {"_": base}
        row_ctx = Context({"_": base}, set(), ctx.asset_url, ctx.asset_path)
        # read this row's edits relative to itself
        _extract_row(row, row_ctx, edits)
        new_rows.append(edits["_"])
    if new_rows != old:
        _set(out, path, new_rows)


def _extract_row(row: Element, ctx: Context, out: dict) -> None:
    _extract_element(row, "_.", ctx, out)
    _walk_extract(row, "_.", ctx, out)


def extract(html: str, values: dict, locked: set[str] | frozenset[str] = frozenset(), *,
            asset_path: Callable[[str], str] = lambda s: s) -> dict:
    """Answers changed in the visual editor, as a partial `values` tree to
    merge (lists come back whole). Empty when nothing bound was touched."""
    if not html or "data-bind" not in html:
        return {}
    root = parse(html)
    out: dict = {}
    _walk_extract(root, "", Context(values or {}, set(locked), lambda s: s, asset_path), out)
    return out


def merge(values: dict, changes: dict) -> dict:
    """Deep-merge `changes` into a copy of `values` (lists replace)."""
    result = copy.deepcopy(values or {})

    def go(dst: dict, src: dict) -> None:
        for k, v in src.items():
            if isinstance(v, dict) and isinstance(dst.get(k), dict):
                go(dst[k], v)
            else:
                dst[k] = copy.deepcopy(v)

    go(result, changes)
    return result


def has_bindings(content: Optional[dict]) -> bool:
    pages = (content or {}).get("pages") or {}
    return any("data-bind" in (p.get("html") or "") for p in pages.values() if isinstance(p, dict))
