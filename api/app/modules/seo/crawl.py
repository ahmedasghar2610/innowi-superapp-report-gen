"""Light on-page checks: fetch a page like a browser would and read the SEO
basics out of its HTML (title, meta description, robots, H1, canonical,
images' alt text, JSON-LD types, word count). Standard library only.

This is not a full crawler (Screaming Frog stays on hold); it checks the home
page plus the pages Search Console says get traffic.
"""
from __future__ import annotations

import json
import re
from html.parser import HTMLParser
from typing import Optional
from urllib.parse import urljoin, urlparse

import httpx

from app.modules.seo.facts import PageFacts

USER_AGENT = "Mozilla/5.0 (compatible; InnowiSEOCheck/1.0; +https://innowi.com)"
MAX_BYTES = 3_000_000
TITLE_MAX = 60
META_MAX = 160
THIN_WORDS = 150

CATEGORY_WORDS = {
    "mains", "starters", "appetizers", "appetisers", "desserts", "drinks", "beverages", "salads", "sides", "platters",
    "wraps", "bowls", "sandwiches", "burgers", "pizzas", "pizza", "curries", "kebabs", "breakfast", "lunch", "dinner",
    "specials", "combos", "soups", "seafood", "vegetarian", "vegan", "kids", "grill", "tandoor", "biryani", "biryanis",
    "rice", "breads", "noodles", "pastas", "tacos", "shakes", "coffee", "sweets", "catering", "signature",
}


def host_of(url: str) -> str:
    h = (urlparse(url if "://" in url else f"https://{url}").hostname or "").lower()
    return h[4:] if h.startswith("www.") else h


def normalize_domain(v: str) -> str:
    v = v.strip().lower()
    if v.startswith("sc-domain:"):
        v = v[len("sc-domain:"):]
    return host_of(v)


def page_type(url: str) -> str:
    path = urlparse(url).path or "/"
    segs = [s for s in path.strip("/").split("/") if s]
    if not segs or (len(segs) == 1 and segs[0] in ("index.html", "home")):
        return "home"
    low = path.lower()
    if segs[0] in ("blog", "blogs", "news", "posts", "articles") or "/blog/" in low:
        return "blog"
    if "best-" in low and "-in-" in low:
        return "combo"
    if "near-me" in low or segs[0] in ("locations", "location", "areas", "neighborhoods") or "-near-" in low or "downtown" in low:
        return "geo"
    if segs[0] in ("menu", "our-menu", "food-menu"):
        if len(segs) == 1:
            return "hub"
        words = set(re.split(r"[-_]", segs[-1]))
        return "category" if words & CATEGORY_WORDS else "dish"
    if segs[0] in ("catering",):
        return "category"
    return "other"


class _Parser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.title: Optional[str] = None
        self._in_title = False
        self._title_buf: list[str] = []
        self.meta_description: Optional[str] = None
        self.robots: list[str] = []
        self.h1 = 0
        self.canonical: Optional[str] = None
        self.img_total = 0
        self.img_alt = 0
        self._skip = 0
        self._ld = False
        self.ld_blocks: list[str] = []
        self._ld_buf: list[str] = []
        self.words = 0

    def handle_starttag(self, tag, attrs):
        a = {k.lower(): (v or "") for k, v in attrs}
        if tag == "title" and self.title is None:
            self._in_title = True
        elif tag == "meta":
            name = (a.get("name") or a.get("property") or "").lower()
            if name == "description" and self.meta_description is None:
                self.meta_description = a.get("content", "").strip()
            elif name in ("robots", "googlebot"):
                self.robots.append(a.get("content", "").lower())
        elif tag == "link" and "canonical" in a.get("rel", "").lower().split() and self.canonical is None:
            self.canonical = a.get("href", "").strip() or None
        elif tag == "h1":
            self.h1 += 1
        elif tag == "img":
            self.img_total += 1
            if a.get("alt", "").strip():
                self.img_alt += 1
        elif tag == "script":
            if "ld+json" in a.get("type", "").lower():
                self._ld = True
                self._ld_buf = []
            else:
                self._skip += 1
        elif tag in ("style", "noscript", "svg"):
            self._skip += 1

    def handle_endtag(self, tag):
        if tag == "title" and self._in_title:
            self._in_title = False
            self.title = re.sub(r"\s+", " ", "".join(self._title_buf)).strip()
        elif tag == "script":
            if self._ld:
                self._ld = False
                self.ld_blocks.append("".join(self._ld_buf))
            elif self._skip:
                self._skip -= 1
        elif tag in ("style", "noscript", "svg") and self._skip:
            self._skip -= 1

    def handle_data(self, data):
        if self._in_title:
            self._title_buf.append(data)
        elif self._ld:
            self._ld_buf.append(data)
        elif not self._skip:
            self.words += len(re.findall(r"[A-Za-z0-9À-ɏ']{2,}", data))


