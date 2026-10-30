"""Import the account list from the old Google Sheet ("Automation - Google Ads
Results.xlsx", tab "GBP Dashboard"): ACCOUNT NAME · CUSTOMER ID · MANAGER ID ·
Total Sales · No of Orders · STATUS.

Creates the accounts (source SHEET) so they appear before the first Google
sync, and fills the average-ticket inputs (Total Sales ÷ No of Orders) the
n8n workflow used. An account is linked to a merchant automatically only when
exactly one merchant has the same name (ignoring case and punctuation); the
rest wait under "Unmapped" with suggestions.

Weekly / monthly figures in the sheet are NOT imported: they have no dates
(the tabs are overwritten every month and MonthlyReport has no month column)
and the first sync re-reads ADS_HISTORY_DAYS of history from Google anyway.
"""
from __future__ import annotations

import io
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ads import AdsAccount, utcnow
from app.models.profiling import Merchant
from app.modules.ads import calc
from app.modules.ads.reports import norm_name

HEADERS = {"account name": "name", "customer id": "customer_id", "manager id": "manager_id", "total sales": "total_sales", "no of orders": "orders", "status": "status"}


class ImportError_(ValueError):
    pass


def read_rows(data: bytes) -> list[dict]:
    from openpyxl import load_workbook  # loads only when a workbook is imported

    try:
        wb = load_workbook(io.BytesIO(data), data_only=True, read_only=True)
    except Exception as exc:  # not an xlsx
        raise ImportError_("That file isn't a readable .xlsx workbook.") from exc
    for ws in wb.worksheets:
        rows = ws.iter_rows(values_only=True)
        header = next(rows, None) or ()
        cols = {i: HEADERS[str(h).strip().lower()] for i, h in enumerate(header) if h and str(h).strip().lower() in HEADERS}
        if "customer_id" not in cols.values() or "name" not in cols.values():
            continue
        out = []
        for r in rows:
            rec: dict[str, Any] = {cols[i]: r[i] for i in cols if i < len(r)}
            cid = calc.clean_customer_id(rec.get("customer_id"))
            if len(cid) != 10 or not rec.get("name"):
                continue
            out.append(
                {
                    "customer_id": cid,
                    "name": str(rec["name"]).strip(),
                    "manager_id": calc.clean_customer_id(rec.get("manager_id")) or None,
                    "total_sales": _num(rec.get("total_sales")),
                    "orders": _num(rec.get("orders")),
                    "status": str(rec.get("status") or "").strip(),
                }
            )
        return out
    raise ImportError_('No sheet with "ACCOUNT NAME" and "CUSTOMER ID" columns was found (the old sheet\'s "GBP Dashboard" tab).')


def _num(v: Any) -> Optional[float]:
    if v is None or v == "":
        return None
    try:
        return float(str(v).replace("$", "").replace(",", "").strip())
    except ValueError:
        return None


async def import_accounts(db: AsyncSession, data: bytes) -> dict:
    recs = read_rows(data)
    merchants = list((await db.execute(select(Merchant.id, Merchant.restaurant_name))).all())
    by_name: dict[str, list[str]] = {}
    for mid, name in merchants:
        by_name.setdefault(norm_name(name), []).append(mid)
    created = updated = linked = 0
    out = []
    for r in recs:
        acc = (await db.execute(select(AdsAccount).where(AdsAccount.customer_id == r["customer_id"]))).scalar_one_or_none()
        action = "updated"
        if not acc:
            acc = AdsAccount(customer_id=r["customer_id"], name=r["name"], source="SHEET", state="active", first_seen_at=utcnow())
            db.add(acc)
            created += 1
            action = "created"
        else:
            updated += 1
        if acc.source == "SHEET":
            acc.name = r["name"]
        acc.manager_customer_id = acc.manager_customer_id or r["manager_id"]
        if r["total_sales"] and r["orders"]:
            acc.ticket_total_sales = r["total_sales"]
            acc.ticket_order_count = int(r["orders"])
            acc.ticket_updated_at = utcnow()
        link = None
        if not acc.merchant_id:
            cands = by_name.get(norm_name(r["name"]), [])
            if len(cands) == 1:
                acc.merchant_id = cands[0]
                linked += 1
                link = cands[0]
        out.append({"customerId": calc.format_customer_id(r["customer_id"]), "name": r["name"], "action": action, "sheetStatus": r["status"], "linkedMerchantId": link})
    await db.commit()
    return {"created": created, "updated": updated, "linked": linked, "rows": out}
