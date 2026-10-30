"""The Promotions sheet of the merchant workbook → each merchant's Profiling → Promotions
(which the Google Ads "Offers" tab also reads).

The sheet is found by name ("Promotions", "Promo…") or by its header row: a column naming the
merchant (Merchant ID / Restaurant Name) next to promotion columns (Promo Name, Offer Type, Offer
Value, Promo Code…). Column names are matched loosely; anything not recognised goes into Notes as
"Column: value" so nothing in the sheet is lost.

Rows are matched to merchants by Merchant ID, else by restaurant name — including merchants the
same file is about to create. A promotion that already exists for the merchant (same name / code
and start date) is left alone, so importing the file twice adds nothing.
"""
from __future__ import annotations

import csv
import io
import re
from dataclasses import dataclass, field
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.boundary import Promotion
from app.models.enums import PromotionStatus
from app.modules.merchant_profiling import merchant_import as mi

MAX_ROWS = 5000

# promotion field → header spellings (compared lower-case, letters and digits only)
ALIASES: dict[str, tuple[str, ...]] = {
    "code": ("merchantid", "merchantcode", "merchantno", "mid"),
    "name": ("restaurantnamedba", "restaurantname", "restaurant", "merchantname", "merchant", "dba", "business", "businessname"),
    "promo_name": ("promoname", "promotionname", "promotion", "promo", "campaign", "campaignname", "offername", "title"),
    "offer_type": ("offertype", "promotype", "promotiontype", "type", "discounttype", "dealtype"),
    "offer_value": ("offervalue", "value", "discount", "discountvalue", "offer", "offerdetails", "details", "deal", "amount", "description"),
    "promo_code": ("promocode", "code", "couponcode", "coupon", "discountcode"),
    "channels": ("channels", "channel", "platforms", "platform", "where", "wherepromoted", "promotedon"),
    "start_date": ("startdate", "start", "starts", "from", "datefrom", "launchdate"),
    "end_date": ("enddate", "end", "ends", "to", "dateto", "expiry", "expires", "expirydate", "expirationdate"),
    "status": ("status", "promostatus", "promotionstatus"),
    "redemptions": ("redemptions", "redemptioncount", "uses", "redeemed"),
    "redemption_method": ("redemptionmethod", "howtoredeem", "redemption"),
    "approval_owner": ("approvalowner", "approver", "approvedby", "owner"),
    "staff_briefed": ("staffbriefed", "staffbrief", "briefed"),
    "blackout_dates": ("blackoutdates", "blackout", "blackouts", "exclusions", "excludeddates"),
    "notes": ("notes", "note", "comments", "comment", "terms", "fineprint", "conditions"),
}
BY_ALIAS = {a: f for f, names in ALIASES.items() for a in names}
PROMO_FIELDS = {"promo_name", "offer_type", "offer_value", "promo_code"}
STATUS = {
    "draft": PromotionStatus.DRAFT, "planned": PromotionStatus.SCHEDULED, "scheduled": PromotionStatus.SCHEDULED, "upcoming": PromotionStatus.SCHEDULED,
    "active": PromotionStatus.ACTIVE, "live": PromotionStatus.ACTIVE, "running": PromotionStatus.ACTIVE, "ongoing": PromotionStatus.ACTIVE,
    "ended": PromotionStatus.ENDED, "finished": PromotionStatus.ENDED, "paused": PromotionStatus.ENDED, "expired": PromotionStatus.EXPIRED,
    "none": PromotionStatus.NO_PROMOTION, "nopromotion": PromotionStatus.NO_PROMOTION, "no": PromotionStatus.NO_PROMOTION,
}


def _key(h: Any) -> str:
    return re.sub(r"[^a-z0-9]", "", str(h or "").replace("﻿", "").lower())


@dataclass
class PromoSheet:
    sheet: Optional[str]
    rows: list[tuple[int, dict, dict]] = field(default_factory=list)  # (row number, {field: value}, {unknown column: value})
    columns: dict[str, str] = field(default_factory=dict)  # sheet column → field it fills
    whole_file: bool = False  # a CSV that is only promotions


def _header(grid: list[list], named: bool) -> Optional[tuple[int, list[Optional[str]]]]:
    for i, row in enumerate(grid[:15]):
        fields = [BY_ALIAS.get(_key(h)) for h in row]
        found = {f for f in fields if f}
        promo = found & PROMO_FIELDS
        if ({"code", "name"} & found) and (len(promo) >= 2 or (named and promo)):
            # The same field from two columns: keep the first (e.g. "Promotion" and "Promo Name").
            seen: set[str] = set()
            out = []
            for f in fields:
                out.append(f if f and f not in seen else None)
                if f:
                    seen.add(f)
            return i, out
    return None


