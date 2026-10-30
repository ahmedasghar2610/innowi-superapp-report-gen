"""Merchants → Import → Payments: the paid-marketing revenue report (e.g. the
"Revenue Sheet Sept. 2026" sheet of "Paid Mkt. Accounts - 2026.xlsx") → one
MerchantPayment per merchant for that month.

The sheet's first column names the account the way finance writes it ("Coffee heist
(Doii Café)", "PHO HA PLUS VIETNA MESE CUISINE"), so rows are matched to merchants
by name — sure matches link straight away, close ones are suggested and the person
picks in the preview. Re-importing a month replaces that month's rows; other months
stay. Nothing here touches the merchant's profile or subscription.
"""
from __future__ import annotations

import datetime as dt
import io
import os
import re
import unicodedata
from dataclasses import dataclass, field
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.boundary import MerchantPayment
from app.models.profiling import Merchant
from app.modules.linking.engine import NAME_STOP, norm_name, ratio

MAX_BYTES = 10 * 1024 * 1024
MONTHS = {m: i + 1 for i, m in enumerate(("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"))}
SURE_AT, SUGGEST_AT = 90, 70

COLS = {  # field → header spellings (lower-case, letters and digits only)
    "account": ("accounts", "account", "accountname", "restaurant", "merchant", "restaurantname"),
    "status": ("status",),
    "package_type": ("packagetype", "package", "type"),
    "contract": ("contract", "contractamount", "contractprice"),
    "charged": ("paymentsrecurringcharged", "charged", "paymentscharged", "payments", "chargedamount", "paymentsrecurring"),
    "variance": ("variance", "difference"),
    "orders_revenue": ("onlineordersrevenue", "ordersrevenue", "onlineorders", "onlinerevenue"),
    "commission": ("comissionbasecharge", "commissionbasecharge", "commission", "commissioncharge"),
    "notes": ("notes", "note", "comments", "comment"),
}


class PaymentsImportError(ValueError):
    pass


def _k(v: Any) -> str:
    return re.sub(r"[^a-z0-9]", "", str(v or "").lower())


def _field(header: Any) -> Optional[str]:
    h = _k(header)
    if not h:
        return None
    for f, names in COLS.items():
        if h in names:
            return f
    # "Accounts Sept. 2026" / "Payments (Recurring)/ Charged ($)" / "Contract ($)"
    for f, prefix in (("account", "accounts"), ("charged", "payments"), ("contract", "contract"), ("orders_revenue", "onlineorders")):
        if h.startswith(prefix):
            return f
    return None


def money(v: Any) -> Optional[float]:
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    t = str(v).strip()
    if not t or t in ("-", "—", "–"):
        return None
    neg = t.startswith("(") and t.endswith(")") or t.lstrip().startswith("-")
    t = re.sub(r"[^0-9.]", "", t)
    if not t or t.count(".") > 1:
        return None
    n = float(t)
    return -n if neg else n


def text(v: Any) -> Optional[str]:
    t = re.sub(r"\s+", " ", str(v or "")).strip()
    return t or None


def month_of(*labels: Optional[str]) -> Optional[dt.date]:
    """"Revenue Sheet Sept. 2026" / "Accounts Sept. 2026" → 2026-09-01."""
    for label in labels:
        m = re.search(r"\b([A-Za-z]{3,9})\.?\s+(20\d\d)\b", label or "")
        if m and m.group(1)[:3].lower() in MONTHS:
            return dt.date(int(m.group(2)), MONTHS[m.group(1)[:3].lower()], 1)
    return None


# ------------------------------------------------------------------ reading ---


@dataclass
class ReportSheet:
    name: str
    month: Optional[dt.date]
    columns: dict[str, str] = field(default_factory=dict)  # sheet header → field
    rows: list[tuple[int, dict]] = field(default_factory=list)


