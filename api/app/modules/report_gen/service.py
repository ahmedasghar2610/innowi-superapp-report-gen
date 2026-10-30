"""Report lifecycle.

    generating → draft → edited → approved → sent
                   ↓        ↓        ↓
                 deleted  deleted  deleted          (soft: the row and its audit trail stay)
    generating → failed (assembly error) · approved → failed (send error) → send again

Rules (Ahmed, 2026-10-30):
  * nothing is sent unless the report is approved and the send mode allows it;
  * the person who generated the current version cannot approve that version
    (Admin and Super Admin are exempt for the pilot);
  * a version is sent once — the service checks, and report_gen_send's partial
    unique index backs it up;
  * every generate / edit / approve / delete / send writes a report_gen_audit row.

The checks are plain functions so they are unit-tested without a database;
the async functions below only load rows, call them and write.
"""
from __future__ import annotations

import datetime as dt
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.enums import Role
from app.models.report_gen import ReportGenAudit, ReportGenReport, ReportGenSend, ReportGenSnapshot, utcnow
from app.modules.report_gen import whitelist
from app.modules.report_gen.assemble import build_payload
from app.modules.report_gen.periods import Period

GENERATING, DRAFT, EDITED, APPROVED, SENT, FAILED, DELETED = "generating", "draft", "edited", "approved", "sent", "failed", "deleted"
EDITABLE = (DRAFT, EDITED)
REGENERABLE = (DRAFT, EDITED, FAILED, DELETED)
DELETABLE = (DRAFT, EDITED, APPROVED, FAILED)
APPROVER_EXEMPT = (Role.ADMIN.value, Role.SUPER_ADMIN.value)
EDITABLE_KEYS = ("summary", "sectionNotes", "recommendations", "bottomLine")


class ReportError(Exception):
    """A refused transition; the router answers 409 with the message."""


# ------------------------------------------------------------- pure checks ----
def check_generate(status: Optional[str]) -> None:
    if status is None or status in REGENERABLE:
        return
    if status == GENERATING:
        raise ReportError("This report is being generated.")
    raise ReportError("This report is already approved. Delete it to make a new one.")


def check_edit(status: str) -> None:
    if status not in EDITABLE:
        raise ReportError("Only a draft can be edited. Approved, sent and deleted reports are frozen.")


def check_approve(status: str, generated_by_id: Optional[str], user_id: str, user_role: str) -> None:
    if status not in EDITABLE:
        raise ReportError("Only a draft can be approved.")
    if generated_by_id and generated_by_id == user_id and user_role not in APPROVER_EXEMPT:
        raise ReportError("The person who generated this version cannot approve it. Ask another approver.")


def check_delete(status: str) -> None:
    if status == SENT:
        raise ReportError("A sent report cannot be deleted; it has already reached the merchant.")
    if status == DELETED:
        raise ReportError("This report is already deleted.")
    if status not in DELETABLE:
        raise ReportError("This report cannot be deleted right now.")


def check_send(status: str, approved_at: Optional[dt.datetime], sent_at: Optional[dt.datetime], already_sent_version: bool) -> None:
    if sent_at or already_sent_version:
        raise ReportError("This version has already been sent.")
    if status == APPROVED:
        return
    if status == FAILED and approved_at:
        return  # a failed send may be retried
    raise ReportError("Only an approved report can be sent.")


def check_recipients(requested: list[str], allowed: list[str]) -> list[str]:
    """The addresses a send may go to: the merchant's own contacts (and, later, its
    report settings). Anything else is refused — a report never leaves for another merchant."""
    allowed_set = {a.lower() for a in allowed}
    chosen = [r.lower() for r in (requested or allowed)]
    bad = [r for r in chosen if r not in allowed_set]
    if bad:
        raise ReportError("Not a recipient of this merchant: " + ", ".join(sorted(set(bad))))
    out: list[str] = []
    for r in chosen:
        if r not in out:
            out.append(r)
    if not out:
        raise ReportError("This merchant has no report recipient (an OWNER or MARKETING contact with an e-mail).")
    return out


