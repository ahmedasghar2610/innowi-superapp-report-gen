"""Merchants → Import from XLS / CSV.

Reads the "Merchants" sheet of the Merchant Profile System workbook (the
layout scripts/import_xlsx.py was written for: Merchant ID, Restaurant Name
(DBA), Legal Name, Package, … Notes), as .xlsx or a .csv export of that sheet,
and turns every row into a plan before anything is written:

  * a row is matched to an existing merchant on Merchant ID (merchant_code),
    then on the exact restaurant name (case ignored). Several merchants with
    that name → the row is not imported and the preview says why;
  * every field is compared with what the Super App already has:
        new       the merchant doesn't exist yet: it is created with it
        fill      the app has nothing there: the sheet value is added
        same      identical: nothing to do
        conflict  both have a value and they differ: the app's value is KEPT
                  unless the person importing picks "use sheet value"
  * lists (keywords, competitors) only ever gain the entries that are new;
    a contact role the merchant doesn't have yet is added. Nothing is deleted.

`plan()` never writes. `apply()` builds the same plan inside the request's
transaction and writes it, taking the sheet value for a conflict only when
its key is in `use_sheet` (or its merchant is in `use_sheet_all`). Columns the
importer doesn't know (e.g. "Multi-Location?") are ignored and listed.

The whole "Online Ordering" text is kept as it is; the Innowi ordering links
inside it are reported per row (menu_extractor.find_innowi_links) so the
preview can say whether the menu can be fetched.
"""
from __future__ import annotations

import csv
import datetime as dt
import enum
import io
import re
from dataclasses import dataclass, field
from typing import Any, Callable, Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.catalog import Package
from app.models.sources import detail as source_detail
from app.models.enums import AccountHealth, ContactRole, KeywordType, PackageStatus, PreferredChannel, Responsiveness, YesNo
from app.models.profiling import (
    AccountManager,
    BrandProfile,
    CateringProfile,
    Competitor,
    Contact,
    Keyword,
    Location,
    Merchant,
    Subscription,
)
from app.modules.merchant_profiling import menu_extractor as mx

MAX_ROWS = 2000
MAX_BYTES = 10 * 1024 * 1024
SHEET_NAME = "Merchants"
NAME_COL = "Restaurant Name (DBA)"
CODE_COL = "Merchant ID"

# Same "no value" rule as scripts/import_xlsx.py.
BAD_RE = re.compile(r"^(confirm|on-?going|none|n/a|not advertised.*|null|-)?$", re.IGNORECASE)


class ImportError_(ValueError):
    """A file that can't be read as a Merchants sheet (str(exc) says why)."""


# ============================================================ parsing ====


def s(v: Any) -> Optional[str]:
    if v is None:
        return None
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    text = str(v).strip()
    if text == "" or BAD_RE.match(text):
        return None
    return text


def num(v: Any) -> Optional[float]:
    text = s(v)
    if text is None:
        return None
    cleaned = re.sub(r"[^0-9.\-]", "", text)
    try:
        return float(cleaned)
    except ValueError:
        return None


def as_int(v: Any) -> Optional[int]:
    n = num(v)
    return int(n) if n is not None else None


def as_date(v: Any) -> Optional[dt.datetime]:
    if isinstance(v, dt.datetime):
        return v if v.tzinfo else v.replace(tzinfo=dt.timezone.utc)
    if isinstance(v, dt.date):
        return dt.datetime.combine(v, dt.time(), tzinfo=dt.timezone.utc)
    text = s(v)
    if text is None:
        return None
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%d/%m/%Y", "%Y/%m/%d"):
        try:
            return dt.datetime.strptime(text[:10], fmt).replace(tzinfo=dt.timezone.utc)
        except ValueError:
            continue
    try:
        d = dt.datetime.fromisoformat(text)
        return d if d.tzinfo else d.replace(tzinfo=dt.timezone.utc)
    except ValueError:
        return None


def yes_no(v: Any) -> Optional[YesNo]:
    text = s(v)
    if text is None:
        return None
    if re.match(r"^yes", text, re.IGNORECASE):
        return YesNo.YES
    if re.match(r"^no\b", text, re.IGNORECASE):
        return YesNo.NO
    if re.match(r"^partial", text, re.IGNORECASE):
        return YesNo.PARTIAL
    if re.match(r"^unknown", text, re.IGNORECASE):
        return YesNo.UNKNOWN
    return None