def _sheet(name: str, grid: list[list]) -> Optional[ReportSheet]:
    for i, row in enumerate(grid[:10]):
        fields = [_field(h) for h in row]
        if "account" in fields and "contract" in fields and "charged" in fields:
            seen: set[str] = set()
            cols = []
            for f in fields:
                cols.append(f if f and f not in seen else None)
                if f:
                    seen.add(f)
            heads = [text(h) or "" for h in row]
            acc_header = heads[cols.index("account")]
            rs = ReportSheet(name=name, month=month_of(name, acc_header),
                             columns={heads[j]: f for j, f in enumerate(cols) if f})
            for n, raw in enumerate(grid[i + 1:], start=i + 2):
                rec = {f: (raw[j] if j < len(raw) else None) for j, f in enumerate(cols) if f}
                if text(rec.get("account")):  # the totals row has no account name
                    rs.rows.append((n, rec))
            return rs
    return None


def read_report(data: bytes, filename: str) -> list[ReportSheet]:
    """Every sheet of the workbook that looks like a revenue report (Accounts · Contract · Charged columns)."""
    if len(data) > MAX_BYTES:
        raise PaymentsImportError("The file is larger than 10 MB.")
    if (filename or "").lower().endswith(".csv") or not data.startswith(b"PK"):
        import csv

        try:
            t = data.decode("utf-8-sig")
        except UnicodeDecodeError:
            t = data.decode("cp1252", errors="replace")
        rs = _sheet(os.path.splitext(os.path.basename(filename or "report"))[0], list(csv.reader(io.StringIO(t))))
        return [rs] if rs else []
    import openpyxl

    try:
        wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    except Exception as exc:  # noqa: BLE001
        raise PaymentsImportError("That file isn't a readable .xlsx workbook.") from exc
    out = []
    try:
        for name in wb.sheetnames:
            rs = _sheet(name.strip(), [list(r) for r in wb[name].iter_rows(values_only=True, max_row=3000)])
            if rs and rs.rows:
                out.append(rs)
    finally:
        wb.close()
    return out


def pick_sheet(sheets: list[ReportSheet], wanted: Optional[str]) -> ReportSheet:
    if not sheets:
        raise PaymentsImportError('No revenue sheet found: it needs "Accounts", "Contract" and "Payments / Charged" columns.')
    if wanted:
        for s in sheets:
            if s.name.strip().lower() == wanted.strip().lower():
                return s
        raise PaymentsImportError(f'There\'s no revenue sheet called "{wanted}" in this file.')
    # The latest month; "Revenue Sheet …" before other sheets of the same month.
    return max(sheets, key=lambda s: (s.month or dt.date.min, "revenue" in s.name.lower()))


# ----------------------------------------------------------------- matching ---

STOP = NAME_STOP | {"cuisine", "mexican", "inc", "llc", "branches", "all", "pizza", "restaurant", "cafe", "café", "bakery"}


def _variants(name: str) -> list[tuple[str, int]]:
    """(name, penalty): the whole name, the part outside brackets, the part inside them."""
    name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()  # "café" → "cafe"
    out = [(name, 0)]
    outside = re.sub(r"\([^)]*\)", " ", name).strip()
    if outside and outside != name:
        out.append((outside, 6))  # "De Los Altos Grill (Food Truck)" isn't quite "De Los Altos Grill"
    for inside in re.findall(r"\(([^)]*)\)", name):
        if inside.strip():
            out.append((inside.strip(), 10))  # "Cairo Grill (Fatima Bazaar)" is Cairo Grill first
    return out


def _tokens(v: str) -> set[str]:
    v = v.lower().replace("’", "'").replace("'s", "s")
    return {t for t in re.sub(r"[^a-z0-9 ]", " ", v).split() if len(t) > 2 and t not in STOP}


