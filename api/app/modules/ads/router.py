"""Google Ads reporting — Modules → Ads. Replaces the n8n workflow + Google Sheet.

    GET    /ads/status                         connection, last sync, counts (everyone)
    POST   /ads/connect?returnTo=ads|settings  Google consent URL (ads.manage)
    DELETE /ads/connection                     disconnect + revoke (ads.manage)
    POST   /ads/sync                           "Refresh data" in the background (ads.manage)
    GET    /ads/sync-runs                      recent runs
    POST   /ads/sample-data · DELETE           sample accounts for trying the pages (ads.manage)
    GET    /ads/portfolio?start&end            one row per restaurant account + tab counts
    GET    /ads/monthly-report?month=YYYY-MM   the sheet's MonthlyReport (account × campaign)
    GET    /ads/unmapped                       accounts not linked to a merchant, with suggestions
    GET    /ads/accounts?state=                every account (incl. ignored) for management
    POST   /ads/accounts                       add an account by customer id (ads.manage)
    POST   /ads/accounts/import                import the old sheet's account list (.xlsx, ads.manage)
    GET    /ads/accounts/{id}?start&end        restaurant page: header, KPIs, budget, campaigns
    PATCH  /ads/accounts/{id}                  name, state, avg-ticket inputs (ads.manage)
    GET    /ads/accounts/{id}/assets           Assets / Content / Sitelinks / Preview
    GET    /ads/accounts/{id}/offers           client offers (Profiling) vs Google promotions
    GET    /ads/accounts/{id}/breakdown?month  the sheet's weekly tab (Week 01–04 × campaign)
    GET    /ads/accounts/{id}/merchant-suggestions
    PUT    /ads/accounts/{id}/merchant         link a merchant (ads.manage)
    DELETE /ads/accounts/{id}/merchant         unlink (ads.manage)
    GET    /ads/accounts/{id}/comments · POST  Analysis / Future Actions
    PATCH  /ads/comments/{id} · DELETE         (author, or ads.manage)
    GET    /merchants/{merchantId}/ads         accounts linked to a merchant

    GET    /integrations/google-ads/callback   Google → us after consent (no login; signed state)

Read-only towards Google: nothing here changes a Google Ads account.
"""
from __future__ import annotations

import logging
from typing import Literal, Optional

import httpx
from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.common.audit import audited
from app.common import jobs
from app.common.deps import AuthenticatedUser, get_current_user, require_capability
from app.common.storage.upload_helpers import read_upload_within_limit
from app.config import get_settings
from app.db.session import get_db
from app.models.ads import AdsAccount, AdsComment, AdsSyncRun, utcnow
from app.models.auth import User
from app.models.profiling import Merchant
from app.modules.ads import calc, connection, google, importer, reports, sync

logger = logging.getLogger("Ads")

router = APIRouter(prefix="/ads", tags=["Google Ads"], dependencies=[Depends(require_capability("ads.view"))])
merchant_router = APIRouter(tags=["Google Ads"], dependencies=[Depends(require_capability("ads.view"))])
callback_router = APIRouter(prefix="/integrations/google-ads", tags=["Integrations"])
_manage = Depends(require_capability("ads.manage"))


def _http() -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=httpx.Timeout(60.0))


def _name(u: Optional[User]) -> Optional[str]:
    if not u:
        return None
    return f"{u.first_name or ''} {u.last_name or ''}".strip() or u.email


def _bad(exc: ValueError) -> HTTPException:
    return HTTPException(status_code=400, detail=str(exc))


def _run_dto(run: Optional[AdsSyncRun]) -> Optional[dict]:
    if not run:
        return None
    return {
        "id": run.id,
        "trigger": run.trigger,
        "mode": "quick" if sync.is_quick(run) else "full",
        "status": run.status,
        "startedAt": run.started_at.isoformat(),
        "finishedAt": run.finished_at.isoformat() if run.finished_at else None,
        "accounts": run.accounts,
        "accountsFailed": run.accounts_failed,
        "metricRows": run.metric_rows,
        "newAccounts": run.new_accounts,
        "error": run.error,
    }