def _ld_types(blocks: list[str]) -> list[str]:
    out: list[str] = []

    def walk(v):
        if isinstance(v, dict):
            t = v.get("@type")
            for x in t if isinstance(t, list) else [t]:
                if isinstance(x, str) and x not in out:
                    out.append(x)
            for k in ("@graph", "mainEntity", "itemListElement", "hasMenu", "hasMenuSection", "hasMenuItem"):
                if k in v:
                    walk(v[k])
        elif isinstance(v, list):
            for x in v:
                walk(x)

    for b in blocks:
        try:
            walk(json.loads(b))
        except ValueError:
            continue
    return out


def parse_html(html: str, url: str, site_domain: str) -> dict:
    p = _Parser()
    try:
        p.feed(html)
        p.close()
    except Exception:  # malformed HTML: keep whatever was read
        pass
    canonical = urljoin(url, p.canonical) if p.canonical else None
    return {
        "title": (p.title or None) and p.title[:600],
        "meta_description": p.meta_description or None,
        "h1_count": p.h1,
        "canonical": canonical[:1000] if canonical else None,
        "noindex": any("noindex" in r for r in p.robots),
        "word_count": p.words,
        "img_total": p.img_total,
        "img_with_alt": p.img_alt,
        "schema_types": _ld_types(p.ld_blocks)[:30],
    }


async def fetch(http: httpx.AsyncClient, url: str) -> dict:
    """{"status_code", "final_url", "html", "error", "x_robots_noindex"}"""
    try:
        r = await http.get(url, headers={"User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml"}, follow_redirects=True, timeout=20.0)
    except httpx.HTTPError as exc:
        return {"status_code": None, "final_url": None, "html": "", "error": f"Couldn't reach the page ({exc.__class__.__name__})."}
    ctype = r.headers.get("content-type", "")
    html = r.text[:MAX_BYTES] if ("html" in ctype or not ctype) else ""
    return {
        "status_code": r.status_code,
        "final_url": str(r.url),
        "html": html,
        "error": None,
        "x_robots_noindex": "noindex" in r.headers.get("x-robots-tag", "").lower(),
    }


def page_issues(p: PageFacts) -> list[dict]:
    """Issues on one checked page. Severity follows the Intelligence scale."""
    if not p.checked:
        return []
    out: list[dict] = []

    def add(code: str, sev: str, label: str):
        out.append({"code": code, "severity": sev, "label": label})

    if p.broken:
        add("http_error", "S1" if p.clicks > 0 or p.page_type == "home" else "S2", p.crawl_error or f"Returns HTTP {p.status_code}")
        return out
    if p.noindex:
        add("noindex", "S2", "Set to noindex — Google won't show it")
    if p.canonical_offsite:
        add("canonical_offsite", "S2", "Canonical points to another domain")
    if p.not_indexed:
        add("not_indexed", "S2", f"Not indexed by Google{f' ({p.coverage_state})' if p.coverage_state else ''}")
    t = (p.title or "").strip()
    if not t:
        add("title_missing", "S2", "No title tag")
    elif len(t) > TITLE_MAX:
        add("title_long", "S3", f"Title is {len(t)} characters (over {TITLE_MAX})")
    m = (p.meta_description or "").strip()
    if not m:
        add("meta_missing", "S3", "No meta description")
    elif len(m) > META_MAX:
        add("meta_long", "S3", f"Meta description is {len(m)} characters (over {META_MAX})")
    if p.h1_count == 0:
        add("h1_missing", "S3", "No H1 heading")
    elif (p.h1_count or 0) > 1:
        add("h1_multiple", "S3", f"{p.h1_count} H1 headings")
    if (p.img_total or 0) >= 3 and (p.img_with_alt or 0) / (p.img_total or 1) < 0.8:
        add("img_alt_low", "S3", f"Alt text on {p.img_with_alt} of {p.img_total} images")
    if p.page_type not in ("home",) and p.word_count is not None and p.word_count < THIN_WORDS:
        add("thin_content", "S3", f"Only {p.word_count} words")
    if p.psi_score is not None and p.psi_score < 50:
        add("psi_slow", "S2", f"Mobile PageSpeed {p.psi_score}/100")
    if p.cwv == "fail":
        add("cwv_fail", "S2", "Core Web Vitals failing for real visitors")
    return out


def facts_from_fetch(url: str, site_domain: str, got: dict) -> dict:
    """Columns for seo_page from one fetch()."""
    base = {"status_code": got["status_code"], "final_url": (got.get("final_url") or "")[:1000] or None, "crawl_error": got["error"]}
    if got["error"] or not got["html"]:
        return {**base, "title": None, "meta_description": None, "h1_count": None, "canonical": None,
                "noindex": got.get("x_robots_noindex") or None, "word_count": None, "img_total": None, "img_with_alt": None, "schema_types": []}
    parsed = parse_html(got["html"], got.get("final_url") or url, site_domain)
    if got.get("x_robots_noindex"):
        parsed["noindex"] = True
    return {**base, **parsed}


def canonical_offsite(canonical: Optional[str], site_domain: str) -> bool:
    if not canonical:
        return False
    h = host_of(canonical)
    return bool(h) and h != site_domain and not h.endswith("." + site_domain)