def _score(a: str, b: str) -> tuple[int, str]:
    na, nb = norm_name(a.replace("'", "").replace("’", "")), norm_name(b.replace("'", "").replace("’", ""))
    if na and na == nb:
        return 100, "Same name"
    ta, tb = _tokens(a), _tokens(b)
    if ta and ta == tb:
        return 95, "Same name apart from common words"
    small, big = (ta, tb) if len(ta) <= len(tb) else (tb, ta)
    if small and small <= big:
        return max(70, 90 - 4 * len(big - small)), "One name contains the other"
    if na and nb and (na in nb or nb in na) and min(len(na), len(nb)) >= 6:
        return 85, "One name contains the other"
    r = ratio(na, nb)
    if r >= 0.75:
        return min(89, int(100 * r)), "Nearly the same name"
    if len(os.path.commonprefix([na, nb])) >= 8:
        return 75, "Names start the same"
    return 0, ""


def match(account: str, merchants: list[Merchant]) -> list[dict]:
    """Best merchants for one account name, best first: [{merchantId, name, score, reason}]."""
    best: dict[str, dict] = {}
    for m in merchants:
        for av, ap in _variants(account):
            for mv, mp in _variants(m.restaurant_name or ""):
                sc, why = _score(av, mv)
                sc -= ap + mp
                if sc > best.get(m.id, {"score": 0})["score"]:
                    best[m.id] = {"merchantId": m.id, "name": m.restaurant_name, "code": m.merchant_code, "score": sc, "reason": why}
    return sorted((c for c in best.values() if c["score"] >= SUGGEST_AT - 10), key=lambda c: -c["score"])[:4]


def _pick(cands: list[dict]) -> tuple[Optional[str], bool]:
    """(merchant id to pre-choose, sure?)."""
    if not cands:
        return None, False
    top, nxt = cands[0], (cands[1]["score"] if len(cands) > 1 else 0)
    if top["score"] >= SURE_AT and nxt < top["score"] - 5:
        return top["merchantId"], True
    if top["score"] >= SUGGEST_AT and nxt < top["score"] - 5:
        return top["merchantId"], False
    return None, False


# ------------------------------------------------------------- plan / apply ---


def _values(rec: dict) -> dict:
    contract, charged = money(rec.get("contract")), money(rec.get("charged"))
    variance = money(rec.get("variance"))
    if variance is None and contract is not None and charged is not None:
        variance = round(contract - charged, 2)
    return {
        "account_name": text(rec.get("account")), "status": text(rec.get("status")), "package_type": text(rec.get("package_type")),
        "contract_amount": contract, "charged_amount": charged, "variance": variance,
        "orders_revenue": money(rec.get("orders_revenue")), "commission_charge": money(rec.get("commission")),
        "notes": text(rec.get("notes")),
    }


def _dto(v: dict) -> dict:
    return {"account": v["account_name"], "status": v["status"], "packageType": v["package_type"], "contract": v["contract_amount"],
            "charged": v["charged_amount"], "variance": v["variance"], "ordersRevenue": v["orders_revenue"],
            "commission": v["commission_charge"], "notes": v["notes"]}