# ================================================================ status ====
@router.get("/status")
async def status(db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    from app.modules.ads import scheduler

    s = get_settings()
    conn = await connection.current(db)
    runs = await sync.last_runs(db, 1)
    counts = await sync.counts(db)
    by = await db.get(User, conn.connected_by_id) if conn and conn.connected_by_id else None
    through = await reports.data_through(db)
    return {
        "missingEnv": connection.missing_env(),
        "redirectUri": s.ADS_OAUTH_REDIRECT_URI,
        "managerCustomerId": calc.format_customer_id(connection.login_customer_id()) or None,
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
        "running": bool(await sync.running(db)),
        "accounts": {"google": counts.get("GOOGLE", 0), "sheet": counts.get("SHEET", 0) + counts.get("MANUAL", 0), "demo": counts.get("DEMO", 0)},
        "dataThrough": through.isoformat() if through else None,
        "canManage": user.can("ads.manage"),
        "autoSync": {
            "enabled": s.ADS_AUTO_SYNC,
            "hour": s.ADS_AUTO_SYNC_HOUR,
            "timezone": s.ADS_TIMEZONE,
            "nextAt": scheduler.next_slot(utcnow(), s.ADS_AUTO_SYNC_HOUR, s.ADS_TIMEZONE).isoformat() if s.ADS_AUTO_SYNC else None,
        },
        "settings": {"budgetTolerancePct": s.ADS_BUDGET_TOLERANCE_PCT, "staleHours": s.ADS_STALE_HOURS, "historyDays": s.ADS_HISTORY_DAYS},
    }


@router.post("/connect", dependencies=[_manage])
async def connect(returnTo: str = Query("ads", pattern="^(ads|settings)$"), user: AuthenticatedUser = Depends(get_current_user)):
    try:
        return {"url": connection.connect_url(user.id, returnTo)}
    except connection.NotConfigured as exc:
        raise HTTPException(status_code=409, detail=str(exc))


@router.delete("/connection", status_code=204, dependencies=[_manage])
async def disconnect(db: AsyncSession = Depends(get_db)):
    async with _http() as http:
        await connection.disconnect(db, http)


@router.post("/sync", dependencies=[_manage])
async def start_sync(
    mode: Literal["quick", "full"] = Query(
        "full", description="quick: accounts, campaigns and daily metrics only (seconds); full: also assets, sitelinks, promotions, campaign dates and verification"
    ),
    db: AsyncSession = Depends(get_db),
    user: AuthenticatedUser = Depends(get_current_user),
):
    if not await connection.current(db):
        raise HTTPException(status_code=409, detail="Connect Google Ads first.")
    missing = connection.missing_env()
    if missing:
        raise HTTPException(status_code=409, detail="Add " + ", ".join(missing) + " to the API's settings (environment variables) and redeploy it.")
    try:
        run = await sync.create_run(db, "quick" if mode == "quick" else "manual", user.id)
    except sync.SyncBusy as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    await sync.start_background(run.id)
    if jobs.inline():  # the sync already ran inside this request
        await db.refresh(run)
    return _run_dto(run)


@router.get("/sync-runs")
async def sync_runs(limit: int = Query(10, ge=1, le=50), db: AsyncSession = Depends(get_db)):
    return {"data": [_run_dto(r) for r in await sync.last_runs(db, limit)]}


@router.post("/sample-data", dependencies=[_manage])
async def load_sample_data(db: AsyncSession = Depends(get_db)):
    import datetime as dt

    from app.modules.ads import demo

    try:
        return await demo.load(db, dt.date.today())
    except demo.DemoRefused as exc:
        raise HTTPException(status_code=409, detail=str(exc))


@router.delete("/sample-data", dependencies=[_manage])
async def remove_sample_data(db: AsyncSession = Depends(get_db)):
    from app.modules.ads import demo

    return {"removed": await demo.remove(db)}


# =============================================================== reports ====
_COMPARE = Query(None, description="previous: also return the previous period (same length; whole months → the months before); none / empty: no comparison")


@router.get("/portfolio")
async def portfolio(start: Optional[str] = None, end: Optional[str] = None, compare: Optional[str] = _COMPARE, db: AsyncSession = Depends(get_db)):
    try:
        return await reports.portfolio(db, start, end, compare)
    except ValueError as exc:
        raise _bad(exc)


@router.get("/monthly-report")
async def monthly_report(month: Optional[str] = Query(None, description="YYYY-MM; default the previous month"), db: AsyncSession = Depends(get_db)):
    try:
        return await reports.monthly_report(db, month)
    except ValueError as exc:
        raise _bad(exc)


@router.get("/unmapped")
async def unmapped(db: AsyncSession = Depends(get_db)):
    return await reports.unmapped(db)


async def _acc(db: AsyncSession, account_id: str) -> AdsAccount:
    acc = await db.get(AdsAccount, account_id)
    if not acc:
        raise HTTPException(status_code=404, detail="Google Ads account not found")
    return acc


async def _read_acc(id: str, db: AsyncSession) -> Optional[dict]:
    a = await db.get(AdsAccount, id)
    if not a:
        return None
    return {
        "id": a.id,
        "customerId": a.customer_id,
        "name": a.name,
        "state": a.state,
        "merchantId": a.merchant_id,
        "ticketTotalSales": float(a.ticket_total_sales) if a.ticket_total_sales is not None else None,
        "ticketOrderCount": a.ticket_order_count,
    }


@router.get("/accounts")
async def list_accounts(state: Optional[str] = Query(None, pattern="^(active|archived|ignored)$"), db: AsyncSession = Depends(get_db)):
    stmt = select(AdsAccount).order_by(AdsAccount.name)
    if state:
        stmt = stmt.where(AdsAccount.state == state)
    rows = list((await db.execute(stmt)).scalars())
    mids = sorted({a.merchant_id for a in rows if a.merchant_id})
    names = dict((await db.execute(select(Merchant.id, Merchant.restaurant_name).where(Merchant.id.in_(mids)))).all()) if mids else {}
    return {
        "data": [
            {
                "id": a.id,
                "customerId": calc.format_customer_id(a.customer_id),
                "name": a.name,
                "source": a.source,
                "state": a.state,
                "merchant": {"id": a.merchant_id, "name": names.get(a.merchant_id)} if a.merchant_id else None,
                "lastSyncedAt": a.last_synced_at.isoformat() if a.last_synced_at else None,
                "syncError": a.sync_error,
            }
            for a in rows
        ]
    }


class AccountCreate(BaseModel):
    model_config = {"extra": "forbid"}
    customerId: str = Field(min_length=10, max_length=14, description="123-456-7890 or digits")
    name: str = Field(min_length=1, max_length=300)


@router.post("/accounts", status_code=201, dependencies=[_manage])
@audited(entity_type="AdsAccount", read=_read_acc, resolve_merchant_id=lambda e: e.get("merchantId") if e else None)
async def add_account(dto: AccountCreate, request: Request, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    cid = calc.clean_customer_id(dto.customerId)
    if len(cid) != 10:
        raise HTTPException(status_code=400, detail="A Google Ads customer ID has 10 digits (123-456-7890).")
    if (await db.execute(select(AdsAccount).where(AdsAccount.customer_id == cid))).scalar_one_or_none():
        raise HTTPException(status_code=409, detail="That account is already in the list.")
    a = AdsAccount(customer_id=cid, name=dto.name.strip(), source="MANUAL", state="active", manager_customer_id=connection.login_customer_id(), first_seen_at=utcnow())
    db.add(a)
    await db.commit()
    return await _read_acc(a.id, db)


@router.post("/accounts/import", dependencies=[_manage])
async def import_accounts(file: UploadFile = File(...), db: AsyncSession = Depends(get_db)):
    data = await read_upload_within_limit(file)
    try:
        return await importer.import_accounts(db, data)
    except importer.ImportError_ as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/accounts/{account_id}")
async def account_detail(
    account_id: str, start: Optional[str] = None, end: Optional[str] = None, compare: Optional[str] = _COMPARE, db: AsyncSession = Depends(get_db)
):
    acc = await _acc(db, account_id)
    try:
        return await reports.account_detail(db, acc, start, end, compare)
    except ValueError as exc:
        raise _bad(exc)


@router.get("/accounts/{account_id}/trend")
async def account_trend(
    account_id: str,
    start: Optional[str] = None,
    end: Optional[str] = None,
    campaign: Optional[str] = Query(None, description="One campaign's id (default: all the account's campaigns)"),
    compare: Optional[str] = _COMPARE,
    db: AsyncSession = Depends(get_db),
):
    """Daily points for the trend chart; days after the last synced day are null."""
    acc = await _acc(db, account_id)
    try:
        return await reports.trend(db, acc, start, end, campaign, compare)
    except ValueError as exc:
        raise _bad(exc)


class AccountPatch(BaseModel):
    model_config = {"extra": "forbid"}
    name: Optional[str] = Field(None, min_length=1, max_length=300)
    state: Optional[Literal["active", "archived", "ignored"]] = None
    ticketTotalSales: Optional[float] = Field(None, ge=0)
    ticketOrderCount: Optional[int] = Field(None, ge=0)


@router.patch("/accounts/{account_id}", dependencies=[_manage])
@audited(entity_type="AdsAccount", id_param="account_id", read=_read_acc, resolve_merchant_id=lambda e: e.get("merchantId") if e else None)
async def update_account(account_id: str, dto: AccountPatch, request: Request, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    acc = await _acc(db, account_id)
    fields = dto.model_fields_set
    if "name" in fields and dto.name:
        acc.name = dto.name.strip()
    if "state" in fields and dto.state:
        acc.state = dto.state
    if fields & {"ticketTotalSales", "ticketOrderCount"}:
        if "ticketTotalSales" in fields:
            acc.ticket_total_sales = dto.ticketTotalSales
        if "ticketOrderCount" in fields:
            acc.ticket_order_count = dto.ticketOrderCount
        acc.ticket_updated_at = utcnow()
    await db.commit()
    return await _read_acc(acc.id, db)


@router.get("/accounts/{account_id}/assets")
async def account_assets(account_id: str, db: AsyncSession = Depends(get_db)):
    return await reports.assets(db, await _acc(db, account_id))


@router.get("/accounts/{account_id}/offers")
async def account_offers(account_id: str, db: AsyncSession = Depends(get_db)):
    return await reports.offers(db, await _acc(db, account_id))


@router.get("/accounts/{account_id}/breakdown")
async def account_breakdown(account_id: str, month: Optional[str] = Query(None, description="YYYY-MM"), db: AsyncSession = Depends(get_db)):
    acc = await _acc(db, account_id)
    try:
        return await reports.breakdown(db, acc, month)
    except ValueError as exc:
        raise _bad(exc)


# ======================================================== merchant link ====
@router.get("/accounts/{account_id}/merchant-suggestions")
async def merchant_suggestions(account_id: str, db: AsyncSession = Depends(get_db)):
    acc = await _acc(db, account_id)
    return {"data": await reports.merchant_suggestions(db, acc.name)}


class LinkInput(BaseModel):
    model_config = {"extra": "forbid"}
    merchantId: str


@router.put("/accounts/{account_id}/merchant", dependencies=[_manage])
@audited(entity_type="AdsAccount", id_param="account_id", read=_read_acc, resolve_merchant_id=lambda e: e.get("merchantId") if e else None)
async def link_merchant(account_id: str, dto: LinkInput, request: Request, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    acc = await _acc(db, account_id)
    if acc.source == "DEMO":
        raise HTTPException(status_code=409, detail="Sample accounts can't be linked to real merchants.")
    m = await db.get(Merchant, dto.merchantId)
    if not m:
        raise HTTPException(status_code=404, detail="Merchant not found")
    acc.merchant_id = m.id
    await db.commit()
    return {"id": acc.id, "merchantId": m.id, "merchant": {"id": m.id, "name": m.restaurant_name}}


@router.delete("/accounts/{account_id}/merchant", dependencies=[_manage])
@audited(entity_type="AdsAccount", id_param="account_id", read=_read_acc, resolve_merchant_id=lambda e: e.get("merchantId") if e else None)
async def unlink_merchant(account_id: str, request: Request, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    acc = await _acc(db, account_id)
    acc.merchant_id = None
    await db.commit()
    return {"id": acc.id, "merchantId": None, "merchant": None}


@merchant_router.get("/merchants/{merchant_id}/ads")
async def merchant_accounts(merchant_id: str, db: AsyncSession = Depends(get_db)):
    return await reports.merchant_accounts(db, merchant_id)


# ============================================================== comments ====
class CommentInput(BaseModel):
    model_config = {"extra": "forbid"}
    body: str = Field(min_length=1, max_length=4000)


async def _comment_dto(db: AsyncSession, c: AdsComment, user: AuthenticatedUser) -> dict:
    author = await db.get(User, c.author_id) if c.author_id else None
    return {
        "id": c.id,
        "body": c.body,
        "author": {"id": author.id, "name": _name(author)} if author else None,
        "createdAt": c.created_at.isoformat(),
        "updatedAt": c.updated_at.isoformat(),
        "edited": c.edited,
        "canEdit": (c.author_id is not None and c.author_id == user.id) or user.can("ads.manage"),
    }


@router.get("/accounts/{account_id}/comments")
async def list_comments(account_id: str, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    await _acc(db, account_id)
    rows = (await db.execute(select(AdsComment).where(AdsComment.account_id == account_id).order_by(AdsComment.created_at.desc()))).scalars().all()
    return {"data": [await _comment_dto(db, c, user) for c in rows]}


@router.post("/accounts/{account_id}/comments", status_code=201)
async def add_comment(account_id: str, dto: CommentInput, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    await _acc(db, account_id)
    c = AdsComment(account_id=account_id, author_id=user.id, body=dto.body.strip(), created_at=utcnow(), updated_at=utcnow())
    db.add(c)
    await db.commit()
    return await _comment_dto(db, c, user)


async def _editable(db: AsyncSession, comment_id: str, user: AuthenticatedUser) -> AdsComment:
    c = await db.get(AdsComment, comment_id)
    if not c:
        raise HTTPException(status_code=404, detail="Comment not found")
    if c.author_id != user.id and not user.can("ads.manage"):
        raise HTTPException(status_code=403, detail="Only the author or a manager can change this comment")
    return c


@router.patch("/comments/{comment_id}")
async def edit_comment(comment_id: str, dto: CommentInput, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    c = await _editable(db, comment_id, user)
    if c.body != dto.body.strip():
        c.body, c.edited = dto.body.strip(), True
        await db.commit()
    return await _comment_dto(db, c, user)


@router.delete("/comments/{comment_id}", status_code=204)
async def delete_comment(comment_id: str, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    c = await _editable(db, comment_id, user)
    await db.delete(c)
    await db.commit()


# ============================================================== callback ====
@callback_router.get("/callback", include_in_schema=False)
async def oauth_callback(db: AsyncSession = Depends(get_db), code: Optional[str] = None, state: Optional[str] = None, error: Optional[str] = None):
    """Google sends the browser here after the consent screen. No login: the
    signed state proves a manager started it in the last 10 minutes."""
    ret = connection.state_return(state or "")
    if error:
        return RedirectResponse(connection.return_url(ret, ads="error", reason="Google sign-in was cancelled." if error == "access_denied" else f"Google said: {error}"))
    user_id = connection.read_state(state or "")
    if not user_id or not code:
        return RedirectResponse(connection.return_url(ret, ads="error", reason="The sign-in link expired. Click Connect Google Ads again."))
    u = await db.get(User, user_id)
    from app.common.capabilities import has_capability

    if not u or not has_capability(u.role.value, "ads.manage", u.granted_capabilities or ()):
        return RedirectResponse(connection.return_url(ret, ads="error", reason="Only managers can connect Google Ads."))
    try:
        async with _http() as http:
            await connection.finish(db, http, code, user_id)
        if not connection.missing_env():
            # Inline (serverless) the first sync is left to the scheduler or "Sync now":
            # it can take longer than this redirect may wait.
            if not jobs.inline():
                run = await sync.create_run(db, "connect", user_id)
                await sync.start_background(run.id)
    except connection.NotConfigured as exc:
        return RedirectResponse(connection.return_url(ret, ads="error", reason=str(exc)))
    except google.GoogleAdsError as exc:
        logger.warning("Google Ads connect failed: %s", exc)
        return RedirectResponse(connection.return_url(ret, ads="error", reason=exc.friendly))
    except sync.SyncBusy:
        pass
    return RedirectResponse(connection.return_url(ret, ads="connected"))
