"""
Read a "One-Page Website Content" .docx into website `values`.

The content team writes every site's copy in the same Word layout:

    Part 2 — <Business>: Section Copy          (Heading 1)
      G · Global                               (Heading 2)
        Title tag (54): …                      (bold label, then the value)
      S1 · Hero (replaces …)                   (Heading 2)
        H1: …   Paragraph: …   [Button] Label → https://…
      S3 · Menu picks                          a table with a "Dish" column
      S4 · Why choose us                       bold title line + description line
      …
      JSON-LD (paste once in <head>)           the script block, one line per paragraph
    Part 3 — Menu ledger and flags             (internal, never read)

Sections are found by their code (G, S1…S8, JSON-LD), never by the wording
after it, so a heading can be reworded freely. A section a file leaves out is
simply absent from the result, and the site template drops that block.

Only the standard library is used: a .docx is a zip of XML parts, and the
handful of things read here (paragraph style, bold/italic runs, hyperlinks,
tables) don't justify a dependency.

The output is the same nested `values` tree the Super App's website form
writes, so an imported website is indistinguishable from a typed-in one.
"""
from __future__ import annotations

import io
import json
import re
import zipfile
from dataclasses import dataclass, field
from typing import Any, Optional
from xml.etree import ElementTree as ET

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
PKG_REL = "{http://schemas.openxmlformats.org/package/2006/relationships}"


class DocxImportError(ValueError):
    """The upload isn't a readable website content file. Message is user-facing."""


# ============================================================ low-level read ==
@dataclass
class Run:
    text: str
    bold: bool = False
    italic: bool = False
    href: Optional[str] = None


@dataclass
class Para:
    style: str
    runs: list[Run]

    @property
    def text(self) -> str:
        return "".join(r.text for r in self.runs).strip()

    def _visible(self) -> list[Run]:
        return [r for r in self.runs if r.text.strip()]

    @property
    def all_bold(self) -> bool:
        runs = self._visible()
        return bool(runs) and all(r.bold for r in runs)

    @property
    def all_italic(self) -> bool:
        runs = self._visible()
        return bool(runs) and all(r.italic for r in runs)

    @property
    def link(self) -> Optional[str]:
        return next((r.href for r in self.runs if r.href), None)


@dataclass
class Table:
    rows: list[list[str]]


Block = Any  # Para | Table


def _on(el: Optional[ET.Element]) -> bool:
    """A w:b / w:i toggle: present and not explicitly switched off."""
    if el is None:
        return False
    return el.get(f"{W}val", "true").lower() not in ("0", "false", "off")


def _runs(parent: ET.Element, rels: dict[str, str], href: Optional[str] = None) -> list[Run]:
    out: list[Run] = []
    for child in parent:
        if child.tag == f"{W}r":
            rpr = child.find(f"{W}rPr")
            bold = _on(rpr.find(f"{W}b")) if rpr is not None else False
            italic = _on(rpr.find(f"{W}i")) if rpr is not None else False
            text = ""
            for node in child:
                if node.tag == f"{W}t":
                    text += node.text or ""
                elif node.tag == f"{W}tab":
                    text += " "
                elif node.tag in (f"{W}br", f"{W}cr"):
                    text += "\n"
            if text:
                out.append(Run(text, bold, italic, href))
        elif child.tag == f"{W}hyperlink":
            link = rels.get(child.get(f"{R}id", ""), None)
            out.extend(_runs(child, rels, link or href))
        elif child.tag in (f"{W}ins", f"{W}smartTag", f"{W}sdt", f"{W}sdtContent", f"{W}fldSimple"):
            out.extend(_runs(child, rels, href))
    return out


def _para(p: ET.Element, rels: dict[str, str], styles: dict[str, str]) -> Para:
    ppr = p.find(f"{W}pPr")
    style_id = ""
    if ppr is not None:
        ps = ppr.find(f"{W}pStyle")
        if ps is not None:
            style_id = ps.get(f"{W}val", "")
    return Para(styles.get(style_id, style_id), _runs(p, rels))


def _cell_text(tc: ET.Element, rels, styles) -> str:
    return "\n".join(t for t in (_para(p, rels, styles).text for p in tc.iter(f"{W}p")) if t).strip()