async def plan(db: AsyncSession, sheets: list[ReportSheet], sheet_name: Optional[str], month: Optional[dt.date],
               choices: Optional[dict[str, str]] = None) -> dict:
    """What importing the sheet would do. `choices` = {row key: merchantId | "skip"} from the preview."""
    rs = pick_sheet(sheets, sheet_name)
    month = month or rs.month
    merchants = (await db.execute(select(Merchant))).scalars().all()
    have = set()
    if month:
        have = set((await db.execute(select(MerchantPayment.merchant_id).where(MerchantPayment.month == month))).scalars())
    choices = choices or {}
    rows, used = [], {}
    for n, rec in rs.rows:
        v = _values(rec)
        key = f"row{n}"
        cands = match(v["account_name"], merchants)
        auto, sure = _pick(cands)
        chosen = choices.get(key, auto)
        if chosen == "skip":
            chosen = None
        valid = {m.id for m in merchants}
        if chosen and chosen not in valid:
            chosen = None
        rows.append({"key": key, "row": n, **_dto(v), "candidates": cands, "suggested": auto, "sure": sure,
                     "merchantId": chosen, "replaces": bool(chosen and chosen in have), "_v": v})
        if chosen:
            used.setdefault(chosen, []).append(key)
    # Two rows on one merchant: keep both visible, but only the first is imported.
    for mid, keys in used.items():
        for k in keys[1:]:
            r = next(r for r in rows if r["key"] == k)
            r["duplicateOf"] = keys[0]
    totals = {
        "rows": len(rows), "matched": sum(1 for r in rows if r["merchantId"] and not r.get("duplicateOf")),
        "sure": sum(1 for r in rows if r["sure"] and r["merchantId"] == r["suggested"]),
        "unmatched": sum(1 for r in rows if not r["merchantId"]), "replaces": sum(1 for r in rows if r["replaces"]),
        "contract": round(sum(r["contract"] or 0 for r in rows), 2), "charged": round(sum(r["charged"] or 0 for r in rows), 2),
        "variance": round(sum(r["variance"] or 0 for r in rows), 2), "ordersRevenue": round(sum(r["ordersRevenue"] or 0 for r in rows), 2),
    }
    return {
        "sheets": [{"name": s.name, "month": s.month.isoformat() if s.month else None, "rows": len(s.rows)} for s in sheets],
        "sheet": rs.name, "month": month.isoformat() if month else None, "columns": rs.columns,
        "merchants": [{"merchantId": m.id, "name": m.restaurant_name, "code": m.merchant_code} for m in sorted(merchants, key=lambda m: (m.restaurant_name or "").lower())],
        "totals": totals, "rows": rows,
    }


async def apply(db: AsyncSession, sheets: list[ReportSheet], sheet_name: Optional[str], month: Optional[dt.date],
                choices: dict[str, str], filename: Optional[str], user_id: Optional[str]) -> dict:
    result = await plan(db, sheets, sheet_name, month, choices)
    if not result["month"]:
        raise PaymentsImportError("Couldn't tell which month this sheet is for — pick the month.")
    m = dt.date.fromisoformat(result["month"])
    written = 0
    for r in result["rows"]:
        if not r["merchantId"] or r.get("duplicateOf"):
            continue
        row = (await db.execute(select(MerchantPayment).where(MerchantPayment.merchant_id == r["merchantId"],
                                                               MerchantPayment.month == m))).scalar_one_or_none()
        if not row:
            row = MerchantPayment(merchant_id=r["merchantId"], month=m, account_name=r["account"])
            db.add(row)
        for k, v in r["_v"].items():
            setattr(row, k, v)
        row.source_file, row.source_sheet, row.imported_by = filename, result["sheet"], user_id
        written += 1
    await db.flush()
    result["applied"] = {"written": written, "month": result["month"]}
    return result


def public(result: dict) -> dict:
    return {**result, "rows": [{k: v for k, v in r.items() if not k.startswith("_")} for r in result["rows"]]}


# --------------------------------------------------------------- reading back ---


def payment_dto(p: MerchantPayment) -> dict:
    f = lambda v: float(v) if v is not None else None  # noqa: E731
    return {"id": p.id, "month": p.month.isoformat(), "account": p.account_name, "status": p.status, "packageType": p.package_type,
            "contract": f(p.contract_amount), "charged": f(p.charged_amount), "variance": f(p.variance),
            "ordersRevenue": f(p.orders_revenue), "commission": f(p.commission_charge), "notes": p.notes,
            "sourceFile": p.source_file, "sourceSheet": p.source_sheet,
            "importedAt": (p.updated_at or p.created_at).isoformat() if (p.updated_at or p.created_at) else None}


def _fmt(v: Optional[float]) -> str:
    return f"${v:,.2f}".replace(".00", "") if v is not None else "—"


