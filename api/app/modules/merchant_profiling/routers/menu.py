"""Merchant → Profiling → Menu.

    GET  /merchants/:id/menu           the stored menu (+ logo, stats, last run)
    POST /merchants/:id/menu/extract   pull it fresh from Innowi Online Ordering
    GET  /merchants/:id/menu/export    CSV (?scope=valid|all)

Extraction runs in the background (menu_jobs.py): POST /extract returns 202
at once with lastStatus RUNNING, and GET /menu reports live `progress` until
it finishes. Creating a merchant with an Innowi ordering link starts one
automatically. A failed run keeps the previous items and records the reason.
"""
from __future__ import annotations

import csv
import io
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.common.audit import audited
from app.common.deps import AuthenticatedUser, get_current_user, require_capability
from app.db.schemas import qualified
from app.db.session import get_db
from app.models.menu import MerchantMenu, MerchantMenuItem
from app.models.profiling import Merchant
from app.modules.merchant_profiling import menu_extractor as mx
from app.modules.merchant_profiling import menu_jobs
from app.schemas.menu import ExtractMenuDto, MenuItemDto, MenuResponseDto, MenuStatsDto, MenuSummaryDto

_tables_ready = False


async def _require_menu_tables(db: AsyncSession = Depends(get_db)) -> None:
    """Turn "migration not applied" into a clear message instead of a bare 500.
    Checked once per process; cheap (to_regclass) and cached when present."""
    global _tables_ready
    if _tables_ready:
        return
    p = qualified("profiling")
    found = (
        await db.execute(
            text("select to_regclass(:a) is not null and to_regclass(:b) is not null"),
            {"a": f"{p}.merchant_menu", "b": f"{p}.merchant_menu_item"},
        )
    ).scalar()
    if not found:
        raise HTTPException(
            status_code=503,
            detail="The Menu tables aren't in the database yet. Stop the API, run `alembic upgrade head` in the innowi-superapp-api-fastapi folder, then start the API again.",
        )
    _tables_ready = True


router = APIRouter(
    tags=["Menu"],
    dependencies=[Depends(require_capability("profile.view")), Depends(_require_menu_tables)],
)
_edit = Depends(require_capability("profile.edit"))


async def _merchant_or_404(db: AsyncSession, merchant_id: str) -> Merchant:
    m = await db.get(Merchant, merchant_id)
    if not m:
        raise HTTPException(status_code=404, detail="Merchant not found")
    return m


async def _menu_row(db: AsyncSession, merchant_id: str) -> MerchantMenu | None:
    return (await db.execute(select(MerchantMenu).where(MerchantMenu.merchant_id == merchant_id))).scalar_one_or_none()


def _summary(merchant: Merchant, menu: MerchantMenu | None) -> dict:
    saved = (merchant.online_ordering or "").strip() or None
    link, found = menu_jobs.resolve_link(saved, menu.source_url if menu else None)
    base = {
        "merchantId": merchant.id,
        "exists": menu is not None and menu.extracted_at is not None,
        "merchantOnlineOrdering": saved,
        # The Innowi link the menu comes from (one in the text, or the one picked), and every one in the text.
        "merchantLinkUsable": link is not None,
        "merchantLink": link,
        "merchantLinks": found,
    }
    if not menu:
        return base
    return base | {
        "sourceUrl": menu.source_url,
        "subUrl": menu.sub_url,
        "branchId": menu.branch_id,
        "restaurantName": menu.restaurant_name,
        "logoUrl": menu.logo_url,
        "bannerUrl": menu.banner_url,
        "excludeCatering": menu.exclude_catering,
        "filterGraphics": menu.filter_graphics,
        "stats": MenuStatsDto(
            total=menu.total_count, valid=menu.valid_count,
            graphicSkipped=menu.graphic_skipped_count, noImage=menu.no_image_count,
        ),
        "lastStatus": menu_jobs.effective_status(menu)[0],
        "lastError": menu_jobs.effective_status(menu)[1],
        "progress": menu_jobs.progress_for(merchant.id),
        "lastAttemptAt": menu.last_attempt_at,
        "extractedAt": menu.extracted_at,
        "extractedBy": menu.extracted_by,
    }


async def _items(db: AsyncSession, merchant_id: str) -> list[MerchantMenuItem]:
    return list((await db.execute(
        select(MerchantMenuItem).where(MerchantMenuItem.merchant_id == merchant_id).order_by(MerchantMenuItem.position)
    )).scalars().all())