def channel_of(v: Any) -> Optional[PreferredChannel]:
    text = (s(v) or "").lower()
    for word, ch in (("whatsapp", PreferredChannel.WHATSAPP), ("email", PreferredChannel.EMAIL), ("sms", PreferredChannel.SMS),
                     ("text", PreferredChannel.SMS), ("phone", PreferredChannel.PHONE)):
        if word in text:
            # "Phone - no email published" is a phone person, not an e-mail one.
            if word == "email" and re.search(r"no (working )?email", text):
                continue
            return ch
    return None


def responsiveness_of(v: Any) -> Optional[Responsiveness]:
    text = (s(v) or "").lower()
    if "very slow" in text:
        return Responsiveness.VERY_SLOW
    for word, r in (("slow", Responsiveness.SLOW), ("normal", Responsiveness.NORMAL), ("fast", Responsiveness.FAST)):
        if re.search(rf"\b{word}\b", text):
            return r
    return None


HEALTH = {"green": AccountHealth.GREEN, "yellow": AccountHealth.YELLOW, "red": AccountHealth.RED}
PKG_STATUS = {"onboarding": PackageStatus.ONBOARDING, "active": PackageStatus.ACTIVE, "paused": PackageStatus.PAUSED,
              "at risk": PackageStatus.AT_RISK, "churned": PackageStatus.CHURNED}


def enum_of(mapping: dict) -> Callable[[Any], Any]:
    def parse(v: Any):
        text = s(v)
        return mapping.get(text.lower()) if text else None
    return parse


def split_list(v: Any) -> list[str]:
    text = s(v) or ""
    out: list[str] = []
    for x in re.split(r"[;\n]", text):
        x = x.strip()
        if x and not BAD_RE.match(x) and x.lower() not in {o.lower() for o in out}:
            out.append(x)
    return out


# ============================================================== specs ====


@dataclass(frozen=True)
class Spec:
    key: str  # entity.attr — stable id used for decisions
    label: str  # the sheet's column name
    column: str
    parse: Callable[[Any], Any]
    group: str


def _sp(entity: str, attr: str, column: str, parse=s, group: str = "Profile") -> Spec:
    return Spec(f"{entity}.{attr}", column, column, parse, group)


