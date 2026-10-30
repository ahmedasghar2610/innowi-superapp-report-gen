"""Churned accounts — the win-back list.

A churned restaurant is a merchant with ``status = CHURNED`` and a
``merchant_churn`` record (why, when, who handled it, MRR/GPV at churn) plus
the win-back state the team works: status, owner, notes, next follow-up.

* ``churn.view``   — everyone: list, summary, detail.
* ``churn.manage`` — sales roles + managers: win-back fields, notes, marking a
  merchant churned, and (managers) correcting the churn facts.
* ``churn.import`` — managers: upload one of the CSM churn workbooks.
"""
from __future__ import annotations

import datetime as dt
import os
from collections import defaultdict
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.common.pagination import PageMeta
from app.common.deps import AuthenticatedUser, get_current_user, require_capability
from app.common.storage.upload_helpers import read_upload_within_limit
from app.db.session import get_db
from app.models.auth import User
from app.models.enums import MerchantStatus, UserStatus, WinbackStatus
from app.models.profiling import Merchant, MerchantChurn, MerchantChurnNote
from app.modules.churn.importer import apply_rows, parse_workbook
from app.schemas.churn import (
    ChurnContactDto,
    ChurnDetailDto,
    ChurnImportReportDto,
    ChurnListDto,
    ChurnLocationDto,
    ChurnNoteDto,
    ChurnQueryDto,
    ChurnRowDto,
    ChurnSummaryDto,
    CountDto,
    CreateChurnNoteDto,
    MarkChurnedDto,
    UpdateChurnDto,
)
from app.schemas.ops import PersonRefDto

router = APIRouter(prefix="/churn", tags=["Churned accounts"])
_view = Depends(require_capability("churn.view"))
_manage = Depends(require_capability("churn.manage"))
_import = Depends(require_capability("churn.import"))

_LOAD = (
    selectinload(MerchantChurn.merchant).selectinload(Merchant.contacts),
    selectinload(MerchantChurn.merchant).selectinload(Merchant.locations),
    selectinload(MerchantChurn.merchant).selectinload(Merchant.account_manager),
)


# ============================================================== helpers =====
def _person_name(u: User) -> str:
    full = f"{u.first_name or ''} {u.last_name or ''}".strip()
    return full or u.email


def _person(u: Optional[User]) -> Optional[PersonRefDto]:
    return PersonRefDto(id=u.id, name=_person_name(u), email=u.email) if u else None


def split_categories(cat: Optional[str]) -> list[str]:
    """'Price; Product Features' → ['Price', 'Product Features'] (also splits on commas)."""
    if not cat:
        return []
    out: list[str] = []
    for part in cat.replace(",", ";").split(";"):
        p = " ".join(part.split()).strip()
        if p and p not in out:
            out.append(p)
    return out


async def _users_by_id(db: AsyncSession, ids: set[Optional[str]]) -> dict[str, User]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return {u.id: u for u in (await db.execute(select(User).where(User.id.in_(ids)))).scalars().all()}


def _row(c: MerchantChurn, users: dict[str, User], notes_count: int = 0) -> ChurnRowDto:
    m = c.merchant
    contact = next((x for x in m.contacts if x.role.value == "OWNER"), None) or (m.contacts[0] if m.contacts else None)
    loc = next((x for x in m.locations if x.is_primary), None) or (m.locations[0] if m.locations else None)
    return ChurnRowDto(
        merchantId=m.id, churnId=c.id, restaurantName=m.restaurant_name, merchantCode=m.merchant_code,
        merchantStatus=m.status, region=m.region, innowiSolution=m.innowi_solution, accountTier=m.account_tier,
        accountManager=m.account_manager.name if m.account_manager else None,
        churnedOn=c.churned_on, category=c.category, categories=split_categories(c.category), reason=c.reason,
        csmName=c.csm_name, mrrAtChurn=c.mrr_at_churn, gpvAtChurn=c.gpv_at_churn, startDate=c.start_date,
        lastTouchpointOn=c.last_touchpoint_on, source=c.source,
        winbackStatus=c.winback_status, winbackOwner=_person(users.get(c.winback_owner_id or "")),
        winbackNotes=c.winback_notes, nextFollowUpOn=c.next_follow_up_on,
        contact=ChurnContactDto(id=contact.id, name=contact.name, email=contact.email, phone=contact.phone) if contact else None,
        location=ChurnLocationDto(address=loc.address, city=loc.city, state=loc.state, zip=loc.zip) if loc else None,
        notesCount=notes_count, updatedAt=c.updated_at,
    )


