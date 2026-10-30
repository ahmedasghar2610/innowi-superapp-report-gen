"""Google Business Profile reporting — Web & Search → GBP.

    GET    /gbp/status                          connection + last sync (everyone)
    POST   /gbp/connect                         Google consent URL (gbp.manage)
    DELETE /gbp/connection                      disconnect + revoke (gbp.manage)
    POST   /gbp/sync                            "Refresh data": start a sync in the background (gbp.manage)
    POST   /gbp/sample-data · DELETE            load / remove the 150 sample listings (gbp.manage)
    GET    /gbp/sync-runs                       recent runs
    GET    /gbp/overview?start&end              all listings: cards, top, needs attention, table
    GET    /gbp/locations/{id}/report?start&end&keywordMonth
    GET    /gbp/locations/{id}/notes            internal reporting notes
    POST   /gbp/locations/{id}/notes
    PATCH  /gbp/notes/{id}  ·  DELETE /gbp/notes/{id}   (author, or gbp.manage)
    GET    /gbp/locations/{id}/merchant-suggestions
    PUT    /gbp/locations/{id}/merchant         link a merchant (gbp.manage)
    DELETE /gbp/locations/{id}/merchant         unlink (gbp.manage)
    GET    /merchants/{merchantId}/gbp          listings linked to a merchant

    GET    /integrations/gbp/callback           Google → us after consent (no login; signed state)

Read-only towards Google: nothing here edits a Business Profile.
"""
from __future__ import annotations

import logging
import re
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.common.audit import audited
from app.config import get_settings
from app.common import jobs
from app.common.deps import AuthenticatedUser, get_current_user, require_capability
from app.db.session import get_db
from app.models.auth import User
from app.models.gbp import GbpLocation, GbpNote, GbpSyncRun, utcnow
from app.models.profiling import Contact, Merchant
from app.modules.gbp import connection, google, reports, sync

logger = logging.getLogger("GBP")

router = APIRouter(prefix="/gbp", tags=["GBP"], dependencies=[Depends(require_capability("gbp.view"))])
merchant_router = APIRouter(tags=["GBP"], dependencies=[Depends(require_capability("gbp.view"))])
callback_router = APIRouter(prefix="/integrations/gbp", tags=["Integrations"])


def _http() -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=httpx.Timeout(30.0))


def _name(u: Optional[User]) -> Optional[str]:
    if not u:
        return None
    return f"{u.first_name or ''} {u.last_name or ''}".strip() or u.email


def _run_dto(run: Optional[GbpSyncRun]) -> Optional[dict]:
    if not run:
        return None
    return {
        "id": run.id,
        "trigger": run.trigger,
        "status": run.status,
        "startedAt": run.started_at.isoformat(),
        "finishedAt": run.finished_at.isoformat() if run.finished_at else None,
        "locations": run.locations,
        "locationsFailed": run.locations_failed,
        "metricDays": run.metric_days,
        "reviews": run.reviews,
        "error": run.error,
    }