SPECS: list[Spec] = [
    _sp("merchant", "legal_name", "Legal Name"),
    _sp("merchant", "cuisine_category", "Cuisine / Category"),
    _sp("merchant", "website_url", "Website URL", group="Online"),
    _sp("merchant", "website_platform", "Website Platform", group="Online"),
    _sp("merchant", "online_ordering", "Online Ordering", group="Online"),
    _sp("merchant", "pos_system", "POS System", group="Online"),
    _sp("merchant", "customer_list_source", "Customer List Source", group="Online"),
    _sp("merchant", "business_goals", "Business Goals", group="Marketing"),
    _sp("merchant", "target_audience", "Target Audience", group="Marketing"),
    _sp("merchant", "slow_dayparts", "Slow Days / Dayparts", group="Marketing"),
    _sp("merchant", "seasonal_peaks", "Seasonal Peaks", group="Marketing"),
    _sp("merchant", "alcohol_license", "Alcohol License?", yes_no),
    _sp("merchant", "dietary_certs", "Dietary Certifications"),
    _sp("merchant", "location_count", "# of Locations", as_int),
    _sp("merchant", "report_frequency", "Report Frequency", group="Reporting"),
    _sp("merchant", "report_recipients", "Report Recipients", group="Reporting"),
    _sp("merchant", "account_health", "Account Health", enum_of(HEALTH), group="Account"),
    _sp("merchant", "next_action", "Next Action", group="Account"),
    _sp("merchant", "open_blockers", "Open Blockers", group="Account"),
    _sp("merchant", "notes", "Notes", group="Account"),
    _sp("merchant", "onboarding_date", "Onboarding Date", as_date, group="Account"),
    _sp("merchant", "go_live_date", "Go-Live Date", as_date, group="Account"),
    _sp("merchant", "account_manager", "Account Manager", group="Account"),
    _sp("subscription", "package_code", "Package", group="Package"),
    _sp("subscription", "status", "Package Status", enum_of(PKG_STATUS), group="Package"),
    _sp("subscription", "start_date", "Start Date", as_date, group="Package"),
    _sp("subscription", "renewal_date", "Renewal Date", as_date, group="Package"),
    _sp("subscription", "mrr", "MRR", num, group="Package"),
    _sp("location", "address", "Address", group="Location"),
    _sp("location", "city", "City", group="Location"),
    _sp("location", "state", "State", group="Location"),
    _sp("location", "zip", "ZIP", group="Location"),
    _sp("location", "hours", "Hours", group="Location"),
    _sp("contact:OWNER", "name", "Owner Name", group="Contacts"),
    _sp("contact:OWNER", "email", "Owner Email", group="Contacts"),
    _sp("contact:OWNER", "phone", "Owner Phone", group="Contacts"),
    _sp("contact:OWNER", "preferred_channel", "Preferred Channel", channel_of, group="Contacts"),
    _sp("contact:OWNER", "language", "Language", group="Contacts"),
    _sp("contact:OWNER", "responsiveness", "Approval Responsiveness", responsiveness_of, group="Contacts"),
    _sp("contact:MARKETING", "name", "Marketing Contact", group="Contacts"),
    _sp("contact:CONTENT_APPROVER", "name", "Content Approver", group="Contacts"),
    _sp("contact:BILLING", "name", "Billing Contact", group="Contacts"),
    _sp("contact:CATERING", "name", "Catering Contact", group="Contacts"),
    _sp("catering", "offered", "Catering Offered?", yes_no, group="Catering"),
    _sp("catering", "contact", "Catering Contact", group="Catering"),
    _sp("catering", "lead_flow", "Catering Lead Flow", group="Catering"),
    _sp("catering", "min_order", "Catering Min Order", group="Catering"),
    _sp("catering", "notes", "Catering Notes", group="Catering"),
    _sp("brand", "logo_vector", "Logo (vector)?", yes_no, group="Brand"),
    _sp("brand", "brand_colors", "Brand Colors", group="Brand"),
    _sp("brand", "brand_fonts", "Brand Fonts", group="Brand"),
    _sp("brand", "photo_library_status", "Photo Library Status", group="Brand"),
    _sp("brand", "menu_format", "Menu Format", group="Brand"),
    _sp("brand", "signature_dishes", "Signature Dishes", group="Brand"),
    _sp("brand", "tone_of_voice", "Tone of Voice", group="Brand"),
    _sp("brand", "do_not_say", "Do-Not-Say List", group="Brand"),
    _sp("brand", "content_restrictions", "Content Restrictions", group="Brand"),
]
KEYWORD_COLS = (("Primary Keywords", KeywordType.PRIMARY), ("Secondary Keywords", KeywordType.SECONDARY), ("Location Keywords", KeywordType.LOCATION))
COMPETITOR_COLS = ("Competitor 1", "Competitor 2", "Competitor 3")
KNOWN = {CODE_COL, NAME_COL, *(sp.column for sp in SPECS), *(c for c, _ in KEYWORD_COLS), *COMPETITOR_COLS}
CONTACT_ROLES = {"contact:" + r.value: r for r in ContactRole}


def norm_header(h: Any) -> str:
    return re.sub(r"\s+", " ", str(h or "").replace("﻿", "")).strip().lower()


KNOWN_BY_NORM = {norm_header(c): c for c in KNOWN}


def norm_name(v: Optional[str]) -> str:
    return re.sub(r"\s+", " ", (v or "")).strip().casefold()


def is_real_merchant(name: Optional[str]) -> bool:
    return bool(name) and not re.match(r"^example", name, re.IGNORECASE) and not re.search(r"bella napoli", name, re.IGNORECASE)


@dataclass
class Sheet:
    rows: list[tuple[int, dict]]  # (sheet row number, {canonical column: raw value})
    unknown_columns: list[str]
    sheet: Optional[str]


