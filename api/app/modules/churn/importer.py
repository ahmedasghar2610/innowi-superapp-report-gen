"""Churn workbook import.

Reads the two spreadsheets the CSM team keeps and turns every row into a
merchant with status CHURNED plus a churn record:

* the *contacts* layout (sheets like ``BA`` / ``LA``): Account Name, Location,
  Region, Cell Phone, Email of DM, Stage, Owner/ DM Name;
* the *reasons* layout (``Data Jan- Sep with MRR``): Account Name, Tier, Churn
  Date, Churn Category, Churn Reasoning, CSM Name, Solution, MRR, GPV, Region,
  Start Date, Latest Touchpoint Date, and an unnamed trailing notes column.

The header row is found by looking for an "Account Name" cell, so the month
label column, subtotal rows and "Count" rows the workbook carries are skipped.
A sheet without a recognised header is reported, not imported.

Matching: a row joins an existing merchant whose normalised name matches
(case, punctuation and the "<>" location separator ignored); when several
match, the one in the same region wins. Otherwise a merchant is created.
Re-importing is safe: sheet fields overwrite, win-back fields never change.
"""
from __future__ import annotations

import datetime as dt
import io
import re
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from typing import Any, Optional

import openpyxl
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.enums import ContactRole, MerchantStatus
from app.models.profiling import AccountManager, Contact, Location, Merchant, MerchantChurn
from app.models.sources import detail as source_detail

# header aliases → canonical field; matched on the normalised header text
HEADERS: dict[str, str] = {
    "account name": "name",
    "restaurant name": "name",
    "location": "address",
    "address": "address",
    "region": "region",
    "cell phone": "phone",
    "phone": "phone",
    "email of dm": "email",
    "email": "email",
    "stage": "stage",
    "owner dm name": "dm_name",
    "owner name": "dm_name",
    "dm name": "dm_name",
    "tier": "tier",
    "churn date": "churned_on",
    "churn category": "category",
    "churn reasoning": "reason",
    "churn reason": "reason",
    "csm name": "csm_name",
    "csm": "csm_name",
    "solution": "solution",
    "mrr": "mrr",
    "gpv": "gpv",
    "start date": "start_date",
    "latest touchpoint date": "last_touchpoint_on",
    "last touchpoint": "last_touchpoint_on",
    "notes": "note",
    "note": "note",
}
SKIP_FIRST_CELLS = {"subtotal", "total", "sum", "count"}


def _norm_header(v: Any) -> str:
    s = str(v or "").strip().lower()
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def normalise_name(name: str) -> str:
    """Key used to match a workbook row to an existing merchant."""
    s = (name or "").lower().replace("<>", " ")
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def normalise_street(addr: Optional[str]) -> str:
    """Street part of an address, normalised: '322-324 E Santa Clara St #1909' and
    '322-324 E Santa Clara St #1909, San Jose, CA 95113, United States' agree."""
    street = split_address(addr)["address"] if addr else None
    s = re.sub(r"[^a-z0-9 ]+", " ", (street or "").lower())
    return re.sub(r"\s+", " ", s).strip()


def _text(v: Any) -> Optional[str]:
    if v is None:
        return None
    if isinstance(v, (dt.datetime, dt.date)):
        return v.isoformat()
    s = str(v).replace("​", "").strip()
    return s or None


def _date(v: Any) -> Optional[dt.date]:
    if v is None or v == "":
        return None
    if isinstance(v, dt.datetime):
        return v.date()
    if isinstance(v, dt.date):
        return v
    s = str(v).strip()
    for fmt in ("%m/%d/%Y", "%m/%d/%y", "%Y-%m-%d", "%d-%b-%Y", "%b %d, %Y", "%d %b %Y"):
        try:
            return dt.datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def _money(v: Any) -> Optional[Decimal]:
    if v is None or v == "":
        return None
    if isinstance(v, (int, float, Decimal)):
        return Decimal(str(v)).quantize(Decimal("0.01"))
    s = str(v).strip().replace("$", "").replace(",", "").replace(" ", "")
    if not s:
        return None
    neg = s.startswith("(") and s.endswith(")")
    s = s.strip("()")
    try:
        d = Decimal(s)
    except InvalidOperation:
        return None
    return (-d if neg else d).quantize(Decimal("0.01"))