# ================================================================ status ====
@router.get("/status")
async def status(db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    conn = await connection.current(db)
    runs = await sync.last_runs(db, 1)
    counts = await sync.counts(db)
    run_now = await sync.running(db)
    by = await db.get(User, conn.connected_by_id) if conn and conn.connected_by_id else None
    return {
        "missingEnv": connection.missing_env(),
        "redirectUri": get_settings().GBP_OAUTH_REDIRECT_URI,
        "connected": bool(conn and conn.status == "connected"),
        "connection": {
            "email": conn.google_email,
            "status": conn.status,
            "error": conn.last_error,
            "connectedAt": conn.connected_at.isoformat(),
            "connectedBy": _name(by),
            "lastSyncAt": conn.last_sync_at.isoformat() if conn.last_sync_at else None,
        }
        if conn
        else None,
        "lastRun": _run_dto(runs[0] if runs else None),
        "running": bool(run_now),
        "locations": {"google": counts.get("GOOGLE", 0), "demo": counts.get("DEMO", 0)},
        "dataThrough": (d.isoformat() if (d := await reports.data_through(db)) else None),
        "canManage": user.can("gbp.manage"),
        "autoSync": _auto_sync(),
    }


def _auto_sync() -> dict:
    from app.modules.gbp import scheduler

    s = get_settings()
    return {
        "enabled": s.GBP_AUTO_SYNC,
        "hour": s.GBP_AUTO_SYNC_HOUR,
        "timezone": s.GBP_TIMEZONE,
        "nextAt": scheduler.next_slot(utcnow(), s.GBP_AUTO_SYNC_HOUR, s.GBP_TIMEZONE).isoformat() if s.GBP_AUTO_SYNC else None,
    }


@router.post("/sample-data", dependencies=[Depends(require_capability("gbp.manage"))])
async def load_sample_data(db: AsyncSession = Depends(get_db)):
    """Load the 150 sample listings (only while no real listings are synced)."""
    import datetime as dt

    from app.modules.gbp import demo

    try:
        t = await demo.load(db, dt.date.today())
    except demo.DemoRefused as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    return t


@router.delete("/sample-data", dependencies=[Depends(require_capability("gbp.manage"))])
async def remove_sample_data(db: AsyncSession = Depends(get_db)):
    from app.modules.gbp import demo

    return {"removed": await demo.remove(db)}


@router.post("/connect", dependencies=[Depends(require_capability("gbp.manage"))])
async def connect(
    returnTo: str = Query("gbp", pattern="^(gbp|settings)$", description="Page Google sends the browser back to"),
    user: AuthenticatedUser = Depends(get_current_user),
):
    try:
        return {"url": connection.connect_url(user.id, returnTo)}
    except connection.NotConfigured as exc:
        raise HTTPException(status_code=409, detail=str(exc))


@router.delete("/connection", status_code=204, dependencies=[Depends(require_capability("gbp.manage"))])
async def disconnect(db: AsyncSession = Depends(get_db)):
    async with _http() as http:
        await connection.disconnect(db, http)


@router.post("/sync", dependencies=[Depends(require_capability("gbp.manage"))])
async def start_sync(db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    conn = await connection.current(db)
    if not conn:
        raise HTTPException(status_code=409, detail="Connect Google Business Profile first.")
    missing = connection.missing_env()
    if missing:
        raise HTTPException(status_code=409, detail="Add " + ", ".join(missing) + " to the API's settings (environment variables) and redeploy it.")
    try:
        run = await sync.create_run(db, "manual", user.id)
    except sync.SyncBusy as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    await sync.start_background(run.id)
    if jobs.inline():  # the sync already ran inside this request
        await db.refresh(run)
    return _run_dto(run)


@router.get("/sync-runs")
async def sync_runs(limit: int = Query(10, ge=1, le=50), db: AsyncSession = Depends(get_db)):
    return {"data": [_run_dto(r) for r in await sync.last_runs(db, limit)]}


# =============================================================== reports ====
@router.get("/overview")
async def overview(
    start: Optional[str] = Query(None, description="YYYY-MM-DD, inclusive"),
    end: Optional[str] = Query(None, description="YYYY-MM-DD, inclusive; default = latest day with data"),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await reports.overview(db, start, end)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


async def _loc(db: AsyncSession, location_id: str) -> GbpLocation:
    loc = await db.get(GbpLocation, location_id)
    if not loc:
        raise HTTPException(status_code=404, detail="Listing not found")
    return loc


@router.get("/locations/{location_id}/report")
async def location_report(
    location_id: str,
    start: Optional[str] = None,
    end: Optional[str] = None,
    keywordMonth: Optional[str] = Query(None, description="YYYY-MM"),
    db: AsyncSession = Depends(get_db),
):
    loc = await _loc(db, location_id)
    try:
        return await reports.location_report(db, loc, start, end, keywordMonth)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# ================================================================= notes ====
class NoteInput(BaseModel):
    model_config = {"extra": "forbid"}
    body: str = Field(min_length=1, max_length=4000)


async def _note_dto(db: AsyncSession, n: GbpNote, user: AuthenticatedUser) -> dict:
    author = await db.get(User, n.author_id) if n.author_id else None
    return {
        "id": n.id,
        "body": n.body,
        "author": {"id": author.id, "name": _name(author)} if author else None,
        "createdAt": n.created_at.isoformat(),
        "updatedAt": n.updated_at.isoformat(),
        "edited": n.edited,
        "canEdit": n.author_id == user.id or user.can("gbp.manage"),
    }


@router.get("/locations/{location_id}/notes")
async def list_notes(location_id: str, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    await _loc(db, location_id)
    rows = (
        await db.execute(select(GbpNote).where(GbpNote.location_id == location_id).order_by(GbpNote.created_at.desc()))
    ).scalars().all()
    return {"data": [await _note_dto(db, n, user) for n in rows]}


@router.post("/locations/{location_id}/notes", status_code=201)
async def add_note(location_id: str, dto: NoteInput, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    await _loc(db, location_id)
    n = GbpNote(location_id=location_id, author_id=user.id, body=dto.body.strip(), created_at=utcnow(), updated_at=utcnow())
    db.add(n)
    await db.commit()
    return await _note_dto(db, n, user)


async def _editable_note(db: AsyncSession, note_id: str, user: AuthenticatedUser) -> GbpNote:
    n = await db.get(GbpNote, note_id)
    if not n:
        raise HTTPException(status_code=404, detail="Note not found")
    if n.author_id != user.id and not user.can("gbp.manage"):
        raise HTTPException(status_code=403, detail="Only the author or a manager can change this note")
    return n


@router.patch("/notes/{note_id}")
async def edit_note(note_id: str, dto: NoteInput, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    n = await _editable_note(db, note_id, user)
    if n.body != dto.body.strip():
        n.body, n.edited = dto.body.strip(), True
        await db.commit()
    return await _note_dto(db, n, user)


@router.delete("/notes/{note_id}", status_code=204)
async def delete_note(note_id: str, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    n = await _editable_note(db, note_id, user)
    await db.delete(n)
    await db.commit()


# ======================================================== merchant link ====
def _digits(v: Optional[str]) -> str:
    return re.sub(r"\D", "", v or "")[-10:]


def _norm(v: Optional[str]) -> str:
    return re.sub(r"[^a-z0-9 ]", " ", (v or "").lower())


def _tokens(v: Optional[str]) -> set[str]:
    stop = {"the", "and", "restaurant", "grill", "kitchen", "cafe", "food", "halal", "authentic", "llc", "inc", "co"}
    return {t for t in _norm(v).split() if len(t) > 2 and t not in stop}


@router.get("/locations/{location_id}/merchant-suggestions")
async def merchant_suggestions(location_id: str, db: AsyncSession = Depends(get_db)):
    """Merchants that look like this listing: name words, phone, city, website."""
    loc = await _loc(db, location_id)
    words = _tokens(loc.title)
    phone = _digits(loc.phone)
    host = re.sub(r"^www\.", "", (re.sub(r"^https?://", "", (loc.website_url or "").lower()).split("/")[0]))
    filters = [func.lower(Merchant.restaurant_name).like(f"%{w}%") for w in list(words)[:6]]
    if host:
        filters.append(func.lower(Merchant.website_url).like(f"%{host}%"))
    stmt = select(Merchant).options(selectinload(Merchant.locations), selectinload(Merchant.contacts))
    cands = list((await db.execute(stmt.where(or_(*filters)).limit(60))).scalars().all()) if filters else []
    if phone:
        extra = (
            await db.execute(
                stmt.join(Contact, Contact.merchant_id == Merchant.id)
                .where(func.right(func.regexp_replace(Contact.phone, r"\D", "", "g"), 10) == phone)
                .limit(10)
            )
        ).scalars().unique().all()
        seen = {m.id for m in cands}
        cands += [m for m in extra if m.id not in seen]

    out = []
    for m in cands:
        score, reasons = 0, []
        mw = _tokens(m.restaurant_name)
        if words and mw:
            overlap = len(words & mw) / max(1, len(words | mw))
            if overlap >= 0.99:
                score, reasons = score + 60, reasons + ["Same name"]
            elif overlap >= 0.3:
                score, reasons = score + int(50 * overlap), reasons + ["Similar name"]
        if phone and any(_digits(c.phone) == phone for c in m.contacts or []):
            score, reasons = score + 40, reasons + ["Same phone"]
        if host and m.website_url and host in m.website_url.lower():
            score, reasons = score + 30, reasons + ["Same website"]
        if loc.city and any((l.city or "").strip().lower() == loc.city.strip().lower() for l in m.locations or []):
            score, reasons = score + 15, reasons + ["Same city"]
        if score >= 25:
            city = next((l.city for l in m.locations or [] if l.is_primary), None) or next((l.city for l in m.locations or []), None)
            out.append({"merchantId": m.id, "name": m.restaurant_name, "city": city, "score": score, "reasons": reasons})
    out.sort(key=lambda s: -s["score"])
    return {"data": out[:5]}


class LinkInput(BaseModel):
    model_config = {"extra": "forbid"}
    merchantId: str


async def _read_loc(id: str, db: AsyncSession) -> Optional[dict]:
    loc = await db.get(GbpLocation, id)
    return {"id": loc.id, "title": loc.title, "merchantId": loc.merchant_id} if loc else None


@router.put("/locations/{location_id}/merchant", dependencies=[Depends(require_capability("gbp.manage"))])
@audited(entity_type="GbpLocation", id_param="location_id", read=_read_loc, resolve_merchant_id=lambda e: e.get("merchantId") if e else None)
async def link_merchant(
    location_id: str, dto: LinkInput, request: Request, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)
):
    loc = await _loc(db, location_id)
    m = await db.get(Merchant, dto.merchantId)
    if not m:
        raise HTTPException(status_code=404, detail="Merchant not found")
    loc.merchant_id = m.id
    await db.commit()
    return {"id": loc.id, "title": loc.title, "merchantId": m.id, "merchant": {"id": m.id, "name": m.restaurant_name}}


@router.delete("/locations/{location_id}/merchant", dependencies=[Depends(require_capability("gbp.manage"))])
@audited(entity_type="GbpLocation", id_param="location_id", read=_read_loc, resolve_merchant_id=lambda e: e.get("merchantId") if e else None)
async def unlink_merchant(
    location_id: str, request: Request, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)
):
    loc = await _loc(db, location_id)
    loc.merchant_id = None
    await db.commit()
    return {"id": loc.id, "title": loc.title, "merchantId": None, "merchant": None}


@merchant_router.get("/merchants/{merchant_id}/gbp")
async def merchant_listings(merchant_id: str, db: AsyncSession = Depends(get_db)):
    """Listings linked to this merchant, with the last 30 days of actions."""
    locs = list((await db.execute(select(GbpLocation).where(GbpLocation.merchant_id == merchant_id).order_by(GbpLocation.title))).scalars())
    r, through = await reports.resolve_range(db, None, None)
    aggs = await reports.aggregate(db, r, [l.id for l in locs]) if locs else {}
    return {
        "range": r.dto(),
        "data": [
            {
                **reports.loc_ref(l),
                "openStatus": l.open_status,
                "verification": l.verification,
                "syncState": reports.sync_state(l, through),
                "rating": l.rating_average,
                "totalReviews": l.review_count,
                "total": aggs.get(l.id, reports.Agg()).total,
                "views": aggs.get(l.id, reports.Agg()).views,
            }
            for l in locs
        ],
    }


# ============================================================== callback ====
@callback_router.get("/callback", include_in_schema=False)
async def oauth_callback(
    db: AsyncSession = Depends(get_db),
    code: Optional[str] = None,
    state: Optional[str] = None,
    error: Optional[str] = None,
):
    """Google sends the browser here after the consent screen. No login: the
    signed state proves the flow was started by a GBP manager in the last
    10 minutes. Always ends with a redirect back to the GBP page."""
    ret = connection.state_return(state or "")
    if error:
        return RedirectResponse(connection.return_url(ret, gbp="error", reason="Google sign-in was cancelled." if error == "access_denied" else f"Google said: {error}"))
    user_id = connection.read_state(state or "")
    if not user_id or not code:
        return RedirectResponse(connection.return_url(ret, gbp="error", reason="The sign-in link expired. Click Connect again."))
    u = await db.get(User, user_id)
    from app.common.capabilities import has_capability

    if not u or not has_capability(u.role.value, "gbp.manage", u.granted_capabilities or ()):
        return RedirectResponse(connection.return_url(ret, gbp="error", reason="Only managers can connect Google Business Profile."))
    try:
        async with _http() as http:
            await connection.finish(db, http, code, user_id)
        # Inline (serverless) the first sync is left to the scheduler or "Sync now":
        # it can take longer than this redirect may wait.
        if not jobs.inline():
            run = await sync.create_run(db, "connect", user_id)
            await sync.start_background(run.id)
    except connection.NotConfigured as exc:
        return RedirectResponse(connection.return_url(ret, gbp="error", reason=str(exc)))
    except google.GoogleError as exc:
        logger.warning("GBP connect failed: %s", exc)
        return RedirectResponse(connection.return_url(ret, gbp="error", reason=exc.friendly))
    except sync.SyncBusy:
        pass
    return RedirectResponse(connection.return_url(ret, gbp="connected"))