def read_file(data: bytes, filename: str) -> Sheet:
    """The Merchants sheet as (row number, {column: value}) pairs, header row found by its column names."""
    if len(data) > MAX_BYTES:
        raise ImportError_("The file is larger than 10 MB.")
    name = (filename or "").lower()
    if name.endswith(".csv") or not data.startswith(b"PK"):
        try:
            text = data.decode("utf-8-sig")
        except UnicodeDecodeError:
            text = data.decode("cp1252", errors="replace")
        grid = list(csv.reader(io.StringIO(text)))
        sheet_name = None
    else:
        import openpyxl

        try:
            wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
        except Exception as exc:  # noqa: BLE001 - any parse error is "not a workbook"
            raise ImportError_("That file isn't a readable .xlsx workbook.") from exc
        names = wb.sheetnames
        order = ([SHEET_NAME] if SHEET_NAME in names else []) + [n for n in names if n != SHEET_NAME]
        grid, sheet_name = [], None
        for n in order:
            if "promo" in n.lower():
                continue  # the Promotions sheet: promotions_import.py
            g = [list(r) for r in wb[n].iter_rows(values_only=True, max_row=MAX_ROWS + 20)]
            if _header_index(g) is not None:
                grid, sheet_name = g, n
                break
        wb.close()
    hi = _header_index(grid)
    if hi is None:
        raise ImportError_(f"Couldn't find the header row: the sheet needs a \"{NAME_COL}\" column (and ideally \"{CODE_COL}\").")
    headers = [norm_header(h) for h in grid[hi]]
    canon = [KNOWN_BY_NORM.get(h) for h in headers]
    unknown = [str(grid[hi][i]).strip() for i, c in enumerate(canon) if c is None and headers[i]]
    rows: list[tuple[int, dict]] = []
    for offset, raw in enumerate(grid[hi + 1:], start=hi + 2):
        rec = {c: (raw[i] if i < len(raw) else None) for i, c in enumerate(canon) if c}
        if not any(s(v) for v in rec.values()):
            continue  # blank line
        rows.append((offset, rec))
        if len(rows) > MAX_ROWS:
            raise ImportError_(f"More than {MAX_ROWS} merchant rows; split the file.")
    return Sheet(rows=rows, unknown_columns=unknown, sheet=sheet_name)


def _header_index(grid: list[list]) -> Optional[int]:
    for i, row in enumerate(grid[:15]):
        hs = {norm_header(c) for c in row}
        if norm_header(NAME_COL) in hs:
            return i
    return None


# =============================================================== plan ====


def display(v: Any) -> Optional[str]:
    if v is None:
        return None
    if isinstance(v, enum.Enum):
        return str(v.value)
    if isinstance(v, dt.datetime):
        return v.date().isoformat()
    if isinstance(v, dt.date):
        return v.isoformat()
    if isinstance(v, float) or (hasattr(v, "is_finite") and not isinstance(v, int)):  # float / Decimal
        f = float(v)
        return str(int(f)) if f.is_integer() else f"{f:.2f}"
    return str(v)


def same(a: Any, b: Any) -> bool:
    da, db_ = display(a), display(b)
    if da is None or db_ is None:
        return da == db_
    return re.sub(r"\s+", " ", da).strip().casefold() == re.sub(r"\s+", " ", db_).strip().casefold()


@dataclass
class Existing:
    merchant: Optional[Merchant] = None
    am_name: Optional[str] = None
    subscription: Optional[Subscription] = None
    location: Optional[Location] = None
    brand: Optional[BrandProfile] = None
    catering: Optional[CateringProfile] = None
    contacts: dict[str, Contact] = field(default_factory=dict)  # role → first contact
    keywords: dict[str, set[str]] = field(default_factory=dict)  # type → lowercased terms
    competitors: set[str] = field(default_factory=set)
    competitor_ranks: set[int] = field(default_factory=set)