def checks(p: dict, profile: dict, prev: Optional[dict]) -> list[dict]:
    """What a person should notice about one month, comparing the report with the merchant's Profile."""
    out: list[dict] = []
    contract, charged = p["contract"], p["charged"]
    if contract and charged is not None and charged < contract:
        level = "danger" if not charged else "warning"
        short = contract - charged
        out.append({"level": level, "title": "Not charged" if not charged else "Charged less than the contract",
                    "text": f"{_fmt(charged)} charged of the {_fmt(contract)} contract — {_fmt(short)} not billed this month."})
    if contract and profile.get("mrr") is not None and abs(contract - profile["mrr"]) >= 0.5:
        out.append({"level": "warning", "title": "Contract differs from the Profile",
                    "text": f"The report says {_fmt(contract)} a month; the merchant's subscription MRR is {_fmt(profile['mrr'])}. Update whichever is wrong."})
    rs = (p["status"] or "").lower()
    ms = (profile.get("merchantStatus") or "").lower()
    if rs and ms and ((rs != "active" and ms == "active") or (rs == "active" and ms in ("paused", "churned"))):
        out.append({"level": "info", "title": "Status differs",
                    "text": f"The report marks this account \"{p['status']}\"; the merchant is {profile['merchantStatus'].title()} in the Super App."})
    if p["ordersRevenue"] == 0:
        out.append({"level": "info", "title": "No online-order revenue",
                    "text": "No online orders were recorded for this month."})
    elif prev and prev.get("ordersRevenue") and p["ordersRevenue"] is not None:
        ch = (p["ordersRevenue"] - prev["ordersRevenue"]) / prev["ordersRevenue"]
        if ch <= -0.3:
            out.append({"level": "warning", "title": "Online orders dropped",
                        "text": f"Online-order revenue fell {abs(ch):.0%} from the month before ({_fmt(prev['ordersRevenue'])} → {_fmt(p['ordersRevenue'])})."})
    return out


async def merchant_payments(db: AsyncSession, merchant_id: str) -> dict:
    rows = (await db.execute(select(MerchantPayment).where(MerchantPayment.merchant_id == merchant_id)
                             .order_by(MerchantPayment.month.desc()))).scalars().all()
    from sqlalchemy.orm import selectinload

    m = (await db.execute(select(Merchant).where(Merchant.id == merchant_id).options(selectinload(Merchant.subscription)))).scalar_one()
    sub = m.subscription
    profile = {
        "merchantStatus": m.status.value if getattr(m, "status", None) is not None and hasattr(m.status, "value") else (m.status or None),
        "packageCode": sub.package_code if sub else None,
        "subscriptionStatus": sub.status.value if sub and sub.status is not None else None,
        "mrr": float(sub.mrr) if sub and sub.mrr is not None else None,
        "googleAdsBudget": float(m.google_ads_budget) if m.google_ads_budget is not None else None,
    }
    data = [payment_dto(p) for p in rows]
    for i, d in enumerate(data):
        prev = data[i + 1] if i + 1 < len(data) else None
        d["returnMultiple"] = round(d["ordersRevenue"] / d["charged"], 1) if d["ordersRevenue"] is not None and d["charged"] else None
        d["ordersRevenueChange"] = (round((d["ordersRevenue"] - prev["ordersRevenue"]) / prev["ordersRevenue"], 4)
                                    if prev and prev.get("ordersRevenue") and d["ordersRevenue"] is not None else None)
        d["checks"] = checks(d, profile, prev)
    total = lambda k: round(sum(d[k] or 0 for d in data), 2)  # noqa: E731
    return {"profile": profile, "latest": data[0] if data else None, "months": data,
            "totals": {"months": len(data), "contract": total("contract"), "charged": total("charged"), "variance": total("variance"),
                       "ordersRevenue": total("ordersRevenue")}}