@router.get("/merchants/{merchant_id}/menu", response_model=MenuResponseDto)
async def get_menu(merchant_id: str, db: AsyncSession = Depends(get_db)):
    merchant = await _merchant_or_404(db, merchant_id)
    menu = await _menu_row(db, merchant_id)
    rows = await _items(db, merchant_id)
    categories: list[str] = []
    for r in rows:
        if r.category and r.category not in categories:
            categories.append(r.category)
    return MenuResponseDto(
        **_summary(merchant, menu),
        categories=categories,
        items=[
            MenuItemDto(
                id=r.id, name=r.name, price=float(r.price) if r.price is not None else None,
                category=r.category, description=r.description, imageUrl=r.image_url, status=r.status,
            )
            for r in rows
        ],
    )


@router.post("/merchants/{merchant_id}/menu/extract", response_model=MenuSummaryDto, status_code=202, dependencies=[_edit])
@audited(entity_type="MerchantMenu", merchant_id_param="merchant_id")
async def extract_menu(
    merchant_id: str,
    dto: ExtractMenuDto,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: AuthenticatedUser = Depends(get_current_user),
):
    """Starts an extraction in the background and returns at once (202,
    lastStatus RUNNING). Poll GET /menu for progress and the result."""
    merchant = await _merchant_or_404(db, merchant_id)
    link = (dto.link or "").strip()
    if not link:
        current = await _menu_row(db, merchant_id)
        resolved, found = menu_jobs.resolve_link(merchant.online_ordering, current.source_url if current else None)
        if not resolved and len(found) > 1:
            raise HTTPException(
                status_code=400,
                detail=f"This merchant's Online ordering has {len(found)} Innowi links ({', '.join(found)}). Pick the one to fetch the menu from.",
            )
        link = resolved or (merchant.online_ordering or "").strip()
    if not link:
        raise HTTPException(status_code=400, detail="This merchant has no online-ordering link yet. Paste the Innowi ordering link to extract the menu.")
    try:
        mx.extract_sub_url(link)
    except mx.MenuExtractionError as e:
        if not (dto.link or "").strip():
            # The saved value is often a platform name ("Toast, DoorDash"), not a link.
            raise HTTPException(
                status_code=400,
                detail=f"This merchant's Online ordering value (\"{link[:80]}\") isn't an Innowi ordering link. Paste the https://online-ordering.innowi.com/branch/… link instead.",
            )
        raise HTTPException(status_code=400, detail=str(e))

    started = await menu_jobs.start(
        merchant_id, link,
        exclude_catering=dto.excludeCatering, filter_graphics=dto.filterGraphics,
        save_link=dto.saveLink, user_email=user.email,
    )
    if not started:
        raise HTTPException(status_code=409, detail="The menu is already being extracted — wait for it to finish.")
    # The job wrote the RUNNING row in its own session: re-read it fresh.
    # (Not expire_all() — that would make the next access of `merchant`
    # lazy-load, which async SQLAlchemy can't do: MissingGreenlet → 500.)
    menu = (await db.execute(
        select(MerchantMenu).where(MerchantMenu.merchant_id == merchant_id).execution_options(populate_existing=True)
    )).scalar_one_or_none()
    return MenuSummaryDto(**_summary(merchant, menu))


@router.get("/merchants/{merchant_id}/menu/export")
async def export_menu(
    merchant_id: str,
    scope: Literal["valid", "all"] = Query("valid"),
    db: AsyncSession = Depends(get_db),
):
    merchant = await _merchant_or_404(db, merchant_id)
    rows = await _items(db, merchant_id)
    if scope == "valid":
        rows = [r for r in rows if r.status == mx.STATUS_VALID]
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["ProductName", "Price", "Category", "Description", "ImageLink", "Status"])
    for r in rows:
        w.writerow([
            r.name, f"${float(r.price):.2f}" if r.price is not None else "", r.category or "",
            r.description or "", r.image_url or "", r.status,
        ])
    slug = "".join(c if c.isalnum() else "-" for c in (merchant.restaurant_name or "menu").lower()).strip("-") or "menu"
    return Response(
        content="﻿" + buf.getvalue(),  # BOM so Excel opens it as UTF-8
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{slug}-menu.csv"'},
    )