def apply_edit(payload: dict, patch: dict) -> tuple[dict, list[str]]:
    """A copy of `payload` with the reviewer's text changes applied. Only the four
    editable blocks can change; figures never do."""
    out = dict(payload)
    changed: list[str] = []
    for key in EDITABLE_KEYS:
        if key not in patch or patch[key] is None:
            continue
        value = patch[key]
        if key == "summary":
            value = [str(p).strip() for p in value if str(p).strip()][:6]
        elif key == "bottomLine":
            value = str(value).strip()
        elif key == "sectionNotes":
            value = {str(k): str(v).strip() for k, v in dict(value).items()}
        elif key == "recommendations":
            value = [
                {"action": str(r.get("action", "")).strip(), "why": str(r.get("why", "")).strip(),
                 "owner": str(r.get("owner", "")).strip(), "target": str(r.get("target", "")).strip()}
                for r in value if str(r.get("action", "")).strip()
            ][:8]
        out[key] = value
        changed.append(key)
    if changed:
        out["edited"] = {"keys": sorted(set((payload.get("edited") or {}).get("keys", [])) | set(changed))}
    return out, changed


# ----------------------------------------------------------------- loaders ----
async def get_report(db: AsyncSession, report_id: str) -> Optional[ReportGenReport]:
    return await db.get(ReportGenReport, report_id)


async def find_report(db: AsyncSession, merchant_id: str, period: Period, template: str = "monthly") -> Optional[ReportGenReport]:
    return (await db.execute(select(ReportGenReport).where(
        ReportGenReport.merchant_id == merchant_id, ReportGenReport.period_start == period.start,
        ReportGenReport.period_end == period.end, ReportGenReport.template == template,
    ))).scalar_one_or_none()


async def snapshot_of(db: AsyncSession, report: ReportGenReport, version: Optional[int] = None) -> Optional[ReportGenSnapshot]:
    v = version or report.current_version
    return (await db.execute(select(ReportGenSnapshot).where(
        ReportGenSnapshot.report_id == report.id, ReportGenSnapshot.version == v,
    ))).scalar_one_or_none()


async def versions_of(db: AsyncSession, report: ReportGenReport) -> list[dict]:
    rows = (await db.execute(select(ReportGenSnapshot.version, ReportGenSnapshot.frozen, ReportGenSnapshot.created_at, ReportGenSnapshot.created_by_id)
                             .where(ReportGenSnapshot.report_id == report.id).order_by(ReportGenSnapshot.version))).all()
    return [{"version": v, "frozen": f, "createdAt": c.isoformat() if c else None, "createdById": u} for v, f, c, u in rows]


async def history(db: AsyncSession, report: ReportGenReport) -> list[ReportGenAudit]:
    return list((await db.execute(select(ReportGenAudit).where(ReportGenAudit.report_id == report.id).order_by(ReportGenAudit.at))).scalars())


async def _audit(db: AsyncSession, report: ReportGenReport, action: str, user_id: Optional[str], note: Optional[str] = None, detail: Optional[dict] = None) -> None:
    db.add(ReportGenAudit(report_id=report.id, version=report.current_version, action=action, user_id=user_id, note=note, detail=detail or {}))


