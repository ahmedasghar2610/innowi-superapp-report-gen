"""Report Generator — Marketing → Merchant Reports. Every route is behind
report_gen.view AND the REPORT_GEN_ENABLED flag (404 while off).

    GET    /report-gen/status                            flag, send mode, what this user may do
    GET    /report-gen/queue?month=YYYY-MM               every active merchant and its report for the month
    POST   /report-gen/merchants/{id}/reports            generate a draft (report_gen.manage)
    GET    /report-gen/reports/{id}                      report, snapshot, versions, history
    PATCH  /report-gen/reports/{id}/text                 summary / section notes / recommendations / bottom line (manage)
    POST   /report-gen/reports/{id}/approve              freeze the snapshot (report_gen.approve)
    DELETE /report-gen/reports/{id}                      soft delete (manage)
    POST   /report-gen/reports/{id}/send                 send the approved report (approve); dry-run by default
    GET    /report-gen/reports/{id}/preview              the merchant-facing payload (no recipients, no reviewer names)
    GET    /report-gen/reports/{id}/export.pdf           the approved snapshot as a PDF download
    GET    /report-gen/reports/{id}/export.docx          the approved snapshot as a Word download
"""
from __future__ import annotations

import datetime as dt
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.common.audit import audited
from app.common.deps import AuthenticatedUser, get_current_user, require_capability
from app.db.session import get_db
from app.models.ads import AdsAccount
from app.models.auth import User
from app.models.catalog import Service
from app.models.enums import MerchantServiceStatus, MerchantStatus
from app.models.profiling import Merchant, MerchantService
from app.models.report_gen import ReportGenReport
from app.models.seo import SeoSite
from app.modules.report_gen import exports, flag, sender, service
from app.modules.report_gen.periods import Period, parse_month

logger = logging.getLogger("ReportGen")

router = APIRouter(
    prefix="/report-gen", tags=["Report Generator"],
    dependencies=[Depends(require_capability("report_gen.view")), Depends(flag.require_enabled)],
)
_manage = Depends(require_capability("report_gen.manage"))
_approve = Depends(require_capability("report_gen.approve"))


# ----------------------------------------------------------------- helpers ----
def _month(value: Optional[str]) -> Period:
    try:
        return parse_month(value)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


def _iso(v) -> Optional[str]:
    return v.isoformat() if v else None


async def _users(db: AsyncSession, ids) -> dict[str, dict]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    rows = (await db.execute(select(User.id, User.first_name, User.last_name, User.email).where(User.id.in_(ids)))).all()
    return {r.id: {"id": r.id, "name": " ".join(x for x in (r.first_name, r.last_name) if x) or r.email} for r in rows}


async def _report(db: AsyncSession, report_id: str) -> ReportGenReport:
    r = await service.get_report(db, report_id)
    if not r:
        raise HTTPException(status_code=404, detail="Report not found")
    return r


async def _read_report(id: str, db: AsyncSession) -> Optional[dict]:
    r = await service.get_report(db, id)
    if not r:
        return None
    return {"id": r.id, "merchantId": r.merchant_id, "period": f"{r.period_start}..{r.period_end}", "status": r.status, "version": r.current_version}


_resolve_merchant = lambda e: e.get("merchantId") if e else None  # noqa: E731


def _report_ref(r: ReportGenReport) -> dict:
    return {
        "id": r.id, "merchantId": r.merchant_id, "template": r.template, "status": r.status, "version": r.current_version,
        "period": Period(r.period_start, r.period_end).dto(),
        "generatedAt": _iso(r.generated_at), "approvedAt": _iso(r.approved_at), "sentAt": _iso(r.sent_at), "deletedAt": _iso(r.deleted_at),
        "error": r.error, "missingCount": len(r.missing or []), "dataThrough": r.data_through or {},
    }


async def _report_dto(db: AsyncSession, r: ReportGenReport, user: AuthenticatedUser) -> dict:
    snap = await service.snapshot_of(db, r)
    hist = await service.history(db, r)
    users = await _users(db, [r.generated_by_id, r.approved_by_id, r.deleted_by_id, *(h.user_id for h in hist)])
    merchant = (await db.execute(select(Merchant.id, Merchant.restaurant_name).where(Merchant.id == r.merchant_id))).first()
    payload = snap.payload if snap else {}
    can_approve = user.can("report_gen.approve")
    try:
        service.check_approve(r.status, r.generated_by_id, user.id, user.role)
        approve_blocked = None
    except service.ReportError as exc:
        approve_blocked = str(exc)
    return {
        **_report_ref(r),
        "merchant": {"id": merchant.id, "name": merchant.restaurant_name} if merchant else None,
        "generatedBy": users.get(r.generated_by_id), "approvedBy": users.get(r.approved_by_id), "deletedBy": users.get(r.deleted_by_id),
        "snapshot": payload, "frozen": bool(snap and snap.frozen),
        "missing": r.missing or [],
        "versions": await service.versions_of(db, r),
        "history": [{"action": h.action, "version": h.version, "user": users.get(h.user_id), "at": _iso(h.at), "note": h.note, "detail": h.detail or {}} for h in hist],
        "defaultRecipients": list(payload.get("recipients") or []),
        "sendMode": sender.mode(),
        "canManage": user.can("report_gen.manage"), "canApprove": can_approve, "approveBlocked": approve_blocked,
    }


