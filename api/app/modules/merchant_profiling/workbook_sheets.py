"""The other per-merchant sheets of the Merchant Profile System workbook that have a screen in
the Super App:

    Access   → Profiling → Connections (access items: GBP, website admin, domain, POS…)
    Delivery → Profiling → Services (the package's services this merchant has; "Included? = No" skipped)

Both are keyed by the "Merchant" column (restaurant name), like the Promotions sheet. Additive:
an access item / service the merchant already has is left as it is, so importing twice adds
nothing. (Baselines, Scorecard and Opportunities have no screen yet, so they're not read.)
"""
from __future__ import annotations

import io
import re
from dataclasses import dataclass, field
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.catalog import Service
from app.models.enums import AccessCriticality, AccessFlag, AccessStatus, MerchantServiceStatus
from app.models.profiling import AccessItem, Merchant, MerchantService
from app.modules.merchant_profiling import merchant_import as mi

CRIT = {"critical": AccessCriticality.CRITICAL, "criticalcompliance": AccessCriticality.CRITICAL_COMPLIANCE, "high": AccessCriticality.HIGH,
        "medium": AccessCriticality.MEDIUM, "low": AccessCriticality.LOW}
ACC_STATUS = {"notrequested": AccessStatus.NOT_REQUESTED, "requested": AccessStatus.REQUESTED, "received": AccessStatus.RECEIVED,
              "verified": AccessStatus.VERIFIED, "failed": AccessStatus.FAILED, "na": AccessStatus.NA}
ACC_FLAG = {"blocker": AccessFlag.BLOCKER, "open": AccessFlag.OPEN}
SVC_STATUS = {"paused": MerchantServiceStatus.PAUSED, "notincluded": MerchantServiceStatus.INACTIVE}

SHEETS = {
    "access": {"names": ("access",), "label": "Access (Profiling → Access)", "screen": "connections",
               "need": ("accessitem",)},
    "delivery": {"names": ("delivery", "services"), "label": "Services", "screen": "services", "need": ("service",)},
}


def _k(v: Any) -> str:
    return re.sub(r"[^a-z0-9]", "", str(v or "").lower())


@dataclass
class SheetRows:
    kind: str
    sheet: str
    rows: list[tuple[int, dict]] = field(default_factory=list)  # (row number, {normalised header: value})


def read_sheets(data: bytes, filename: str) -> list[SheetRows]:
    """Access / Delivery sheets of an .xlsx (none for a CSV)."""
    if (filename or "").lower().endswith(".csv") or not data.startswith(b"PK"):
        return []
    import openpyxl

    try:
        wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    except Exception:  # noqa: BLE001 - read_file reports unreadable workbooks
        return []
    out = []
    try:
        for name in wb.sheetnames:
            kind = next((k for k, spec in SHEETS.items() if _k(name) in spec["names"]), None)
            if not kind:
                continue
            grid = [list(r) for r in wb[name].iter_rows(values_only=True, max_row=mi.MAX_ROWS * 20)]
            hi = next((i for i, r in enumerate(grid[:10]) if "merchant" in {_k(h) for h in r}
                       and all(n in {_k(h) for h in r} for n in SHEETS[kind]["need"])), None)
            if hi is None:
                continue
            heads = [_k(h) for h in grid[hi]]
            sr = SheetRows(kind=kind, sheet=name)
            for n, raw in enumerate(grid[hi + 1:], start=hi + 2):
                rec = {h: raw[i] for i, h in enumerate(heads) if h and i < len(raw)}
                if mi.s(rec.get("merchant")) and any(mi.s(rec.get(x)) for x in SHEETS[kind]["need"]):
                    sr.rows.append((n, rec))
            out.append(sr)
    finally:
        wb.close()
    return out


async def _merchants_by_name(db: AsyncSession) -> dict[str, list[str]]:
    by: dict[str, list[str]] = {}
    for mid, name in (await db.execute(select(Merchant.id, Merchant.restaurant_name))).all():
        by.setdefault(mi.norm_name(name), []).append(mid)
    return by