async def _churn_or_404(db: AsyncSession, merchant_id: str) -> MerchantChurn:
    # populate_existing: after a write in the same session the loaded
    # collections (notes, merchant) would otherwise be served stale.
    c = (await db.execute(select(MerchantChurn).options(*_LOAD, selectinload(MerchantChurn.notes))
                          .where(MerchantChurn.merchant_id == merchant_id)
                          .execution_options(populate_existing=True))).scalar_one_or_none()
    if not c:
        raise HTTPException(status_code=404, detail="No churn record for this merchant")
    return c


async def _detail(db: AsyncSession, c: MerchantChurn) -> ChurnDetailDto:
    users = await _users_by_id(db, {c.winback_owner_id, *(n.user_id for n in c.notes)})
    base = _row(c, users, notes_count=len(c.notes))
    return ChurnDetailDto(
        **base.model_dump(),
        notes=[ChurnNoteDto(id=n.id, body=n.body, author=_person(users.get(n.user_id or "")), createdAt=n.created_at) for n in c.notes],
        contacts=[ChurnContactDto(id=x.id, name=x.name, email=x.email, phone=x.phone) for x in c.merchant.contacts],
    )


# ================================================================= list =====
@router.get("", response_model=ChurnListDto, dependencies=[_view])
async def list_churned(query: ChurnQueryDto = Depends(), db: AsyncSession = Depends(get_db),
                       user: AuthenticatedUser = Depends(get_current_user)):
    stmt = select(MerchantChurn).join(Merchant, Merchant.id == MerchantChurn.merchant_id)
    conds = []
    if query.search:
        like = f"%{query.search.strip()}%"
        conds.append(or_(Merchant.restaurant_name.ilike(like), Merchant.merchant_code.ilike(like),
                         MerchantChurn.reason.ilike(like), MerchantChurn.csm_name.ilike(like)))
    if query.region:
        conds.append(Merchant.region.ilike(query.region))
    if query.category:
        conds.append(MerchantChurn.category.ilike(f"%{query.category}%"))
    if query.csm:
        conds.append(MerchantChurn.csm_name.ilike(f"%{query.csm}%"))
    if query.winbackStatus:
        conds.append(MerchantChurn.winback_status == query.winbackStatus)
    if query.ownerId:
        conds.append(MerchantChurn.winback_owner_id == query.ownerId)
    if query.mine:
        conds.append(MerchantChurn.winback_owner_id == user.id)
    if query.churnedFrom:
        conds.append(MerchantChurn.churned_on >= query.churnedFrom)
    if query.churnedTo:
        conds.append(MerchantChurn.churned_on <= query.churnedTo)
    if query.hasReason is True:
        conds.append(or_(MerchantChurn.category.is_not(None), MerchantChurn.reason.is_not(None)))
    elif query.hasReason is False:
        conds.append(MerchantChurn.category.is_(None))
        conds.append(MerchantChurn.reason.is_(None))
    for c in conds:
        stmt = stmt.where(c)

    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    sort_map = {
        "churnedOn": MerchantChurn.churned_on, "restaurantName": Merchant.restaurant_name,
        "mrrAtChurn": MerchantChurn.mrr_at_churn, "gpvAtChurn": MerchantChurn.gpv_at_churn,
        "updatedAt": MerchantChurn.updated_at, "nextFollowUpOn": MerchantChurn.next_follow_up_on,
    }
    col = sort_map[query.sortBy]
    order = [col.desc().nulls_last() if query.order == "desc" else col.asc().nulls_last(), Merchant.restaurant_name.asc()]
    rows = (await db.execute(stmt.options(*_LOAD).order_by(*order).offset(query.skip).limit(query.limit))).scalars().unique().all()

    note_counts: dict[str, int] = {}
    if rows:
        ids = [r.id for r in rows]
        q = select(MerchantChurnNote.churn_id, func.count()).where(MerchantChurnNote.churn_id.in_(ids)).group_by(MerchantChurnNote.churn_id)
        note_counts = dict((await db.execute(q)).all())
    users = await _users_by_id(db, {r.winback_owner_id for r in rows})
    return ChurnListDto(data=[_row(r, users, note_counts.get(r.id, 0)) for r in rows],
                        meta=PageMeta.build(query.page, query.limit, total))


