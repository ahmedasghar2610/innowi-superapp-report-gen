"""Merchants → Import from XLS / CSV (modules/merchant_profiling/merchant_import.py).

    POST /merchants/import?dryRun=true    preview: what the file would create / fill / conflict (nothing written)
    POST /merchants/import                apply the same file; form field `decisions` (JSON) picks the
                                          conflicts that take the sheet value:
                                          {"useSheet": ["M-001::merchant.legal_name", ...], "useSheetAll": ["M-002"]}

Existing values are kept unless chosen; lists only gain new entries; nothing is deleted.
A Promotions sheet in the workbook (or a CSV that is one) adds each merchant's promotions
(promotions_import.py) — ones already there are skipped; so do its Access sheet (→ Connections)
and Delivery sheet (→ Services) (workbook_sheets.py).
"""
from __future__ import annotations

import json
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.common.deps import AuthenticatedUser, get_current_user, require_capability
from app.db.session import get_db
from app.modules.merchant_profiling import merchant_import as mi
from app.modules.merchant_profiling import promotions_import as pi
from app.modules.merchant_profiling import workbook_sheets as ws
from app.modules.merchant_profiling.completeness_service import refresh_completion_cache

router = APIRouter(tags=["Merchants"])


@router.post("/merchants/import", dependencies=[Depends(require_capability("merchant.create"))])
async def import_merchants(
    file: UploadFile = File(...),
    dryRun: bool = Query(False),
    decisions: Optional[str] = Form(None),
    db: AsyncSession = Depends(get_db),
    user: AuthenticatedUser = Depends(get_current_user),
):
    data = await file.read()
    promos = pi.read_promotions(data, file.filename or "")
    if promos and promos.whole_file:
        sheet = mi.Sheet(rows=[], unknown_columns=[], sheet=None)  # a CSV of promotions only
    else:
        try:
            sheet = mi.read_file(data, file.filename or "")
        except mi.ImportError_ as exc:
            if not promos:
                raise HTTPException(status_code=400, detail=str(exc))
            sheet = mi.Sheet(rows=[], unknown_columns=[], sheet=None)  # a workbook with only a Promotions sheet
    if dryRun:
        out = await mi.plan(db, sheet)
        out["promotions"] = pi.public(await pi.plan(db, promos, out["rows"])) if promos else None
        out["otherSheets"] = await ws.plan(db, ws.read_sheets(data, file.filename or ""), out["rows"])
        return out
    use_sheet: set[str] = set()
    use_all: set[str] = set()
    if decisions:
        try:
            d = json.loads(decisions)
            use_sheet = {str(x) for x in d.get("useSheet") or []}
            use_all = {str(x) for x in d.get("useSheetAll") or []}
        except (ValueError, AttributeError):
            raise HTTPException(status_code=400, detail="`decisions` must be JSON like {\"useSheet\": [...], \"useSheetAll\": [...]}.")
    result = await mi.apply(db, sheet, use_sheet, use_all, file_name=file.filename)
    result["promotions"] = pi.public(await pi.apply(db, promos, result["rows"])) if promos else None
    result["otherSheets"] = await ws.plan(db, ws.read_sheets(data, file.filename or ""), result["rows"], apply=True)
    await db.commit()
    for mid in result["applied"]["merchantIds"]:
        await refresh_completion_cache(db, mid)
    # The connector: link the SEO sites / Ads accounts that clearly match the imported merchants.
    from app.modules.linking import connector
    if result["applied"]["merchantIds"]:
        result["connected"] = await connector.connect_quietly(db, list(result["applied"]["merchantIds"]), user.id)
    return result
