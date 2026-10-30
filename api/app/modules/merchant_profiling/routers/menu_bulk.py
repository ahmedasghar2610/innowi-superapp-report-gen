"""Menus across merchants: can each one be fetched, and fetch them in one go.

    GET  /merchant-menus?ids=a,b            status per merchant (all merchants without ids)
    POST /merchant-menus/check              quick check that each Innowi branch exists (nothing downloaded)
    POST /merchant-menus/fetch              fetch the menus of the given merchants, one after another
    PUT  /merchant-menus/{merchant_id}/link pick the link when the Online ordering text has several

Status: fetched · running · queued · failed · ready (one Innowi link) · pick (several links, none chosen) ·
none (no Innowi link: the menu can't be fetched). The Online ordering text itself is never changed here.
"""
from __future__ import annotations

import asyncio
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.common.deps import AuthenticatedUser, get_current_user, require_capability
from app.db.session import get_db
from app.models.menu import MerchantMenu
from app.models.profiling import Merchant
from app.modules.merchant_profiling import menu_extractor as mx
from app.modules.merchant_profiling import menu_jobs

router = APIRouter(tags=["Menu"], dependencies=[Depends(require_capability("profile.view"))])
_edit = Depends(require_capability("profile.edit"))
CHECK_CONCURRENCY = 4


class IdsInput(BaseModel):
    merchantIds: list[str] = Field(default_factory=list, max_length=500)


class LinkInput(BaseModel):
    link: str = Field(..., max_length=500)


def menu_status(m: Merchant, menu: Optional[MerchantMenu]) -> dict:
    link, found = menu_jobs.resolve_link(m.online_ordering, menu.source_url if menu else None)
    out = {"merchantId": m.id, "restaurantName": m.restaurant_name, "merchantCode": m.merchant_code,
           "link": link, "links": found, "validCount": None, "extractedAt": None, "error": None, "progress": None}
    if menu:
        st, err = menu_jobs.effective_status(menu)
        out.update(validCount=menu.valid_count if menu.extracted_at else None,
                   extractedAt=menu.extracted_at.isoformat() if menu.extracted_at else None, error=err)
        if st == "RUNNING":
            prog = menu_jobs.progress_for(m.id)
            out.update(status="queued" if prog and prog.get("phase") == "queued" else "running", progress=prog)
            return out
        if st == "FAILED":
            out["status"] = "failed"
            return out
        if menu.extracted_at:
            out["status"] = "fetched"
            return out
    out["status"] = "ready" if link else "pick" if len(found) > 1 else "none"
    return out


async def _load(db: AsyncSession, ids: Optional[list[str]]) -> list[tuple[Merchant, Optional[MerchantMenu]]]:
    q = select(Merchant).order_by(Merchant.restaurant_name)
    if ids is not None:
        q = q.where(Merchant.id.in_(ids))
    merchants = (await db.execute(q)).scalars().all()
    menus = {mm.merchant_id: mm for mm in (await db.execute(
        select(MerchantMenu).where(MerchantMenu.merchant_id.in_([m.id for m in merchants]))
    )).scalars()} if merchants else {}
    return [(m, menus.get(m.id)) for m in merchants]


@router.get("/merchant-menus")
async def statuses(ids: Optional[str] = Query(None), db: AsyncSession = Depends(get_db)):
    wanted = [x for x in (ids or "").split(",") if x] if ids is not None else None
    rows = [menu_status(m, mm) for m, mm in await _load(db, wanted)]
    counts: dict[str, int] = {}
    for r in rows:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
    return {"data": rows, "counts": counts}


@router.post("/merchant-menus/check", dependencies=[_edit])
async def check(dto: IdsInput, db: AsyncSession = Depends(get_db)):
    """For each merchant with a link: does that Innowi branch exist? (One quick request each; nothing saved.)"""
    rows = await _load(db, dto.merchantIds or None)
    sem = asyncio.Semaphore(CHECK_CONCURRENCY)

    async def one(m: Merchant, mm: Optional[MerchantMenu]) -> dict:
        st = menu_status(m, mm)
        if not st["link"]:
            return {**st, "check": "no-link", "checkError": None}
        async with sem:
            try:
                await mx.check_branch(st["link"])
                return {**st, "check": "ok", "checkError": None}
            except mx.MenuExtractionError as e:
                return {**st, "check": "failed", "checkError": str(e)}

    return {"data": list(await asyncio.gather(*(one(m, mm) for m, mm in rows)))}


@router.post("/merchant-menus/fetch", dependencies=[_edit])
async def fetch(dto: IdsInput, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    """Fetch the menus of these merchants one after another. Merchants without a usable link are skipped (with why)."""
    if not dto.merchantIds:
        raise HTTPException(status_code=400, detail="Choose the merchants to fetch menus for.")
    items: list[tuple[str, str]] = []
    skipped: dict[str, str] = {}
    for m, mm in await _load(db, dto.merchantIds):
        st = menu_status(m, mm)
        if st["link"]:
            items.append((m.id, st["link"]))
        else:
            skipped[m.id] = (f"{len(st['links'])} Innowi links in Online ordering: pick one first." if len(st["links"]) > 1
                             else "No Innowi ordering link in Online ordering.")
    out = await menu_jobs.start_queue(items, user.email)
    out["skipped"] = {**skipped, **out["skipped"]}
    return out


@router.put("/merchant-menus/{merchant_id}/link", dependencies=[_edit])
async def pick_link(merchant_id: str, dto: LinkInput, db: AsyncSession = Depends(get_db)):
    """Choose which Innowi link the menu comes from (when the Online ordering text has several)."""
    m = await db.get(Merchant, merchant_id)
    if not m:
        raise HTTPException(status_code=404, detail="Merchant not found")
    try:
        link = mx.ordering_link(mx.extract_sub_url(dto.link))
    except mx.MenuExtractionError as e:
        raise HTTPException(status_code=400, detail=str(e))
    menu = (await db.execute(select(MerchantMenu).where(MerchantMenu.merchant_id == merchant_id))).scalar_one_or_none()
    if menu is None:
        menu = MerchantMenu(merchant_id=merchant_id)
        db.add(menu)
    menu.source_url = link
    menu.sub_url = mx.extract_sub_url(link)
    await db.commit()
    return menu_status(m, menu)
