"""Extra Screaming Frog exports that fill the site page's "Not measured yet" rows.

Both are optional: if the files aren't in the export folder the values stay
Pending, never estimated.

  link_metrics_all.csv       --export-tabs "Link Metrics:All". Needs a link-data API
                             connected inside Screaming Frog (Configuration → API Access:
                             Moz, Majestic or Ahrefs). Column names differ by provider and
                             version, so columns are matched by keyword.
  custom_extraction_all.csv  --export-tabs "Custom Extraction:All". Free: extractors set
                             up once in Screaming Frog (Configuration → Custom → Extraction)
                             and saved in the crawl config. Extractor names decide what a
                             column is: "Phone…", "Street…" / "Address…", "Hours…".

compare_nap() checks what the website says against the linked Google Business
Profile listing (phone, street address, opening hours). Pure functions; the
importer stores the parsed values in seo_crawl.totals (no schema change).
"""
from __future__ import annotations

import csv
import re
from pathlib import Path
from typing import Optional
from urllib.parse import unquote, urlparse

# Columns every Screaming Frog tab export has; anything else in the custom extraction file is an extractor.
STANDARD_COLS = {"address", "status code", "status", "indexability", "indexability status", "content type", "content"}

# keyword (normalised header) → (field, provider). First match wins, so specific names come first.
LINK_COLS: list[tuple[str, str, str]] = [
    ("domainauthority", "authority", "Moz"),
    ("pageauthority", "pageAuthority", "Moz"),
    ("spamscore", "spamScore", "Moz"),
    ("rootdomainslinking", "referringDomains", "Moz"),
    ("totalexternallinks", "backlinks", "Moz"),
    ("externallinks", "backlinks", "Moz"),
    ("trustflow", "authority", "Majestic"),
    ("citationflow", "citationFlow", "Majestic"),
    ("referringdomains", "referringDomains", "Majestic"),
    ("externalbacklinks", "backlinks", "Majestic"),
    ("domainrating", "authority", "Ahrefs"),
    ("urlrating", "pageAuthority", "Ahrefs"),
    ("refdomains", "referringDomains", "Ahrefs"),
    ("backlinks", "backlinks", "Ahrefs"),
]
AUTHORITY_LABEL = {"Moz": "Domain Authority", "Majestic": "Trust Flow", "Ahrefs": "Domain Rating"}


def _norm(h: str) -> str:
    return re.sub(r"[^a-z0-9]", "", h.lower())


def _num(v) -> Optional[float]:
    try:
        s = str(v).replace(",", "").strip()
        return float(s) if s not in ("", "-") else None
    except ValueError:
        return None


def _read(path: Path) -> list[dict]:
    with path.open(encoding="utf-8-sig", newline="", errors="replace") as f:
        return list(csv.DictReader(f))


def _find(folder: Path, name: str) -> Optional[Path]:
    p = folder / name
    if p.exists():
        return p
    hits = sorted(folder.rglob(name))
    return hits[0] if hits else None


def _path(url: str) -> str:
    return urlparse(url).path or "/"


# ------------------------------------------------------------- link metrics ----

def parse_link_metrics(folder: Path, home_url: Optional[str]) -> Optional[dict]:
    """{"provider", "authorityLabel", "authority", "referringDomains", "backlinks", "pageAuthorityHome",
    "pages", "top": [{"path", "referringDomains", "backlinks"}]} or None when no link metrics were exported.

    Screaming Frog reports each metric per URL and for wider scopes (exact URL, subdomain, domain);
    the domain-wide figure is the largest, so the home page's maximum per field is used for the site."""
    path = _find(folder, "link_metrics_all.csv")
    if not path:
        return None
    rows = _read(path)
    if not rows:
        return None
    cols: dict[str, list[str]] = {}
    providers: dict[str, int] = {}
    for h in rows[0].keys():
        n = _norm(h or "")
        for kw, field, prov in LINK_COLS:
            if kw in n:
                # A header naming its provider wins over the keyword guess ("Moz External Links" etc.).
                prov = next((p for p in ("Moz", "Majestic", "Ahrefs") if p.lower() in n), prov)
                cols.setdefault(field, []).append(h)
                providers[prov] = providers.get(prov, 0) + 1
                break
    if not cols:
        return None
    provider = max(providers, key=providers.get)

    def val(row: dict, field: str) -> Optional[float]:
        vs = [_num(row.get(h)) for h in cols.get(field, [])]
        vs = [v for v in vs if v is not None]
        return max(vs) if vs else None

    home_key = _path(home_url) if home_url else "/"
    home = next((r for r in rows if _path(r.get("Address") or "") == home_key), None) or rows[0]

    def site_wide(field: str) -> Optional[float]:
        vs = [v for v in (val(r, field) for r in rows) if v is not None]
        return max(vs) if vs else None

    top = sorted(
        ({"path": _path(r.get("Address") or ""), "referringDomains": val(r, "referringDomains"), "backlinks": val(r, "backlinks")} for r in rows),
        key=lambda x: (x["referringDomains"] or 0, x["backlinks"] or 0), reverse=True,
    )
    top = [t for t in top if (t["referringDomains"] or t["backlinks"])][:10]
    as_int = lambda v: int(round(v)) if v is not None else None  # noqa: E731
    return {
        "provider": provider, "authorityLabel": AUTHORITY_LABEL[provider],
        "authority": as_int(val(home, "authority") or site_wide("authority")),
        "referringDomains": as_int(site_wide("referringDomains")), "backlinks": as_int(site_wide("backlinks")),
        "pageAuthorityHome": as_int(val(home, "pageAuthority")), "spamScore": as_int(val(home, "spamScore")),
        "pages": len(rows),
        "top": [{**t, "referringDomains": as_int(t["referringDomains"]), "backlinks": as_int(t["backlinks"])} for t in top],
    }