# ------------------------------------------------------------- transitions ----
async def generate(db: AsyncSession, merchant_id: str, period: Period, user_id: Optional[str], *, template: str = "monthly",
                   today: Optional[dt.date] = None) -> ReportGenReport:
    """Assemble a new version. Phase 0 assembles inside the request; Phase 1 moves
    the assembly to the job runner and only sets `generating` here."""
    today = today or dt.date.today()
    if period.end >= today:
        raise ReportError("Pick a month that has already ended.")
    r = await find_report(db, merchant_id, period, template)
    check_generate(r.status if r else None)
    if r is None:
        r = ReportGenReport(merchant_id=merchant_id, period_start=period.start, period_end=period.end, template=template)
        db.add(r)
        await db.flush()
    r.status, r.error = GENERATING, None
    r.generated_by_id, r.generated_at = user_id, utcnow()
    r.approved_by_id = r.approved_at = r.sent_at = r.deleted_by_id = r.deleted_at = None
    r.current_version += 1
    await db.flush()
    try:
        payload = await build_payload(db, merchant_id, period, template=template)
        whitelist.assert_clean(payload)
    except Exception as exc:  # the row records the failure; the caller sees status = failed
        r.status, r.error = FAILED, str(exc)[:2000]
        await _audit(db, r, "generate", user_id, note="failed", detail={"error": r.error})
        await db.flush()
        return r
    db.add(ReportGenSnapshot(report_id=r.id, version=r.current_version, payload=payload, created_by_id=user_id))
    r.status = DRAFT
    r.data_through = payload.get("dataThrough") or {}
    r.missing = payload.get("missing") or []
    await _audit(db, r, "generate", user_id, detail={"missing": len(r.missing)})
    await db.flush()
    return r


async def edit(db: AsyncSession, report: ReportGenReport, patch: dict, user_id: str) -> ReportGenSnapshot:
    check_edit(report.status)
    snap = await snapshot_of(db, report)
    if snap is None or snap.frozen:
        raise ReportError("This version cannot be edited.")
    payload, changed = apply_edit(snap.payload or {}, patch)
    if not changed:
        raise ReportError("Nothing to change.")
    whitelist.assert_clean(payload)
    snap.payload = payload
    report.status = EDITED
    await _audit(db, report, "edit", user_id, detail={"changed": changed})
    await db.flush()
    return snap


async def approve(db: AsyncSession, report: ReportGenReport, user_id: str, user_role: str) -> ReportGenReport:
    check_approve(report.status, report.generated_by_id, user_id, user_role)
    snap = await snapshot_of(db, report)
    if snap is None:
        raise ReportError("This report has no snapshot to approve.")
    snap.frozen = True
    report.status, report.approved_by_id, report.approved_at = APPROVED, user_id, utcnow()
    await _audit(db, report, "approve", user_id)
    await db.flush()
    return report


async def soft_delete(db: AsyncSession, report: ReportGenReport, user_id: str, note: Optional[str] = None) -> ReportGenReport:
    check_delete(report.status)
    was = report.status
    report.status, report.deleted_by_id, report.deleted_at = DELETED, user_id, utcnow()
    await _audit(db, report, "delete", user_id, note=note, detail={"from": was})
    await db.flush()
    return report


async def version_already_sent(db: AsyncSession, report: ReportGenReport) -> bool:
    row = (await db.execute(select(ReportGenSend.id).where(
        ReportGenSend.report_id == report.id, ReportGenSend.version == report.current_version, ReportGenSend.status == "sent",
    ).limit(1))).scalar_one_or_none()
    return row is not None


async def record_send(db: AsyncSession, report: ReportGenReport, *, mode: str, status: str, recipients: list[str], user_id: str,
                      error: Optional[str] = None) -> ReportGenSend:
    """`status`: dry_run (nothing left the building; the report stays approved) · sent · failed."""
    row = ReportGenSend(report_id=report.id, version=report.current_version, mode=mode, status=status, recipients=recipients,
                        sent_by_id=user_id, error=error)
    db.add(row)
    if status == "sent":
        report.status, report.sent_at, report.error = SENT, utcnow(), None
        await _audit(db, report, "send", user_id, detail={"mode": mode, "recipients": recipients})
    elif status == "failed":
        report.status, report.error = FAILED, error
        await _audit(db, report, "send_failed", user_id, note=error, detail={"mode": mode, "recipients": recipients})
    else:
        await _audit(db, report, "send", user_id, note="dry-run: nothing was sent", detail={"mode": mode, "recipients": recipients})
    await db.flush()
    return row