def read_blocks(data: bytes) -> list[Block]:
    """The document body as a flat list of paragraphs and tables, in order."""
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
        document = ET.fromstring(zf.read("word/document.xml"))
    except (zipfile.BadZipFile, KeyError, ET.ParseError) as exc:
        raise DocxImportError("That file isn't a readable Word (.docx) document.") from exc

    rels: dict[str, str] = {}
    try:
        for rel in ET.fromstring(zf.read("word/_rels/document.xml.rels")):
            if rel.get("TargetMode") == "External":
                rels[rel.get("Id", "")] = rel.get("Target", "")
    except (KeyError, ET.ParseError):
        pass

    # Style ids ("Heading2") -> names ("heading 2"), so localised or renamed
    # ids still resolve to the built-in heading they are based on.
    styles: dict[str, str] = {}
    try:
        for st in ET.fromstring(zf.read("word/styles.xml")).iter(f"{W}style"):
            name = st.find(f"{W}name")
            styles[st.get(f"{W}styleId", "")] = (name.get(f"{W}val", "") if name is not None else "")
    except (KeyError, ET.ParseError):
        pass

    body = document.find(f"{W}body")
    blocks: list[Block] = []
    for el in body if body is not None else []:
        if el.tag == f"{W}p":
            blocks.append(_para(el, rels, styles))
        elif el.tag == f"{W}tbl":
            rows = []
            for tr in el.iter(f"{W}tr"):
                rows.append([_cell_text(tc, rels, styles) for tc in tr.findall(f"{W}tc")])
            blocks.append(Table(rows))
    return blocks


def heading_level(p: Para) -> int:
    m = re.match(r"(?i)^(?:heading|überschrift|titre)\s*(\d)$", p.style.strip())
    if m:
        return int(m.group(1))
    if p.style.lower() == "title":
        return 0
    return -1


# ============================================================ text helpers ==
_CONFIRM = re.compile(r"\s*\[\s*CONFIRM\b[^\]]*\]", re.IGNORECASE)
_DASHES = str.maketrans({"–": "–", "—": "—"})


def clean(text: str) -> str:
    """Drop [CONFIRM …] notes, collapse whitespace, keep line breaks."""
    text = _CONFIRM.sub("", text or "")
    lines = [re.sub(r"[ \t ]+", " ", line).strip() for line in text.split("\n")]
    return "\n".join(l for l in lines if l).strip()


def split_dots(text: str) -> list[str]:
    """`Home · About · Menu` -> ["Home", "About", "Menu"]."""
    return [clean(p) for p in re.split(r"\s+[·•|]\s+", text or "") if clean(p)]


def norm_label(label: str) -> str:
    """`Title tag (54)` -> `title tag`; `[Button under grid]` -> `[button under grid]`."""
    label = re.sub(r"\([^)]*\)", "", label)
    return re.sub(r"\s+", " ", label).strip().rstrip(":").strip().lower()


_URL = re.compile(r"https?://[^\s<>\"')]+")


def split_button(value: str, link: Optional[str]) -> tuple[str, str]:
    """`Order Direct → https://…` -> ("Order Direct", "https://…")."""
    parts = re.split(r"\s*(?:→|->|⟶|»)\s*", value, maxsplit=1)
    label = clean(parts[0])
    url = ""
    if len(parts) > 1:
        m = _URL.search(parts[1])
        url = m.group(0) if m else ""
    if not url and link:
        url = link
    if not url:
        m = _URL.search(label)
        if m:
            url = m.group(0)
            label = clean(label.replace(url, ""))
    return label, url


def alt_text(value: str) -> str:
    m = re.search(r"alt\s*[:=]\s*[\"“](.+?)[\"”]", value, re.IGNORECASE)
    return clean(m.group(1)) if m else ""


# ============================================================ section split ==
@dataclass
class Section:
    code: str
    title: str
    blocks: list[Block] = field(default_factory=list)

    def fields(self) -> list[tuple[str, str, Para]]:
        """(normalised label, value, paragraph) for every `Label: value` line."""
        out = []
        for b in self.blocks:
            if isinstance(b, Para):
                parsed = labelled(b)
                if parsed:
                    out.append((parsed[0], parsed[1], b))
        return out