# ------------------------------------------------------- custom extraction ----

def _kind(extractor: str) -> Optional[str]:
    n = extractor.lower()
    if "phone" in n or n.startswith("tel"):
        return "phone"
    if "hour" in n or "open" in n:
        return "hours"
    if "street" in n or "address" in n or "location" in n:
        return "street"
    return None


def phone_digits(v: str) -> Optional[str]:
    """US-style comparison key: the last 10 digits (drops +1, tel:, spaces, dots)."""
    d = re.sub(r"\D", "", v or "")
    return d[-10:] if len(d) >= 10 else None


def parse_nap(folder: Path) -> Optional[dict]:
    """What the website itself says, from custom extraction:
    {"pages", "phones": [{"value", "digits", "pages"}], "streets": [{"value", "pages"}], "hours": [{"value", "pages"}],
     "extractors": [names]} or None when there is no custom extraction export."""
    path = _find(folder, "custom_extraction_all.csv")
    if not path:
        return None
    rows = _read(path)
    if not rows:
        return None
    extractors: dict[str, str] = {}  # column → kind
    names: list[str] = []
    for h in rows[0].keys():
        if not h or h.strip().lower() in STANDARD_COLS:
            continue
        base = re.sub(r"\s+\d+$", "", h.strip())  # "Phone 1", "Phone 2" → "Phone"
        k = _kind(base)
        if k:
            extractors[h] = k
            if base not in names:
                names.append(base)
    if not extractors:
        return {"pages": len(rows), "phones": [], "streets": [], "hours": [], "extractors": []}
    found: dict[str, dict[str, set]] = {"phone": {}, "street": {}, "hours": {}}
    for r in rows:
        url = r.get("Address") or ""
        for col, kind in extractors.items():
            v = re.sub(r"\s+", " ", unquote(r.get(col) or "").replace("tel:", "")).strip()  # tel:+1%20(510)… → +1 (510)…
            if v:
                found[kind].setdefault(v[:300], set()).add(url)

    def ranked(kind: str) -> list[dict]:
        return [{"value": v, "pages": len(u)} for v, u in sorted(found[kind].items(), key=lambda kv: -len(kv[1]))][:10]

    phones: dict[str, dict] = {}
    for v, urls in found["phone"].items():
        d = phone_digits(v)
        if d:
            p = phones.setdefault(d, {"value": v, "digits": d, "urls": set()})
            p["urls"] |= urls
    return {
        "pages": len(rows),
        "phones": [{"value": p["value"], "digits": p["digits"], "pages": len(p["urls"])} for p in sorted(phones.values(), key=lambda p: -len(p["urls"]))][:10],
        "streets": ranked("street"), "hours": ranked("hours"), "extractors": names,
    }


# ------------------------------------------------- website vs Google listing ----

DAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"]
_TIME = r"(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?"


def _minutes(h: str, m: Optional[str], ap: Optional[str]) -> Optional[int]:
    hh, mm = int(h), int(m or 0)
    ap = (ap or "").replace(".", "").lower()
    if ap == "pm" and hh < 12:
        hh += 12
    if ap == "am" and hh == 12:
        hh = 0
    if hh > 24 or mm > 59:
        return None
    return hh * 60 + mm