async def _existing(db: AsyncSession, m: Merchant) -> Existing:
    ex = Existing(merchant=m)
    if m.account_manager_id:
        am = await db.get(AccountManager, m.account_manager_id)
        ex.am_name = am.name if am else None
    ex.subscription = (await db.execute(select(Subscription).where(Subscription.merchant_id == m.id))).scalar_one_or_none()
    locs = (await db.execute(select(Location).where(Location.merchant_id == m.id).order_by(Location.is_primary.desc(), Location.created_at))).scalars().all()
    ex.location = locs[0] if locs else None
    ex.brand = await db.get(BrandProfile, m.id)
    ex.catering = await db.get(CateringProfile, m.id)
    for c in (await db.execute(select(Contact).where(Contact.merchant_id == m.id).order_by(Contact.created_at))).scalars():
        ex.contacts.setdefault("contact:" + c.role.value, c)
    for k in (await db.execute(select(Keyword).where(Keyword.merchant_id == m.id))).scalars():
        ex.keywords.setdefault(k.type.value, set()).add(k.term.strip().casefold())
    for c in (await db.execute(select(Competitor).where(Competitor.merchant_id == m.id))).scalars():
        ex.competitors.add(c.name.strip().casefold())
        if c.rank:
            ex.competitor_ranks.add(c.rank)
    return ex


def _current(ex: Existing, sp: Spec) -> Any:
    entity, attr = sp.key.split(".", 1)
    if entity == "merchant":
        if attr == "account_manager":
            return ex.am_name
        return getattr(ex.merchant, attr) if ex.merchant else None
    obj = {"subscription": ex.subscription, "location": ex.location, "brand": ex.brand, "catering": ex.catering}.get(entity)
    if entity.startswith("contact:"):
        obj = ex.contacts.get(entity)
    return getattr(obj, attr, None) if obj is not None else None


async def _match(db: AsyncSession, code: Optional[str], name: str) -> tuple[Optional[Merchant], Optional[str], list[str]]:
    """(merchant, reason it can't be imported, warnings)."""
    warnings: list[str] = []
    if code:
        m = (await db.execute(select(Merchant).where(Merchant.merchant_code == code))).scalar_one_or_none()
        if m:
            if norm_name(m.restaurant_name) != norm_name(name):
                warnings.append(f"Merchant ID {code} is \"{m.restaurant_name}\" in the Super App, \"{name}\" in the sheet.")
            return m, None, warnings
    by_name = (await db.execute(select(Merchant).where(func.lower(func.trim(Merchant.restaurant_name)) == name.strip().lower()))).scalars().all()
    if code:
        free = [m for m in by_name if not m.merchant_code]
        if len(free) == 1:
            return free[0], None, warnings  # same restaurant, its Merchant ID gets filled in
        if by_name:
            warnings.append(f"A merchant named \"{name}\" already exists with another Merchant ID; this row creates a new one.")
        return None, None, warnings
    if len(by_name) > 1:
        return None, f"{len(by_name)} merchants are called \"{name}\" in the Super App; add a Merchant ID to the row to pick one.", warnings
    return (by_name[0] if by_name else None), None, warnings


def _row_key(code: Optional[str], rownum: int) -> str:
    return code or f"row{rownum}"