def _rows(grid: list[list], sheet: Optional[str]) -> Optional[PromoSheet]:
    hit = _header(grid, named=bool(sheet and "promo" in sheet.lower()))
    if not hit:
        return None
    hi, fields = hit
    heads = [str(h or "").strip() for h in grid[hi]]
    ps = PromoSheet(sheet=sheet, columns={heads[i]: f for i, f in enumerate(fields) if f})
    for n, raw in enumerate(grid[hi + 1:], start=hi + 2):
        rec, extra = {}, {}
        for i, v in enumerate(raw):
            if i >= len(heads):
                break
            if fields[i]:
                rec[fields[i]] = v
            elif heads[i] and mi.s(v):
                extra[heads[i]] = mi.s(v)
        if not any(mi.s(rec.get(f)) for f in PROMO_FIELDS) and not _says_none(rec):
            continue  # blank line or a merchant with nothing filled in
        ps.rows.append((n, rec, extra))
        if len(ps.rows) > MAX_ROWS:
            break
    return ps


def _says_none(rec: dict) -> bool:
    """A "No Promotion" row: the merchant is listed with Status = No Promotion and nothing else."""
    return bool(mi.s(rec.get("name")) or mi.s(rec.get("code"))) and STATUS.get(_key(mi.s(rec.get("status")) or "")) == PromotionStatus.NO_PROMOTION


def read_promotions(data: bytes, filename: str) -> Optional[PromoSheet]:
    """The promotions in an .xlsx (its Promotions sheet) or a CSV that is a promotions sheet; None if there are none."""
    name = (filename or "").lower()
    if name.endswith(".csv") or not data.startswith(b"PK"):
        try:
            text = data.decode("utf-8-sig")
        except UnicodeDecodeError:
            text = data.decode("cp1252", errors="replace")
        ps = _rows(list(csv.reader(io.StringIO(text))), None)
        if ps:
            ps.whole_file = True
        return ps
    import openpyxl

    try:
        wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    except Exception:  # noqa: BLE001 - read_file reports unreadable workbooks
        return None
    try:
        names = sorted(wb.sheetnames, key=lambda n: "promo" not in n.lower())
        for n in names:
            if n == mi.SHEET_NAME:
                continue
            ps = _rows([list(r) for r in wb[n].iter_rows(values_only=True, max_row=MAX_ROWS + 20)], n)
            if ps:
                return ps
        return None
    finally:
        wb.close()


def looks_like_promotions(sheet_name: Optional[str]) -> bool:
    return bool(sheet_name and "promo" in sheet_name.lower())


# ------------------------------------------------------------------ plan ---


def _values(rec: dict, extra: dict) -> dict:
    v = {
        "promo_name": mi.s(rec.get("promo_name")), "offer_type": mi.s(rec.get("offer_type")), "offer_value": mi.s(rec.get("offer_value")),
        "promo_code": mi.s(rec.get("promo_code")), "channels": mi.s(rec.get("channels")),
        "start_date": mi.as_date(rec.get("start_date")), "end_date": mi.as_date(rec.get("end_date")),
        "redemptions": mi.s(rec.get("redemptions")), "redemption_method": mi.s(rec.get("redemption_method")),
        "approval_owner": mi.s(rec.get("approval_owner")), "staff_briefed": mi.yes_no(rec.get("staff_briefed")),
        "blackout_dates": mi.s(rec.get("blackout_dates")),
    }
    raw_status = mi.s(rec.get("status"))
    v["status"] = STATUS.get(_key(raw_status)) if raw_status else None
    notes = [mi.s(rec.get("notes"))] if mi.s(rec.get("notes")) else []
    if raw_status and not v["status"]:
        notes.append(f"Status: {raw_status}")
    for c in ("start_date", "end_date"):
        if mi.s(rec.get(c)) and not v[c]:
            notes.append(f"{'Start' if c == 'start_date' else 'End'}: {mi.s(rec.get(c))}")
    notes += [f"{k}: {x}" for k, x in extra.items()]
    v["notes"] = "\n".join(notes) or None
    return v