def time_ranges(text: str) -> set[tuple[int, int]]:
    """Every "open – close" pair in free text: "11am - 10pm", "11:00 AM – 10:00 PM", "11:00-22:00", "Mo-Th 11:00-22:00".
    A missing am/pm on the closing time borrows the opening one only when that makes the range sensible."""
    out = set()
    for m in re.finditer(_TIME + r"\s*(?:-|–|—|to|until)\s*" + _TIME, text or "", re.I):
        a = _minutes(m.group(1), m.group(2), m.group(3))
        b = _minutes(m.group(4), m.group(5), m.group(6))
        if a is None or b is None:
            continue
        if not m.group(3) and not m.group(6) and not m.group(2) and not m.group(5):
            continue  # "1-2" on its own is not a time range
        if m.group(3) and not m.group(6) and b <= a and b + 720 <= 1440:
            b += 720  # "11am - 10" → 10pm
        out.add((a, b % 1440))
    # Restaurant schema: "opens": "11:00", "closes": "22:00" (openingHoursSpecification)
    for m in re.finditer(r'"?opens"?\s*:\s*"?(\d{1,2}):(\d{2})[^"]*"?\s*,?\s*"?closes"?\s*:\s*"?(\d{1,2}):(\d{2})', text or "", re.I):
        out.add((int(m.group(1)) * 60 + int(m.group(2)), (int(m.group(3)) * 60 + int(m.group(4))) % 1440))
    return out


def gbp_ranges(regular_hours: list) -> set[tuple[int, int]]:
    out = set()
    for p in regular_hours or []:
        try:
            oh, om = (int(x) for x in str(p.get("open", "")).split(":")[:2])
            ch, cm = (int(x) for x in str(p.get("close", "")).split(":")[:2])
        except (ValueError, TypeError):
            continue
        out.add((oh * 60 + om, (ch * 60 + cm) % 1440))
    return out


def _street_key(s: str) -> Optional[str]:
    """House number + first street word, e.g. "39201 fremont" from "39201 Fremont Blvd, Fremont, CA"."""
    m = re.search(r"\b(\d{1,6})\s+([A-Za-z][A-Za-z.]*)", s or "")
    return f"{m.group(1)} {m.group(2).lower().rstrip('.')}" if m else None


def _fmt_min(v: int) -> str:
    h, m = divmod(v, 60)
    ap = "am" if h < 12 else "pm"
    h = h % 12 or 12
    return f"{h}{':%02d' % m if m else ''}{ap}"


def compare_nap(nap: Optional[dict], gbp_phone: Optional[str], gbp_street: Optional[str], gbp_hours: list) -> Optional[dict]:
    """Per item: {"state": "match" | "different" | "not_found" | "no_listing_value", "site": str, "google": str}.
    None when the crawl had no custom extraction (the rows stay Pending)."""
    if nap is None:
        return None
    out: dict[str, dict] = {}

    g = phone_digits(gbp_phone or "")
    site_digits = [p["digits"] for p in nap.get("phones", [])]
    site_phone = nap["phones"][0]["value"] if nap.get("phones") else None
    if not g:
        out["phone"] = {"state": "no_listing_value", "site": site_phone, "google": gbp_phone}
    elif not site_digits:
        out["phone"] = {"state": "not_found", "site": None, "google": gbp_phone}
    else:
        other = next((p["value"] for p in nap["phones"] if p["digits"] != g), None)
        out["phone"] = {"state": "match" if g in site_digits else "different", "site": site_phone if g not in site_digits else gbp_phone,
                        "google": gbp_phone, "other": other}

    gk = _street_key(gbp_street or "")
    streets = [s["value"] for s in nap.get("streets", [])]
    keys = {k for k in (_street_key(s) for s in streets) if k}
    if not gk:
        out["address"] = {"state": "no_listing_value", "site": streets[0] if streets else None, "google": gbp_street}
    elif not keys:
        out["address"] = {"state": "not_found", "site": None, "google": gbp_street}
    else:
        out["address"] = {"state": "match" if gk in keys else "different", "site": streets[0], "google": gbp_street}

    want = gbp_ranges(gbp_hours)
    have: set[tuple[int, int]] = set()
    for h in nap.get("hours", []):
        have |= time_ranges(h["value"])
    google = ", ".join(f"{_fmt_min(a)}–{_fmt_min(b)}" for a, b in sorted(want)) or None
    site = ", ".join(f"{_fmt_min(a)}–{_fmt_min(b)}" for a, b in sorted(have)) or None
    if not want:
        out["hours"] = {"state": "no_listing_value", "site": site, "google": None}
    elif not have:
        out["hours"] = {"state": "not_found", "site": None, "google": google}
    else:
        missing = want - have
        out["hours"] = {"state": "match" if not missing else "different", "site": site, "google": google,
                        "missing": ", ".join(f"{_fmt_min(a)}–{_fmt_min(b)}" for a, b in sorted(missing)) or None}
    return out