def _int(v: Any) -> Optional[int]:
    if v is None or v == "":
        return None
    try:
        return int(float(str(v).strip()))
    except ValueError:
        return None


ADDRESS_RE = re.compile(r"^(?P<street>.*?),\s*(?P<city>[^,]+?),\s*(?P<state>[A-Z]{2})\b[ ,]*(?P<zip>\d{5})?")


def split_address(addr: Optional[str]) -> dict[str, Optional[str]]:
    """'1711 Branham Ln # A9, San Jose, CA 95118, United States' → parts. Best effort."""
    if not addr:
        return {"address": None, "city": None, "state": None, "zip": None}
    a = re.sub(r",?\s*(United States|USA|US)\s*$", "", addr.strip(), flags=re.I)
    m = ADDRESS_RE.match(a)
    if not m:
        return {"address": a, "city": None, "state": None, "zip": None}
    return {"address": m.group("street").strip() or a, "city": m.group("city").strip(),
            "state": m.group("state"), "zip": m.group("zip")}


@dataclass
class ChurnRow:
    sheet: str
    row_no: int
    name: str
    region: Optional[str] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    dm_name: Optional[str] = None
    stage: Optional[str] = None
    tier: Optional[int] = None
    churned_on: Optional[dt.date] = None
    category: Optional[str] = None
    reason: Optional[str] = None
    csm_name: Optional[str] = None
    solution: Optional[str] = None
    mrr: Optional[Decimal] = None
    gpv: Optional[Decimal] = None
    start_date: Optional[dt.date] = None
    last_touchpoint_on: Optional[dt.date] = None
    note: Optional[str] = None


@dataclass
class SheetReport:
    name: str
    layout: str  # contacts | reasons | unknown
    rows: int = 0
    skipped: list[dict[str, Any]] = field(default_factory=list)


@dataclass
class ParseResult:
    rows: list[ChurnRow]
    sheets: list[SheetReport]


def _find_header(ws) -> tuple[Optional[int], dict[int, str]]:
    """Scan the first 15 rows for one containing an Account Name cell."""
    for r_idx, row in enumerate(ws.iter_rows(min_row=1, max_row=15, values_only=True), start=1):
        cols: dict[int, str] = {}
        for c_idx, cell in enumerate(row):
            key = HEADERS.get(_norm_header(cell))
            if key:
                # The reasons sheet labels its month column "Churn Date ↑" too;
                # the real column is always to the right, so the last one wins.
                cols = {c: k for c, k in cols.items() if k != key}
                cols[c_idx] = key
        if "name" in cols.values():
            # the reasons sheet has an unnamed notes column right after the last header
            last = max(cols)
            if "note" not in cols.values() and last + 1 < (ws.max_column or 0):
                cols[last + 1] = "note"
            return r_idx, cols
    return None, {}


def parse_workbook(data: bytes) -> ParseResult:
    wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    rows: list[ChurnRow] = []
    sheets: list[SheetReport] = []
    for ws in wb.worksheets:
        header_row, cols = _find_header(ws)
        if header_row is None:
            sheets.append(SheetReport(name=ws.title, layout="unknown"))
            continue
        keys = set(cols.values())
        layout = "reasons" if "churned_on" in keys or "category" in keys else "contacts"
        rep = SheetReport(name=ws.title, layout=layout)
        for r_idx, row in enumerate(ws.iter_rows(min_row=header_row + 1, values_only=True), start=header_row + 1):
            cells = list(row)
            first = _norm_header(cells[0] if cells else None)
            second = _norm_header(cells[1] if len(cells) > 1 else None)
            if first in SKIP_FIRST_CELLS or second in SKIP_FIRST_CELLS:
                continue
            idx = {k: c for c, k in cols.items()}

            def get(k: str) -> Optional[str]:
                i = idx.get(k)
                return _text(cells[i]) if i is not None and i < len(cells) else None

            name = get("name")
            if not name:
                if any(_text(c) for c in cells):
                    rep.skipped.append({"row": r_idx, "reason": "no account name"})
                continue
            if _norm_header(name) in SKIP_FIRST_CELLS:
                continue
            rows.append(ChurnRow(
                sheet=ws.title, row_no=r_idx, name=name,
                region=get("region"), address=get("address"), phone=get("phone"), email=get("email"),
                dm_name=get("dm_name"), stage=get("stage"), tier=_int(get("tier")),
                churned_on=_date(get("churned_on")), category=get("category"), reason=get("reason"),
                csm_name=get("csm_name"), solution=get("solution"), mrr=_money(get("mrr")), gpv=_money(get("gpv")),
                start_date=_date(get("start_date")), last_touchpoint_on=_date(get("last_touchpoint_on")),
                note=get("note"),
            ))
            rep.rows += 1
        sheets.append(rep)
    wb.close()
    return ParseResult(rows=rows, sheets=sheets)