@router.get("/summary", response_model=ChurnSummaryDto, dependencies=[_view])
async def churn_summary(db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(MerchantChurn).options(selectinload(MerchantChurn.merchant)))).scalars().all()

    def bucket() -> dict[str, dict[str, Decimal | int]]:
        return defaultdict(lambda: {"count": 0, "mrr": Decimal("0"), "gpv": Decimal("0")})

    by_region, by_cat, by_wb, by_csm, by_sol, by_month = bucket(), bucket(), bucket(), bucket(), bucket(), bucket()
    mrr_lost = gpv_lost = Decimal("0")
    with_reason = 0

    def add(b, key: str, c: MerchantChurn) -> None:
        b[key]["count"] += 1
        b[key]["mrr"] += c.mrr_at_churn or 0
        b[key]["gpv"] += c.gpv_at_churn or 0

    for c in rows:
        mrr_lost += c.mrr_at_churn or 0
        gpv_lost += c.gpv_at_churn or 0
        if c.category or c.reason:
            with_reason += 1
        add(by_region, c.merchant.region or "—", c)
        add(by_wb, c.winback_status.value, c)
        add(by_csm, c.csm_name or "—", c)
        add(by_sol, c.merchant.innowi_solution or "—", c)
        for cat in split_categories(c.category) or ["—"]:
            add(by_cat, cat, c)
        if c.churned_on:
            add(by_month, c.churned_on.strftime("%Y-%m"), c)

    def out(b, *, sort_by_key: bool = False) -> list[CountDto]:
        items = sorted(b.items(), key=(lambda kv: kv[0]) if sort_by_key else (lambda kv: -kv[1]["count"]))
        return [CountDto(key=k, count=v["count"], mrr=v["mrr"], gpv=v["gpv"]) for k, v in items]

    owners = (await db.execute(select(User).where(User.status == UserStatus.ACTIVE).order_by(User.first_name, User.email))).scalars().all()
    return ChurnSummaryDto(
        total=len(rows), withReason=with_reason, mrrLost=mrr_lost, gpvLost=gpv_lost,
        byRegion=out(by_region), byCategory=out(by_cat), byWinback=out(by_wb), byCsm=out(by_csm),
        bySolution=out(by_sol), byMonth=out(by_month, sort_by_key=True),
        regions=sorted(k for k in by_region if k != "—"),
        categories=sorted(k for k in by_cat if k != "—"),
        csms=sorted(k for k in by_csm if k != "—"),
        owners=[_person(u) for u in owners][:200],
    )


# =============================================================== import =====
@router.post("/import", response_model=ChurnImportReportDto, dependencies=[_import])
async def import_workbook(file: UploadFile = File(...), dryRun: bool = Query(False), db: AsyncSession = Depends(get_db)):
    """Upload a churn workbook (.xlsx). ``dryRun=true`` reports what would change without writing."""
    name = os.path.basename((file.filename or "workbook.xlsx").replace("\\", "/")).strip()[:255]
    if not name.lower().endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="Upload an Excel workbook (.xlsx)")
    data = await read_upload_within_limit(file)
    try:
        parsed = parse_workbook(data)
    except Exception as exc:  # noqa: BLE001 — openpyxl raises a mixed bag on bad files
        raise HTTPException(status_code=400, detail=f"Couldn't read the workbook: {exc}") from exc
    if not parsed.rows and all(s.layout == "unknown" for s in parsed.sheets):
        raise HTTPException(status_code=400, detail="No sheet with an 'Account Name' column was found")
    report = await apply_rows(db, parsed.rows, file_name=name, dry_run=dryRun, sheets=parsed.sheets)
    return ChurnImportReportDto(**report.__dict__)