def labelled(p: Para) -> Optional[tuple[str, str]]:
    """A paragraph that opens with a bold `Label:` or `[Button …]` run."""
    if p.all_italic or not p.runs:
        return None
    lead = ""
    rest_index = 0
    for i, run in enumerate(p.runs):
        if run.bold:
            lead += run.text
            rest_index = i + 1
            continue
        break
    lead = lead.strip()
    rest = "".join(r.text for r in p.runs[rest_index:])
    if not lead:
        # Unbolded fallback: `Label: value` written in plain text.
        m = re.match(r"^\s*([A-Za-z][\w /&'-]{0,40}):\s+(.+)$", p.text, re.S)
        return (norm_label(m.group(1)), m.group(2).strip()) if m else None
    if lead.startswith("[") and "]" in lead:
        label, _, extra = lead.partition("]")
        return norm_label(label + "]"), (extra + rest).strip()
    if ":" in lead:
        label, _, extra = lead.partition(":")
        return norm_label(label), (extra + rest).strip()
    return None


_CODE = re.compile(r"^\s*(G|S\d{1,2}|JSON[-\s]?LD)\b", re.IGNORECASE)


def split_sections(blocks: list[Block]) -> tuple[list[Para], dict[str, Section]]:
    """Paragraphs before the first Part heading, and the coded Part 2 sections."""
    preamble: list[Para] = []
    sections: dict[str, Section] = {}
    current: Optional[Section] = None
    seen_part = False
    for b in blocks:
        if isinstance(b, Para):
            level = heading_level(b)
            if level == 1:
                seen_part = True
                current = None
                continue
            if level == 2:
                m = _CODE.match(b.text)
                if m:
                    code = m.group(1).upper().replace(" ", "-").replace("JSONLD", "JSON-LD")
                    current = sections.setdefault(code, Section(code, b.text))
                else:
                    current = None
                continue
            if not seen_part and level < 0:
                preamble.append(b)
                continue
        if current is not None:
            current.blocks.append(b)
    return preamble, sections


# ============================================================ assembling ==
_PHONE = re.compile(r"\(?\+?\d[\d\s().-]{7,}\d")
_US_CITY = re.compile(r",\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?$")


def split_address(full: str) -> tuple[str, str]:
    """`44599 Valley Central Way #6526, Lancaster, CA 93536` -> (street, city line)."""
    full = clean(full)
    street, _, city = full.partition(",")
    return street.strip(), city.strip()


def format_hours(text: str) -> str:
    """`Monday – Sunday, 7:00 AM – 8:30 PM` -> two lines, the way the footer shows hours."""
    text = clean(text).replace(" -- ", " – ")
    m = re.match(r"^(.*?[A-Za-z]),\s*(\d.*)$", text)
    if m:
        return f"{m.group(1).strip()}\n{m.group(2).strip()}"
    m = re.match(r"^([A-Za-z][A-Za-z\s–—-]*?)\s+(\d.*)$", text)
    if m:
        return f"{m.group(1).strip()}\n{m.group(2).strip()}"
    return text


def set_at(values: dict, path: str, value: Any) -> None:
    """Write `value` at a dotted path. Empty strings/lists are skipped."""
    if value is None or value == "" or value == []:
        return
    node = values
    keys = path.split(".")
    for key in keys[:-1]:
        node = node.setdefault(key, {})
    node[keys[-1]] = value


@dataclass
class ImportResult:
    values: dict[str, Any]
    warnings: list[str]
    sections: list[str]


_REVIEW_INSTRUCTION = re.compile(r"\b(widget|never quotes?|copy never|keep the live)\b", re.IGNORECASE)

# Labels that are intentionally not imported, per section, so they don't show
# up as "unrecognised" warnings.
_IGNORED = {
    "G": {"h1"},
    "S3": {"each card"},
    "S7": {"map"},
    "S8": {"contact", "social", "hours"},
}