async def plan(db: AsyncSession, sheet: Sheet, packages: Optional[set[str]] = None) -> dict:
    """The preview: what an import of `sheet` would do. Writes nothing."""
    if packages is None:
        packages = set((await db.execute(select(Package.code))).scalars())
    out_rows: list[dict] = []
    seen: dict[str, int] = {}
    totals = {"rows": len(sheet.rows), "create": 0, "update": 0, "unchanged": 0, "skip": 0, "conflicts": 0, "fills": 0, "adds": 0}
    for rownum, rec in sheet.rows:
        name = s(rec.get(NAME_COL))
        code = s(rec.get(CODE_COL))
        row: dict = {"row": rownum, "key": _row_key(code, rownum), "merchantCode": code, "restaurantName": name, "merchantId": None,
                     "action": "skip", "reason": None, "fields": [], "adds": [], "sameCount": 0, "warnings": [], "menu": None}
        if not is_real_merchant(name):
            row["reason"] = "No restaurant name." if not name else "Example row from the template."
            totals["skip"] += 1
            out_rows.append(row)
            continue
        dup_key = code or norm_name(name)
        if dup_key in seen:
            row["reason"] = f"Same merchant as row {seen[dup_key]} in this file."
            totals["skip"] += 1
            out_rows.append(row)
            continue
        seen[dup_key] = rownum
        m, reason, warns = await _match(db, code, name)
        row["warnings"] += warns
        if reason:
            row["reason"] = reason
            totals["skip"] += 1
            out_rows.append(row)
            continue
        ex = await _existing(db, m) if m else Existing()
        row["merchantId"] = m.id if m else None
        creating = m is None
        if m and code and not m.merchant_code:
            row["fields"].append({"key": "merchant.merchant_code", "label": CODE_COL, "group": "Profile", "current": None, "incoming": code, "status": "fill"})

        confirm_cols: list[str] = []
        for sp in SPECS:
            raw = rec.get(sp.column)
            incoming = sp.parse(raw)
            if incoming is None:
                continue
            if isinstance(incoming, str) and re.search(r"\bCONFIRM\b", incoming):
                confirm_cols.append(sp.column)
            if sp.key == "subscription.package_code" and incoming not in packages:
                row["warnings"].append(f"Package \"{incoming}\" isn't in the catalog ({', '.join(sorted(packages)) or 'empty'}); the package wasn't imported.")
                continue
            if sp.key.startswith("subscription.") and ex.subscription is None and s(rec.get("Package")) not in packages:
                continue  # no package to attach a status / date / MRR to
            cur = _current(ex, sp)
            if creating:
                status = "new"
            elif cur is None or (isinstance(cur, str) and not cur.strip()):
                status = "fill"
            elif same(cur, incoming):
                row["sameCount"] += 1
                continue
            else:
                status = "conflict"
            row["fields"].append({"key": sp.key, "label": sp.label, "group": sp.group, "current": display(cur), "incoming": display(incoming), "status": status})
        if confirm_cols:
            row["warnings"].append("Has CONFIRM notes in: " + ", ".join(confirm_cols) + " (kept as text).")

        for col, ktype in KEYWORD_COLS:
            have = ex.keywords.get(ktype.value, set())
            for term in split_list(rec.get(col)):
                if term.casefold() not in have:
                    row["adds"].append({"key": f"keyword.{ktype.value}", "label": col, "value": term})
        for i, col in enumerate(COMPETITOR_COLS, start=1):
            cname = s(rec.get(col))
            if cname and cname.casefold() not in ex.competitors:
                row["adds"].append({"key": "competitor", "label": col, "value": cname, "rank": i})

        ordering = s(rec.get("Online Ordering"))
        links = mx.find_innowi_links(ordering) if ordering else []
        row["menu"] = {"status": "ready" if len(links) == 1 else "pick" if links else "none", "links": [mx.ordering_link(x) for x in links]}

        n_conf = sum(1 for f in row["fields"] if f["status"] == "conflict")
        n_fill = sum(1 for f in row["fields"] if f["status"] in ("fill", "new"))
        totals["conflicts"] += n_conf
        totals["fills"] += n_fill
        totals["adds"] += len(row["adds"])
        if creating:
            row["action"] = "create"
            totals["create"] += 1
        elif row["fields"] or row["adds"]:
            row["action"] = "update"
            totals["update"] += 1
        else:
            row["action"] = "unchanged"
            totals["unchanged"] += 1
        out_rows.append(row)
    return {"sheet": sheet.sheet, "unknownColumns": sheet.unknown_columns, "totals": totals, "rows": out_rows}


# ============================================================== apply ====


async def _account_manager(db: AsyncSession, name: str) -> AccountManager:
    am = (await db.execute(select(AccountManager).where(func.lower(func.trim(AccountManager.name)) == name.strip().lower()))).scalars().first()
    if am:
        return am
    email = f"{name.strip().lower()}@innowi.local"  # scripts/import_xlsx.py's convention
    am = (await db.execute(select(AccountManager).where(AccountManager.email == email))).scalar_one_or_none()
    if am:
        return am
    am = AccountManager(name=name.strip(), email=email)
    db.add(am)
    await db.flush()
    return am