# ================================================================ apply =====
@dataclass
class ImportReport:
    fileName: str
    dryRun: bool
    sheets: list[dict[str, Any]]
    rowsRead: int
    merchantsCreated: int = 0
    merchantsMatched: int = 0
    contactsAdded: int = 0
    locationsAdded: int = 0
    churnRecordsCreated: int = 0
    churnRecordsUpdated: int = 0
    duplicatesInFile: int = 0
    # Rows that matched a name with several merchants (different locations) and
    # had no address to pick by; the first in the same region was used.
    ambiguous: list[dict[str, Any]] = field(default_factory=list)
    skipped: list[dict[str, Any]] = field(default_factory=list)


_REGION_ALIASES = {
    "BAY": "BA", "BAY AREA": "BA", "SJ": "BA", "SF": "BA", "SAN JOSE": "BA", "SAN FRANCISCO": "BA",
    "SANTA CLARA COUNTY": "BA", "SANTA CLARA": "BA", "SR": "BA", "SANTA ROSA": "BA", "SAN RAFAEL": "BA",
    "VALLEJO": "BA", "OAKLAND": "BA", "EAST BAY": "BA", "SOUTH BAY": "BA", "PENINSULA": "BA",
    "LOS ANGELES": "LA", "ORANGE COUNTY": "LA", "OC": "LA",
}
# Values that name a state, not a territory: fall back to the sheet's own region.
_NOT_A_REGION = {"CA", "CALIFORNIA", "USA", "US"}


def _region_key(r: Optional[str], sheet: Optional[str] = None) -> str:
    """Territory code for a sheet's Region cell. The CSM sheets mostly say BA / LA /
    NY / WA / Sacramento / Central Valley, but a few rows carry a city or county
    ("San Francisco", "Santa Clara County", "SR", "Vallejo") or a state ("CA").
    Cities and counties inside the Bay Area fold into BA; a state code falls back
    to the region in the sheet's name ("BA (Deployed - Closed)" -> BA) so the
    filter doesn't grow a value per typo."""
    r = (r or "").strip().upper()
    if r in _NOT_A_REGION:
        r = ""
    if not r and sheet:
        head = sheet.strip().upper().split(" ")[0].split("(")[0]
        if head in ("BA", "LA", "NY", "WA"):
            return head
    return _REGION_ALIASES.get(r, r)


def _first_csm(name: Optional[str]) -> Optional[str]:
    if not name:
        return None
    return name.split(",")[0].strip() or None