# ------------------------------------------------------------------ status ----
@router.get("/status")
async def status(user: AuthenticatedUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    counts = dict((await db.execute(select(ReportGenReport.status, func.count()).group_by(ReportGenReport.status))).all())
    return {"enabled": flag.enabled(), "sendMode": sender.mode(), "canManage": user.can("report_gen.manage"),
            "canApprove": user.can("report_gen.approve"), "counts": {k: int(v) for k, v in counts.items()}}


# ------------------------------------------------------------------- queue ----
@router.get("/queue")
async def queue(month: Optional[str] = Query(None, description="YYYY-MM; default = last month"), db: AsyncSession = Depends(get_db)):
    p = _month(month)
    merchants = (await db.execute(select(Merchant.id, Merchant.restaurant_name, Merchant.cuisine_category, Merchant.location_count)
                                  .where(Merchant.status == MerchantStatus.ACTIVE).order_by(Merchant.restaurant_name))).all()
    ids = [m.id for m in merchants]
    reports = {r.merchant_id: r for r in (await db.execute(select(ReportGenReport).where(
        ReportGenReport.period_start == p.start, ReportGenReport.period_end == p.end, ReportGenReport.template == "monthly"))).scalars()}
    ads = dict((await db.execute(select(AdsAccount.merchant_id, func.count()).where(
        AdsAccount.merchant_id.in_(ids), AdsAccount.state == "active", AdsAccount.source != "DEMO").group_by(AdsAccount.merchant_id))).all()) if ids else {}
    seo = dict((await db.execute(select(SeoSite.merchant_id, func.count()).where(
        SeoSite.merchant_id.in_(ids), SeoSite.status == "active", SeoSite.source != "DEMO").group_by(SeoSite.merchant_id))).all()) if ids else {}
    services: dict[str, list[str]] = {}
    if ids:
        for mid, name in (await db.execute(select(MerchantService.merchant_id, Service.name).join(Service, Service.id == MerchantService.service_id)
                                           .where(MerchantService.merchant_id.in_(ids), MerchantService.status == MerchantServiceStatus.ACTIVE))).all():
            services.setdefault(mid, []).append(name)
    rows = []
    for m in merchants:
        r = reports.get(m.id)
        rows.append({
            "merchant": {"id": m.id, "name": m.restaurant_name, "cuisine": m.cuisine_category, "locationCount": m.location_count},
            "services": sorted(services.get(m.id, [])),
            "links": {"ads": int(ads.get(m.id, 0)), "seo": int(seo.get(m.id, 0))},
            "report": _report_ref(r) if r else None,
        })
    by_status: dict[str, int] = {}
    for r in reports.values():
        by_status[r.status] = by_status.get(r.status, 0) + 1
    return {"period": p.dto(), "merchants": rows, "counts": {"merchants": len(rows), "due": len(rows) - len(reports), **by_status}}


# ---------------------------------------------------------------- generate ----
class GenerateInput(BaseModel):
    model_config = {"extra": "forbid"}
    month: Optional[str] = Field(None, pattern=r"^\d{4}-\d{2}$")


@router.post("/merchants/{merchant_id}/reports", status_code=201, dependencies=[_manage])
@audited(entity_type="ReportGenReport", merchant_id_param="merchant_id")
async def generate(merchant_id: str, dto: GenerateInput, request: Request, db: AsyncSession = Depends(get_db),
                   user: AuthenticatedUser = Depends(get_current_user)):
    p = _month(dto.month)
    if not await db.get(Merchant, merchant_id):
        raise HTTPException(status_code=404, detail="Merchant not found")
    try:
        r = await service.generate(db, merchant_id, p, user.id)
    except service.ReportError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    await db.commit()
    return await _report_dto(db, r, user)


# ------------------------------------------------------------------ report ----
@router.get("/reports/{report_id}")
async def get_report(report_id: str, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    return await _report_dto(db, await _report(db, report_id), user)


class TextInput(BaseModel):
    model_config = {"extra": "forbid"}
    summary: Optional[list[str]] = Field(None, max_length=6)
    sectionNotes: Optional[dict[str, str]] = None
    recommendations: Optional[list[dict]] = Field(None, max_length=8)
    bottomLine: Optional[str] = Field(None, max_length=1000)


@router.patch("/reports/{report_id}/text", dependencies=[_manage])
@audited(entity_type="ReportGenReport", id_param="report_id", read=_read_report, resolve_merchant_id=_resolve_merchant)
async def edit_text(report_id: str, dto: TextInput, request: Request, db: AsyncSession = Depends(get_db),
                    user: AuthenticatedUser = Depends(get_current_user)):
    r = await _report(db, report_id)
    if any(len(x) > 2000 for x in (dto.summary or [])) or any(len(v) > 2000 for v in (dto.sectionNotes or {}).values()):
        raise HTTPException(status_code=400, detail="Keep each paragraph under 2,000 characters.")
    try:
        await service.edit(db, r, dto.model_dump(exclude_none=True), user.id)
    except (service.ReportError, ValueError) as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    await db.commit()
    return await _report_dto(db, r, user)


@router.post("/reports/{report_id}/approve", dependencies=[_approve])
@audited(entity_type="ReportGenReport", id_param="report_id", read=_read_report, resolve_merchant_id=_resolve_merchant)
async def approve(report_id: str, request: Request, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    r = await _report(db, report_id)
    try:
        await service.approve(db, r, user.id, user.role)
    except service.ReportError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    await db.commit()
    return await _report_dto(db, r, user)


class DeleteInput(BaseModel):
    model_config = {"extra": "forbid"}
    note: Optional[str] = Field(None, max_length=400)


@router.delete("/reports/{report_id}", dependencies=[_manage])
@audited(entity_type="ReportGenReport", id_param="report_id", read=_read_report, resolve_merchant_id=_resolve_merchant)
async def delete_report(report_id: str, request: Request, dto: Optional[DeleteInput] = None, db: AsyncSession = Depends(get_db),
                        user: AuthenticatedUser = Depends(get_current_user)):
    r = await _report(db, report_id)
    try:
        await service.soft_delete(db, r, user.id, dto.note if dto else None)
    except service.ReportError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    await db.commit()
    return await _report_dto(db, r, user)


class SendInput(BaseModel):
    model_config = {"extra": "forbid"}
    recipients: Optional[list[EmailStr]] = Field(None, max_length=10)


@router.post("/reports/{report_id}/send", dependencies=[_approve])
@audited(entity_type="ReportGenReport", id_param="report_id", read=_read_report, resolve_merchant_id=_resolve_merchant)
async def send_report(report_id: str, dto: SendInput, request: Request, db: AsyncSession = Depends(get_db),
                      user: AuthenticatedUser = Depends(get_current_user)):
    r = await _report(db, report_id)
    snap = await service.snapshot_of(db, r)
    try:
        service.check_send(r.status, r.approved_at, r.sent_at, await service.version_already_sent(db, r))
        allowed = list((snap.payload if snap else {}).get("recipients") or [])
        recipients = service.check_recipients([str(e) for e in (dto.recipients or [])], allowed)
    except service.ReportError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    merchant_name = ((snap.payload if snap else {}).get("merchant") or {}).get("name") or "Merchant"
    try:
        result = await sender.send(merchant_name, Period(r.period_start, r.period_end), recipients)
    except sender.SendNotReady as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except Exception as exc:  # a real delivery error (Phase 1): record it, let the reviewer retry
        logger.exception("Report %s send failed", r.id)
        await service.record_send(db, r, mode=sender.mode(), status="failed", recipients=recipients, user_id=user.id, error=str(exc)[:2000])
        await db.commit()
        raise HTTPException(status_code=502, detail=f"Sending failed: {exc}")
    await service.record_send(db, r, mode=result.mode, status=result.status, recipients=result.recipients, user_id=user.id)
    await db.commit()
    return {**await _report_dto(db, r, user), "send": {"mode": result.mode, "status": result.status, "recipients": result.recipients, "subject": result.subject}}


async def _export(report_id: str, kind: str, db: AsyncSession) -> Response:
    """The approved snapshot as a download. Same read permission as the preview:
    it is the same merchant-facing content, in a file instead of JSON."""
    r = await _report(db, report_id)
    try:
        name, data = await service.export(db, r, kind)
    except service.ReportError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    return Response(content=data, media_type=exports.MEDIA_TYPES[kind],
                    headers={"Content-Disposition": f'attachment; filename="{name}"', "Cache-Control": "private, no-store"})


@router.get("/reports/{report_id}/export.pdf")
async def export_pdf(report_id: str, db: AsyncSession = Depends(get_db)):
    return await _export(report_id, "pdf", db)


@router.get("/reports/{report_id}/export.docx")
async def export_docx(report_id: str, db: AsyncSession = Depends(get_db)):
    return await _export(report_id, "docx", db)


@router.get("/reports/{report_id}/preview")
async def preview(report_id: str, db: AsyncSession = Depends(get_db)):
    """What the merchant would see: the frozen or current snapshot without addressing or reviewer details."""
    r = await _report(db, report_id)
    snap = await service.snapshot_of(db, r)
    payload = dict(snap.payload if snap else {})
    payload.pop("recipients", None)
    payload.pop("edited", None)
    return {"id": r.id, "status": r.status, "version": r.current_version, "frozen": bool(snap and snap.frozen), "document": payload,
            "preparedBy": "Innowi Inc.", "generatedAt": _iso(r.generated_at), "approvedAt": _iso(r.approved_at)}