async def apply(db: AsyncSession, sheet: Sheet, use_sheet: set[str], use_sheet_all: set[str],
                file_name: Optional[str] = None) -> dict:
    """Write the plan. Conflicts take the sheet value only when chosen. Returns the plan with what was done."""
    packages = set((await db.execute(select(Package.code))).scalars())
    result = await plan(db, sheet, packages)
    recs = {_row_key(s(r.get(CODE_COL)), n): r for n, r in sheet.rows}
    done = {"created": 0, "updated": 0, "fieldsWritten": 0, "conflictsKept": 0, "conflictsReplaced": 0, "added": 0, "merchantIds": []}
    for row in result["rows"]:
        if row["action"] not in ("create", "update"):
            continue
        rec = recs[row["key"]]
        taken = [f for f in row["fields"] if f["status"] in ("new", "fill")
                 or (f["status"] == "conflict" and (row["key"] in use_sheet_all or f"{row['key']}::{f['key']}" in use_sheet))]
        done["conflictsKept"] += sum(1 for f in row["fields"] if f["status"] == "conflict") - sum(1 for f in taken if f["status"] == "conflict")
        done["conflictsReplaced"] += sum(1 for f in taken if f["status"] == "conflict")
        for f in row["fields"]:
            f["applied"] = f in taken

        if row["action"] == "create":
            m = Merchant(restaurant_name=row["restaurantName"], merchant_code=row["merchantCode"],
                         source="MERCHANT_IMPORT", source_detail=source_detail(file_name))
            db.add(m)
            await db.flush()
            done["created"] += 1
        else:
            m = await db.get(Merchant, row["merchantId"])
            done["updated"] += 1
        row["merchantId"] = m.id
        done["merchantIds"].append(m.id)
        ex = await _existing(db, m)
        specs = {sp.key: sp for sp in SPECS}
        for f in taken:
            if f["key"] == "merchant.merchant_code":
                m.merchant_code = f["incoming"]
                done["fieldsWritten"] += 1
                continue
            sp = specs[f["key"]]
            value = sp.parse(rec.get(sp.column))
            entity, attr = sp.key.split(".", 1)
            target = await _target(db, m, ex, entity, rec)
            if target is None:
                continue
            if sp.key == "merchant.account_manager":
                m.account_manager_id = (await _account_manager(db, value)).id
            else:
                setattr(target, attr, value)
            done["fieldsWritten"] += 1
        if ex.location is not None and any(f["key"].startswith("location.") for f in taken):
            if any("CONFLICT" in (s(rec.get(c)) or "").upper() for c in ("Address", "City", "State", "ZIP", "Hours")):
                ex.location.nap_status = "CONFLICT"
        next_rank = max(ex.competitor_ranks or {0}) + 1
        for a in row["adds"]:
            if a["key"] == "competitor":
                rank = a["rank"] if a["rank"] not in ex.competitor_ranks else next_rank
                ex.competitor_ranks.add(rank)
                next_rank = max(next_rank, rank + 1)
                db.add(Competitor(merchant_id=m.id, name=a["value"], rank=rank))
            else:
                db.add(Keyword(merchant_id=m.id, term=a["value"], type=KeywordType(a["key"].split(".", 1)[1])))
            done["added"] += 1
        await db.flush()
    result["applied"] = done
    return result


async def _target(db: AsyncSession, m: Merchant, ex: Existing, entity: str, rec: dict):
    """The object a field is written to, created when the merchant doesn't have it yet."""
    if entity == "merchant":
        return m
    if entity == "subscription":
        if ex.subscription is None:
            code = s(rec.get("Package"))
            if not code:
                return None  # a package status / date without a package: nothing to attach it to
            ex.subscription = Subscription(merchant_id=m.id, package_code=code,
                                           status=enum_of(PKG_STATUS)(rec.get("Package Status")) or PackageStatus.ONBOARDING)
            db.add(ex.subscription)
        return ex.subscription
    if entity == "location":
        if ex.location is None:
            ex.location = Location(merchant_id=m.id, is_primary=True)
            db.add(ex.location)
        return ex.location
    if entity == "brand":
        if ex.brand is None:
            ex.brand = BrandProfile(merchant_id=m.id)
            db.add(ex.brand)
        return ex.brand
    if entity == "catering":
        if ex.catering is None:
            ex.catering = CateringProfile(merchant_id=m.id)
            db.add(ex.catering)
        return ex.catering
    if entity in CONTACT_ROLES:
        c = ex.contacts.get(entity)
        if c is None:
            c = Contact(merchant_id=m.id, role=CONTACT_ROLES[entity])
            db.add(c)
            ex.contacts[entity] = c
        return c
    return None