def _same_key(name: Optional[str], code: Optional[str], start) -> tuple:
    return (mi.norm_name(name or code), start.date() if start else None)


async def plan(db: AsyncSession, ps: PromoSheet, merchant_rows: list[dict]) -> dict:
    """What importing the promotions would do. `merchant_rows` = the Merchants sheet's planned rows,
    so a promotion can belong to a merchant this same file creates."""
    from app.models.profiling import Merchant

    new_by_code = {r["merchantCode"]: r for r in merchant_rows if r.get("action") == "create" and r.get("merchantCode")}
    new_by_name = {mi.norm_name(r["restaurantName"]): r for r in merchant_rows if r.get("action") == "create"}
    existing: dict[str, set] = {}
    out_rows, totals = [], {"rows": 0, "new": 0, "exists": 0, "noMerchant": 0, "none": 0}
    seen_in_file: set = set()
    for n, rec, extra in ps.rows:
        code, name = mi.s(rec.get("code")), mi.s(rec.get("name"))
        v = _values(rec, extra)
        row = {"row": n, "merchantCode": code, "restaurantName": name, "merchantId": None, "merchantName": None,
               "promoName": v["promo_name"], "offerType": v["offer_type"], "offerValue": v["offer_value"], "promoCode": v["promo_code"],
               "startDate": v["start_date"].date().isoformat() if v["start_date"] else None,
               "endDate": v["end_date"].date().isoformat() if v["end_date"] else None,
               "status": v["status"].value if v["status"] else None, "action": "new", "note": None}
        if not any(mi.s(rec.get(f)) for f in PROMO_FIELDS):
            # "No Promotion": noted in the preview, nothing to add (an empty promotion card helps no one).
            row["action"], row["note"], row["promoName"] = "none", "No promotion running", None
            totals["rows"] += 1
            totals["none"] += 1
            out_rows.append((row, v))
            continue
        m = None
        if code or name:
            try:
                m, reason, _ = await mi._match(db, code, name or "")
            except Exception:  # noqa: BLE001
                m, reason = None, None
            if m is None and code and not name:
                m = (await db.execute(select(Merchant).where(Merchant.merchant_code == code))).scalar_one_or_none()
        if m:
            row["merchantId"], row["merchantName"] = m.id, m.restaurant_name
            if m.id not in existing:
                ps_ = (await db.execute(select(Promotion).where(Promotion.merchant_id == m.id))).scalars().all()
                existing[m.id] = {_same_key(p.promo_name, p.promo_code, p.start_date) for p in ps_}
            k = _same_key(v["promo_name"], v["promo_code"], v["start_date"])
            if k in existing[m.id] or (m.id, k) in seen_in_file:
                row["action"], row["note"] = "exists", "Already on this merchant's Promotions"
            seen_in_file.add((m.id, k))
        elif (code and code in new_by_code) or (name and mi.norm_name(name) in new_by_name):
            r = new_by_code.get(code) if code in new_by_code else new_by_name[mi.norm_name(name)]
            row["merchantName"], row["note"] = r["restaurantName"], "Merchant is created by this import"
            row["action"] = "new"
            row["_pending"] = r["key"]
        else:
            row["action"], row["note"] = "noMerchant", "No merchant with this Merchant ID / name"
        totals["rows"] += 1
        totals["new" if row["action"] == "new" else row["action"]] += 1
        out_rows.append((row, v))
    return {"sheet": ps.sheet, "columns": ps.columns, "totals": totals,
            "rows": [{k: x for k, x in r.items() if not k.startswith("_")} for r, _ in out_rows], "_rows": out_rows}


async def apply(db: AsyncSession, ps: PromoSheet, merchant_rows: list[dict]) -> dict:
    """Create the new promotions. Call after the Merchants sheet was applied (its rows carry merchantId)."""
    by_key = {r["key"]: r.get("merchantId") for r in merchant_rows}
    result = await plan(db, ps, merchant_rows)
    created = 0
    for row, v in result.pop("_rows"):
        if row["action"] != "new":
            continue
        mid = row["merchantId"] or by_key.get(row.get("_pending"))
        if not mid:
            continue
        db.add(Promotion(merchant_id=mid, **{k: x for k, x in v.items() if x is not None}))
        created += 1
    await db.flush()
    result["applied"] = {"created": created}
    return result


def public(result: Optional[dict]) -> Optional[dict]:
    if result is None:
        return None
    return {k: x for k, x in result.items() if not k.startswith("_")}