# =============================================================== detail =====
@router.get("/{merchant_id}", response_model=ChurnDetailDto, dependencies=[_view])
async def get_churned(merchant_id: str, db: AsyncSession = Depends(get_db)):
    return await _detail(db, await _churn_or_404(db, merchant_id))


@router.post("/{merchant_id}", response_model=ChurnDetailDto, status_code=status.HTTP_201_CREATED, dependencies=[_manage])
async def mark_churned(merchant_id: str, dto: MarkChurnedDto, db: AsyncSession = Depends(get_db)):
    """Mark an existing merchant as churned: sets the status and creates the churn record."""
    m = await db.get(Merchant, merchant_id)
    if not m:
        raise HTTPException(status_code=404, detail="Merchant not found")
    existing = (await db.execute(select(MerchantChurn).where(MerchantChurn.merchant_id == merchant_id))).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail="This merchant already has a churn record")
    c = MerchantChurn(merchant_id=m.id, churned_on=dto.churnedOn or dt.date.today(), category=dto.category,
                      reason=dto.reason, csm_name=dto.csmName, mrr_at_churn=dto.mrrAtChurn, gpv_at_churn=dto.gpvAtChurn,
                      source="manual")
    m.status = MerchantStatus.CHURNED
    db.add(c)
    await db.commit()
    return await _detail(db, await _churn_or_404(db, merchant_id))


@router.patch("/{merchant_id}", response_model=ChurnDetailDto, dependencies=[_manage])
async def update_churned(merchant_id: str, dto: UpdateChurnDto, db: AsyncSession = Depends(get_db),
                         user: AuthenticatedUser = Depends(get_current_user)):
    c = await _churn_or_404(db, merchant_id)
    data = dto.model_dump(exclude_unset=True)
    facts = {"churnedOn", "category", "reason", "csmName", "mrrAtChurn", "gpvAtChurn"}
    if facts & set(data) and not user.can("churn.import"):
        raise HTTPException(status_code=403, detail="Changing the churn facts (date, reason, MRR) needs a manager")

    if "winbackOwnerId" in data and data["winbackOwnerId"]:
        owner = await db.get(User, data["winbackOwnerId"])
        if not owner or owner.status != UserStatus.ACTIVE:
            raise HTTPException(status_code=400, detail="Owner must be an active team member")
        c.winback_owner_id = owner.id
    if dto.clearWinbackOwner:
        c.winback_owner_id = None
    if "winbackStatus" in data:
        c.winback_status = dto.winbackStatus
        # Won back → the merchant is active again; the churn record stays as history.
        c.merchant.status = MerchantStatus.ACTIVE if dto.winbackStatus == WinbackStatus.WON_BACK else MerchantStatus.CHURNED
    if "winbackNotes" in data:
        c.winback_notes = dto.winbackNotes
    if "nextFollowUpOn" in data and dto.nextFollowUpOn:
        c.next_follow_up_on = dto.nextFollowUpOn
    if dto.clearNextFollowUp:
        c.next_follow_up_on = None
    for key, attr in (("churnedOn", "churned_on"), ("category", "category"), ("reason", "reason"), ("csmName", "csm_name"),
                      ("mrrAtChurn", "mrr_at_churn"), ("gpvAtChurn", "gpv_at_churn")):
        if key in data:
            setattr(c, attr, data[key])
    await db.commit()
    return await _detail(db, await _churn_or_404(db, merchant_id))


@router.post("/{merchant_id}/notes", response_model=ChurnDetailDto, status_code=status.HTTP_201_CREATED, dependencies=[_manage])
async def add_note(merchant_id: str, dto: CreateChurnNoteDto, db: AsyncSession = Depends(get_db),
                   user: AuthenticatedUser = Depends(get_current_user)):
    c = await _churn_or_404(db, merchant_id)
    db.add(MerchantChurnNote(churn_id=c.id, user_id=user.id, body=dto.body.strip()))
    c.last_touchpoint_on = dt.date.today()
    if c.winback_status == WinbackStatus.NOT_STARTED:
        c.winback_status = WinbackStatus.CONTACTED
    await db.commit()
    return await _detail(db, await _churn_or_404(db, merchant_id))