def parse_docx(data: bytes) -> ImportResult:
    blocks = read_blocks(data)
    preamble, sections = split_sections(blocks)
    if not any(code.startswith("S") for code in sections):
        raise DocxImportError(
            "No website sections were found. The file needs Heading 2 sections named "
            "“S1 · Hero”, “S2 · About” and so on."
        )

    v: dict[str, Any] = {}
    warnings: list[str] = []

    def unknown(code: str, label: str) -> None:
        if label not in _IGNORED.get(code, set()):
            warnings.append(f"{code}: “{label}” isn’t a field the template uses, so it was skipped.")

    # ---- preamble: client line + order URL -----------------------------
    title = next((p.text for p in blocks if isinstance(p, Para) and heading_level(p) == 0), "")
    for p in preamble:
        parsed = labelled(p)
        if not parsed:
            continue
        label, value = parsed
        if label == "client":
            parts = split_dots(value)
            if parts:
                set_at(v, "business.name", parts[0])
            for part in parts[1:]:
                if _PHONE.fullmatch(part.strip()):
                    set_at(v, "business.phone", part)
                elif re.search(r"\d", part) and "," in part and not v.get("business", {}).get("address"):
                    street, city = split_address(part)
                    set_at(v, "business.address", street)
                    set_at(v, "business.city", city)
                elif re.search(r"(?i)\b(mon|tue|wed|thu|fri|sat|sun|daily|am|pm)\b", part):
                    set_at(v, "business.hours", format_hours(part))
        elif label.startswith("order url"):
            m = _URL.search(value) or (re.match(r".*", p.link or "") if p.link else None)
            set_at(v, "orderUrl", m.group(0) if m else (p.link or ""))
    if not v.get("business", {}).get("name") and title:
        set_at(v, "business.name", clean(re.split(r"\s+[—–-]\s+", title)[0]))

    # ---- G · Global -----------------------------------------------------
    if "G" in sections:
        keywords: list[str] = []
        for label, value, p in sections["G"].fields():
            if label == "title tag":
                set_at(v, "meta.title", clean(value))
            elif label == "meta description":
                set_at(v, "meta.description", clean(value))
            elif label == "og title":
                set_at(v, "meta.ogTitle", clean(value))
            elif label == "og description":
                set_at(v, "meta.ogDescription", clean(value))
            elif label == "nav labels":
                items = split_dots(value)
                nav = [i for i in items if not i.startswith("[")]
                cta = next((i.strip("[]") for i in items if i.startswith("[")), "")
                set_at(v, "labels.nav", " · ".join(nav))
                set_at(v, "labels.headerCta", clean(cta))
            elif label == "focus keyword":
                keywords.insert(0, clean(value))
            elif label in ("secondary", "secondary keywords"):
                keywords.extend(k.strip() for k in clean(value).split(",") if k.strip())
            else:
                unknown("G", label)
        set_at(v, "meta.keywords", ", ".join(keywords))

    # ---- S1 · Hero ------------------------------------------------------
    if "S1" in sections:
        for label, value, p in sections["S1"].fields():
            if label in ("h1", "headline", "heading"):
                set_at(v, "hero.headline", clean(value))
            elif label in ("paragraph", "subtext", "text"):
                set_at(v, "hero.subtext", clean(value))
            elif label.startswith("[button"):
                text, url = split_button(value, p.link)
                set_at(v, "hero.ctaLabel", text)
                set_at(v, "hero.ctaLink", url)
            elif label == "image":
                set_at(v, "hero.imageAlt", alt_text(value))
            else:
                unknown("S1", label)

    # ---- S2 · About -----------------------------------------------------
    if "S2" in sections:
        for label, value, p in sections["S2"].fields():
            if label == "eyebrow":
                set_at(v, "about.eyebrow", clean(value))
            elif label in ("h2", "heading"):
                set_at(v, "about.heading", clean(value))
            elif label in ("paragraph", "body"):
                set_at(v, "about.story", clean(value))
            elif label.startswith("[button"):
                text, url = split_button(value, p.link)
                set_at(v, "about.ctaLabel", text)
                set_at(v, "about.ctaLink", url)
            elif label == "image":
                set_at(v, "about.imageAlt", alt_text(value))
            else:
                unknown("S2", label)

    # ---- S3 · Menu picks ------------------------------------------------
    if "S3" in sections:
        sec = sections["S3"]
        for label, value, p in sec.fields():
            if label == "eyebrow":
                set_at(v, "offerings.eyebrow", clean(value))
            elif label in ("h2", "heading"):
                set_at(v, "offerings.heading", clean(value))
            elif label in ("intro line", "intro", "paragraph"):
                set_at(v, "offerings.intro", clean(value))
            elif label.startswith("[button"):
                text, url = split_button(value, p.link)
                set_at(v, "offerings.ctaLabel", text)
                set_at(v, "offerings.ctaLink", url)
            elif label == "each card":
                m = re.search(r"button\s+[\"“]([^\"”]+)[\"”]", value, re.IGNORECASE)
                if m:
                    set_at(v, "offerings.cardCta", clean(m.group(1)))
            else:
                unknown("S3", label)
        items = []
        for table in (b for b in sec.blocks if isinstance(b, Table)):
            if not table.rows:
                continue
            header = [h.lower() for h in table.rows[0]]
            name_col = next((i for i, h in enumerate(header) if "dish" in h or "item" in h or "name" in h), None)
            if name_col is None:
                continue
            desc_col = next(
                (i for i, h in enumerate(header) if i != name_col and ("line" in h or "desc" in h)), None
            )
            for row in table.rows[1:]:
                name = clean(row[name_col]) if name_col < len(row) else ""
                if not name:
                    continue
                item = {"name": name}
                if desc_col is not None and desc_col < len(row) and clean(row[desc_col]):
                    item["description"] = clean(row[desc_col])
                items.append(item)
        if items:
            set_at(v, "offerings.items", items)
        else:
            warnings.append("S3: no menu table with a “Dish” column was found, so the menu has no dishes.")

    # ---- S4 · Why choose us ---------------------------------------------
    if "S4" in sections:
        sec = sections["S4"]
        points: list[dict[str, str]] = []
        pending: Optional[dict[str, str]] = None
        for b in sec.blocks:
            if not isinstance(b, Para) or not b.text or b.all_italic:
                continue
            parsed = labelled(b)
            if parsed and not b.all_bold:
                label, value = parsed
                if label == "eyebrow":
                    set_at(v, "social.eyebrow", clean(value))
                elif label in ("h2", "heading"):
                    set_at(v, "social.heading", clean(value))
                else:
                    unknown("S4", label)
                continue
            if b.all_bold:
                if pending:
                    points.append(pending)
                pending = {"title": clean(b.text).rstrip(":")}
            elif pending is not None:
                desc = clean(b.text)
                pending["description"] = f"{pending.get('description', '')} {desc}".strip()
        if pending:
            points.append(pending)
        points = [p for p in points if p.get("title")]
        if points:
            set_at(v, "social.points", points)

    # ---- S5 · Catering --------------------------------------------------
    if "S5" in sections:
        for label, value, p in sections["S5"].fields():
            if label == "eyebrow":
                set_at(v, "catering.eyebrow", clean(value))
            elif label in ("h2", "heading"):
                set_at(v, "catering.heading", clean(value))
            elif label in ("paragraph", "body"):
                set_at(v, "catering.body", clean(value))
            elif label.startswith("[button"):
                text, url = split_button(value, p.link)
                set_at(v, "catering.ctaLabel", text)
                set_at(v, "catering.ctaLink", url)
            elif label == "form title":
                set_at(v, "catering.formTitle", clean(value))
            elif label in ("fields", "form fields"):
                set_at(v, "catering.formFields", " · ".join(split_dots(value)))
            elif label in ("button", "submit"):
                set_at(v, "catering.submitLabel", clean(value))
            elif label == "success message":
                set_at(v, "catering.success", clean(value))
            else:
                unknown("S5", label)

    # ---- S6 · Reviews ---------------------------------------------------
    if "S6" in sections:
        for label, value, p in sections["S6"].fields():
            if label == "eyebrow":
                set_at(v, "social.reviewsEyebrow", clean(value))
            elif label in ("h2", "heading"):
                set_at(v, "social.reviewsHeading", clean(value))
            elif label in ("line under heading", "line", "paragraph", "rating"):
                sentences = re.split(r"(?<=[.!?])\s+", clean(value))
                kept = [s for s in sentences if s and not _REVIEW_INSTRUCTION.search(s)]
                set_at(v, "social.ratingText", " ".join(kept))
            else:
                unknown("S6", label)

    # ---- S7 · Contact ---------------------------------------------------
    if "S7" in sections:
        for label, value, p in sections["S7"].fields():
            if label in ("h2", "heading"):
                set_at(v, "contact.heading", clean(value))
            elif label == "address":
                street, city = split_address(value)
                set_at(v, "business.address", street)
                set_at(v, "business.city", city)
            elif label == "phone":
                set_at(v, "business.phone", clean(value))
            elif label == "hours":
                set_at(v, "business.hours", format_hours(value))
            elif label in ("line", "paragraph", "note"):
                set_at(v, "contact.line", clean(value))
            elif label in ("form fields", "fields"):
                set_at(v, "contact.formFields", " · ".join(split_dots(value)))
            elif label in ("button", "submit"):
                set_at(v, "contact.submitLabel", clean(value))
            elif label == "success message":
                set_at(v, "contact.success", clean(value))
            elif label.startswith("[button"):
                text, url = split_button(value, p.link)
                set_at(v, "contact.directionsLabel", text)
                set_at(v, "contact.directionsLink", url)
            else:
                unknown("S7", label)

    # ---- S8 · Footer ----------------------------------------------------
    if "S8" in sections:
        for label, value, p in sections["S8"].fields():
            if label in ("blurb", "paragraph", "about"):
                set_at(v, "footer.about", clean(value))
            elif label == "quick links":
                set_at(v, "footer.quickLinks", " · ".join(split_dots(value)))
            elif label == "freshness line":
                set_at(v, "footer.freshness", clean(value))
            elif label == "copyright":
                text = clean(value)
                # "© 2026 Primo Cafe. All Rights Reserved. Powered by Innowi Inc."
                # The year and name are rendered live; keep the two phrases.
                body = re.sub(r"^(?:©|\(c\)|copyright)\s*\d{4}\s*", "", text, flags=re.IGNORECASE)
                name = v.get("business", {}).get("name", "")
                if name and body.lower().startswith(name.lower()):
                    body = body[len(name):].lstrip(" .,")
                rights, sep, credit = body.partition("Powered")
                set_at(v, "footer.rights", rights.strip(" .,"))
                if sep:
                    set_at(v, "footer.credit", ("Powered" + credit).strip())
            else:
                unknown("S8", label)

    # ---- JSON-LD --------------------------------------------------------
    if "JSON-LD" in sections:
        raw = "\n".join(b.text for b in sections["JSON-LD"].blocks if isinstance(b, Para) and not b.all_italic)
        raw = re.sub(r"(?is)</?script[^>]*>", "", raw).strip()
        start, end = raw.find("{"), raw.rfind("}")
        if start >= 0 and end > start:
            try:
                data = json.loads(raw[start : end + 1])
                set_at(v, "meta.jsonLd", json.dumps(data, ensure_ascii=False, indent=2))
                if isinstance(data, dict) and isinstance(data.get("url"), str):
                    set_at(v, "meta.siteUrl", data["url"])
                country = (data.get("address") or {}).get("addressCountry") if isinstance(data, dict) else None
                if country in ("US", "USA"):
                    set_at(v, "business.country", "United States")
            except (ValueError, AttributeError):
                warnings.append("JSON-LD: the block isn’t valid JSON, so it was skipped (one is generated instead).")

    # ---- derived defaults ----------------------------------------------
    business = v.get("business", {})
    if not business.get("country") and _US_CITY.search(business.get("city", "")):
        set_at(v, "business.country", "United States")
    if business.get("name") and business.get("address"):
        set_at(
            v,
            "contact.mapAddress",
            ", ".join(x for x in (business.get("name"), business.get("address"), business.get("city")) if x),
        )
    if "S5" in sections and v.get("catering", {}).get("formFields"):
        set_at(v, "contact.formType", "Contact + catering/quote form")
    else:
        set_at(v, "contact.formType", "Contact form")
    if not v.get("orderUrl"):
        link = v.get("hero", {}).get("ctaLink") or v.get("offerings", {}).get("ctaLink")
        set_at(v, "orderUrl", link or "")

    # ---- what's missing ---------------------------------------------------
    names = {
        "S1": "Hero", "S2": "About", "S3": "Menu", "S4": "Why choose us",
        "S5": "Catering", "S6": "Reviews", "S7": "Contact", "S8": "Footer",
    }
    for code, name in names.items():
        if code not in sections:
            warnings.append(f"No {name} section ({code}) in the file — that block is left out of the site.")
    for path, name in (
        ("business.name", "Business name"),
        ("business.phone", "Phone"),
        ("business.address", "Street address"),
        ("hero.headline", "Hero headline"),
        ("orderUrl", "Online ordering link"),
    ):
        if not get_at(v, path):
            warnings.append(f"{name} wasn’t found in the file — add it before publishing.")

    return ImportResult(values=v, warnings=warnings, sections=sorted(sections, key=_section_order))


def get_at(values: dict, path: str) -> Any:
    node: Any = values
    for key in path.split("."):
        if not isinstance(node, dict):
            return None
        node = node.get(key)
    return node


def _section_order(code: str) -> tuple[int, int]:
    if code == "G":
        return (0, 0)
    if code.startswith("S") and code[1:].isdigit():
        return (1, int(code[1:]))
    return (2, 0)