async def apply_rows(db: AsyncSession, rows: list[ChurnRow], *, file_name: str, dry_run: bool,
                     sheets: list[SheetReport]) -> ImportReport:
    """Create/match merchants for every row. With dry_run the session is rolled back."""
    report = ImportReport(fileName=file_name, dryRun=dry_run, rowsRead=len(rows),
                          sheets=[{"name": s.name, "layout": s.layout, "rows": s.rows, "skipped": len(s.skipped)} for s in sheets])
    for s in sheets:
        report.skipped.extend({"sheet": s.name, **x} for x in s.skipped)

    existing = (await db.execute(select(Merchant).options(selectinload(Merchant.churn), selectinload(Merchant.contacts),
                                                          selectinload(Merchant.locations)))).scalars().all()
    by_key: dict[str, list[Merchant]] = {}
    for m in existing:
        by_key.setdefault(normalise_name(m.restaurant_name), []).append(m)
    managers = {am.name.strip().lower(): am for am in (await db.execute(select(AccountManager))).scalars().all()}

    def _street_of(m: Merchant) -> set[str]:
        return {normalise_street(loc.address) for loc in m.locations if loc.address}

    for row in rows:
        key = normalise_name(row.name)
        if not key:
            report.skipped.append({"sheet": row.sheet, "row": row.row_no, "reason": "empty account name"})
            continue
        region = _region_key(row.region, row.sheet)
        street = normalise_street(row.address)
        candidates = by_key.get(key, [])
        merchant: Optional[Merchant] = None
        if candidates:
            if street:
                # Same brand, several locations: the address decides. A candidate
                # with no address yet (from the reasons workbook) can take this one.
                merchant = next((c for c in candidates if street in _street_of(c)), None)
                if merchant is None:
                    merchant = next((c for c in candidates if not _street_of(c) and _region_key(c.region) in (region, "")), None)
            elif len(candidates) == 1:
                merchant = candidates[0]
            else:
                merchant = next((c for c in candidates if _region_key(c.region) == region), None) or candidates[0]
                report.ambiguous.append({"sheet": row.sheet, "row": row.row_no, "name": row.name,
                                         "matched": merchant.restaurant_name, "candidates": len(candidates)})
        if merchant is not None:
            if getattr(merchant, "_churn_import_seen", False):
                report.duplicatesInFile += 1
            else:
                report.merchantsMatched += 1
        else:
            merchant = Merchant(restaurant_name=row.name.strip(), status=MerchantStatus.CHURNED, region=region or None,
                                source="CHURN_IMPORT", source_detail=source_detail(f"{file_name} / {row.sheet}"))
            merchant.contacts = []
            merchant.locations = []
            merchant.churn = None
            db.add(merchant)
            by_key.setdefault(key, []).append(merchant)
            report.merchantsCreated += 1
        merchant._churn_import_seen = True  # type: ignore[attr-defined]

        # ---- merchant fields: fill, and let the sheet win for region/solution/tier
        merchant.status = MerchantStatus.CHURNED
        if region:
            merchant.region = region
        if row.solution:
            merchant.innowi_solution = row.solution
        if row.tier is not None:
            merchant.account_tier = row.tier
        csm = _first_csm(row.csm_name)
        if csm and merchant.account_manager_id is None:
            am = managers.get(csm.lower())
            if am is None:
                am = AccountManager(name=csm, team="CSM")
                db.add(am)
                await db.flush()
                managers[csm.lower()] = am
            merchant.account_manager_id = am.id

        # ---- churn record
        churn = merchant.churn
        if churn is None:
            churn = MerchantChurn(merchant=merchant, source=f"{file_name} / {row.sheet}")
            merchant.churn = churn
            db.add(churn)
            report.churnRecordsCreated += 1
        else:
            report.churnRecordsUpdated += 1
        for attr, val in (("churned_on", row.churned_on), ("category", row.category), ("reason", row.reason),
                          ("csm_name", row.csm_name), ("mrr_at_churn", row.mrr), ("gpv_at_churn", row.gpv),
                          ("start_date", row.start_date), ("last_touchpoint_on", row.last_touchpoint_on)):
            if val is not None:
                setattr(churn, attr, val)
        if row.note and row.note not in (churn.winback_notes or ""):
            churn.winback_notes = (churn.winback_notes + "\n\n" if churn.winback_notes else "") + row.note
        # The contacts workbook's "Stage" (always "Deployed - Closed") isn't a
        # reason; it's kept on the source so the list shows "no reason yet".
        if row.stage and not row.category and not row.reason:
            churn.source = f"{file_name} / {row.sheet} ({row.stage})"

        # ---- owner contact
        if row.phone or row.email or row.dm_name:
            email = (row.email or "").lower() or None
            match = next((c for c in merchant.contacts if (email and (c.email or "").lower() == email)
                          or (row.phone and c.phone == row.phone)), None)
            if match is None and row.dm_name:
                match = next((c for c in merchant.contacts if (c.name or "").strip().lower() == row.dm_name.strip().lower()), None)
            if match is None:
                c = Contact(merchant=merchant, name=row.dm_name, role=ContactRole.OWNER, email=row.email, phone=row.phone)
                merchant.contacts.append(c)
                report.contactsAdded += 1
            else:
                match.name = match.name or row.dm_name
                match.email = match.email or row.email
                match.phone = match.phone or row.phone

        # ---- primary location
        if row.address and street not in _street_of(merchant):
            parts = split_address(row.address)
            merchant.locations.append(Location(merchant=merchant, is_primary=not merchant.locations, **parts))
            report.locationsAdded += 1

    if dry_run:
        await db.rollback()
    else:
        await db.commit()
    return report