async def plan(db: AsyncSession, sheets: list[SheetRows], merchant_rows: list[dict], apply: bool = False) -> list[dict]:
    """Per sheet: how many rows are new / already there / have no merchant. With apply=True also writes them
    (call after the Merchants sheet was applied, so new merchants exist)."""
    by_name = await _merchants_by_name(db)
    new_names = {mi.norm_name(r["restaurantName"]) for r in merchant_rows if r.get("action") == "create"}
    services = {_k(s.name): s for s in (await db.execute(select(Service))).scalars()}
    out = []
    for sr in sheets:
        spec = SHEETS[sr.kind]
        t = {"kind": sr.kind, "sheet": sr.sheet, "label": spec["label"], "screen": spec["screen"],
             "rows": 0, "new": 0, "exists": 0, "noMerchant": 0, "skipped": 0, "unknown": [], "added": 0}
        have: dict[str, set[str]] = {}
        for _, rec in sr.rows:
            t["rows"] += 1
            name = mi.norm_name(mi.s(rec.get("merchant")))
            ids = by_name.get(name, [])
            if len(ids) != 1 and not (not ids and name in new_names and not apply):
                t["noMerchant"] += 1
                continue
            mid = ids[0] if ids else None
            if sr.kind == "access":
                key = _k(rec.get("accessitem"))
            else:
                if not re.match(r"^y", str(mi.s(rec.get("included")) or "yes"), re.I):
                    t["skipped"] += 1  # "Included? = No"
                    continue
                svc = services.get(_k(rec.get("service")))
                if not svc:
                    if mi.s(rec.get("service")) not in t["unknown"]:
                        t["unknown"].append(mi.s(rec.get("service")))
                    t["skipped"] += 1
                    continue
                key = svc.id
            if mid and mid not in have:
                if sr.kind == "access":
                    have[mid] = {_k(a) for a in (await db.execute(select(AccessItem.access_item).where(AccessItem.merchant_id == mid))).scalars()}
                else:
                    have[mid] = set((await db.execute(select(MerchantService.service_id).where(MerchantService.merchant_id == mid))).scalars())
            if mid and key in have[mid]:
                t["exists"] += 1
                continue
            t["new"] += 1
            if apply and mid:
                have[mid].add(key)
                db.add(_record(sr.kind, mid, rec, key))
                t["added"] += 1
        out.append(t)
    if apply:
        await db.flush()
    return out


def _record(kind: str, mid: str, rec: dict, key: str):
    if kind == "access":
        notes = mi.s(rec.get("whyitmattersnotes")) or mi.s(rec.get("notes"))
        return AccessItem(
            merchant_id=mid, access_item=mi.s(rec.get("accessitem")),
            criticality=CRIT.get(_k(rec.get("criticality")), AccessCriticality.MEDIUM),
            status=ACC_STATUS.get(_k(rec.get("status")), AccessStatus.NOT_REQUESTED),
            date_requested=mi.as_date(rec.get("daterequested")), date_received=mi.as_date(rec.get("datereceived")),
            verified=bool(re.match(r"^y", mi.s(rec.get("verified")) or "", re.I)), verified_date=mi.as_date(rec.get("verifieddate")),
            expiry=mi.as_date(rec.get("expiryrenewal")), owner=mi.s(rec.get("owner")),
            flag=ACC_FLAG.get(_k(rec.get("flag")), AccessFlag.NONE),
            notes=notes,
        )
    parts = [f"{lbl}: {mi.s(rec.get(c))}" for c, lbl in (("qtyperiod", "Qty / period"), ("frequency", "Frequency"), ("ownerteam", "Owner team"),
                                                           ("status", "Delivery"), ("definitionofdone", "Done when"), ("notes", "Notes"))
             if mi.s(rec.get(c)) is not None]
    return MerchantService(merchant_id=mid, service_id=key, status=SVC_STATUS.get(_k(rec.get("status")), MerchantServiceStatus.ACTIVE),
                           notes="\n".join(parts) or None)
