"""Settings (Super App → Settings).

Personal (any signed-in staff member, about themselves):
    GET/PATCH /settings/me            name, start page, notification choices
    GET       /settings/me/sessions   where you're signed in
    DELETE    /settings/me/sessions/{id}

Workspace (everyone can read; `settings.manage` — Admin, Super Admin — edits):
    GET/PUT    /settings/workspace    company name, timezone, work week, …
    GET/PUT    /settings/sla          SLA targets per priority
    DELETE     /settings/sla          back to the built-in targets
    GET        /settings/integrations Microsoft 365, Fathom, GBP, vault key, email

Team members and their access are managed with the existing /users API.
"""
from __future__ import annotations

import datetime as dt
import os
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.common.audit import _write_log
from app.common.deps import AuthenticatedUser, get_current_user, require_capability
from app.config import get_settings
from app.db.session import get_db
from app.models.auth import RefreshToken, User
from app.models.enums import AuditAction, AuditOutcome, TicketPriority
from app.models.ops import AppSetting, utcnow
from app.modules.auth.service import to_user_response
from app.modules.ops import sla as sla_clock
from app.modules.settings.schemas import (
    TIMEZONES,
    IntegrationDto,
    IntegrationsDto,
    MySettingsDto,
    Preferences,
    SessionDto,
    SlaSettingsDto,
    SlaTargetDto,
    SlaTargetsInput,
    UpdateMySettingsDto,
    Workspace,
    WorkspaceDto,
)

router = APIRouter(prefix="/settings", tags=["Settings"], dependencies=[Depends(get_current_user)])
_manage = Depends(require_capability("settings.manage"))

TICKET_PREFIX = "OPS"


async def _audit(db: AsyncSession, request: Request, user: AuthenticatedUser, entity: str, before, after) -> None:
    await _write_log(
        db,
        actor_id=user.id,
        actor_email=user.email,
        actor_role=user.role,
        action=AuditAction.UPDATE,
        entity_type=entity,
        entity_id=None,
        merchant_id=None,
        before=before,
        after=after,
        changed_fields=sorted(k for k in set(before or {}) | set(after or {}) if (before or {}).get(k) != (after or {}).get(k)),
        method=request.method,
        path=str(request.url.path),
        outcome=AuditOutcome.SUCCESS,
        status_code=200,
        error_message=None,
        ip=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )


async def _me(db: AsyncSession, user: AuthenticatedUser) -> User:
    row = await db.get(User, user.id)
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    return row


def _my_dto(u: User) -> MySettingsDto:
    return MySettingsDto(
        user=to_user_response(u),
        preferences=Preferences.from_stored(u.preferences),
        passwordChangedAt=u.password_changed_at,
    )


async def _setting(db: AsyncSession, key: str) -> Optional[AppSetting]:
    return await db.get(AppSetting, key)


async def _who(db: AsyncSession, user_id: Optional[str]) -> Optional[str]:
    if not user_id:
        return None
    u = await db.get(User, user_id)
    if not u:
        return None
    return f"{u.first_name or ''} {u.last_name or ''}".strip() or u.email


async def _save(db: AsyncSession, key: str, value: dict, user_id: str) -> AppSetting:
    row = await _setting(db, key)
    if row is None:
        row = AppSetting(key=key, value=value, updated_by_id=user_id)
        db.add(row)
    else:
        row.value = value
        row.updated_by_id = user_id
        row.updated_at = dt.datetime.now(dt.timezone.utc)
    await db.commit()
    await db.refresh(row)
    await sla_clock.refresh_from_db(db, force=True)
    return row


# ============================================================ personal ====
@router.get("/me", response_model=MySettingsDto)
async def get_my_settings(db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    return _my_dto(await _me(db, user))


@router.patch("/me", response_model=MySettingsDto)
async def update_my_settings(
    dto: UpdateMySettingsDto, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)
):
    u = await _me(db, user)
    if dto.firstName is not None:
        u.first_name = dto.firstName or None
    if dto.lastName is not None:
        u.last_name = dto.lastName or None
    if dto.preferences is not None:
        prefs = Preferences.from_stored(u.preferences)
        if dto.preferences.startPage is not None:
            prefs.startPage = dto.preferences.startPage
        if dto.preferences.notifications is not None:
            prefs.notifications.update(dto.preferences.notifications)
        u.preferences = prefs.model_dump(mode="json")
    await db.commit()
    await db.refresh(u)
    return _my_dto(u)


def _device(ua: Optional[str]) -> str:
    if not ua:
        return "Unknown device"
    s = ua.lower()
    browser = next(
        (n for k, n in (("edg/", "Edge"), ("chrome/", "Chrome"), ("firefox/", "Firefox"), ("safari/", "Safari")) if k in s),
        "Browser",
    )
    system = next(
        (n for k, n in (("windows", "Windows"), ("iphone", "iPhone"), ("android", "Android"), ("mac os", "macOS"), ("linux", "Linux")) if k in s),
        "",
    )
    if "python" in s or "curl" in s or "httpx" in s:
        return "Script / API client"
    return f"{browser} on {system}" if system else browser


@router.get("/me/sessions", response_model=list[SessionDto])
async def my_sessions(db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    now = dt.datetime.now(dt.timezone.utc)
    rows = (
        await db.execute(
            select(RefreshToken)
            .where(RefreshToken.user_id == user.id, RefreshToken.revoked_at.is_(None), RefreshToken.expires_at > now)
            .order_by(RefreshToken.created_at.desc())
        )
    ).scalars().all()
    return [
        SessionDto(id=r.id, ip=r.ip, userAgent=r.user_agent, device=_device(r.user_agent), createdAt=r.created_at, expiresAt=r.expires_at)
        for r in rows
    ]


@router.delete("/me/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def end_session(session_id: str, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    row = await db.get(RefreshToken, session_id)
    if not row or row.user_id != user.id:
        raise HTTPException(status_code=404, detail="Session not found")
    if row.revoked_at is None:
        row.revoked_at = dt.datetime.now(dt.timezone.utc)
        await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# =========================================================== workspace ====
def _workspace_from(row: Optional[AppSetting]) -> Workspace:
    base = Workspace(timezone=sla_clock.DEFAULT_TIMEZONE_NAME).model_dump()
    if row and isinstance(row.value, dict):
        base.update({k: v for k, v in row.value.items() if k in base})
    try:
        return Workspace(**base)
    except Exception:  # a hand-edited row that no longer validates
        return Workspace(timezone=sla_clock.DEFAULT_TIMEZONE_NAME)


@router.get("/workspace", response_model=WorkspaceDto)
async def get_workspace(db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    row = await _setting(db, "workspace")
    ws = _workspace_from(row)
    zones = list(TIMEZONES) if ws.timezone in TIMEZONES else [ws.timezone, *TIMEZONES]
    return WorkspaceDto(
        workspace=ws,
        ticketPrefix=TICKET_PREFIX,
        timezones=zones,
        canEdit=user.can("settings.manage"),
        updatedAt=row.updated_at if row else None,
        updatedBy=await _who(db, row.updated_by_id) if row else None,
    )


@router.put("/workspace", response_model=WorkspaceDto, dependencies=[_manage])
async def put_workspace(
    dto: Workspace, request: Request, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)
):
    before = _workspace_from(await _setting(db, "workspace")).model_dump(mode="json")
    after = dto.model_dump(mode="json")
    await _save(db, "workspace", after, user.id)
    await _audit(db, request, user, "WorkspaceSettings", before, after)
    return await get_workspace(db, user)


# ================================================================= SLA ====
def _sla_dto(row: Optional[AppSetting], ws: Optional[AppSetting], user: AuthenticatedUser, who: Optional[str]) -> SlaSettingsDto:
    workspace = _workspace_from(ws)
    return SlaSettingsDto(
        targets=[
            SlaTargetDto(
                priority=p,
                responseHours=sla_clock.SLA_TARGET_HOURS[p][0],
                resolutionHours=sla_clock.SLA_TARGET_HOURS[p][1],
                defaultResponseHours=sla_clock.DEFAULT_TARGET_HOURS[p][0],
                defaultResolutionHours=sla_clock.DEFAULT_TARGET_HOURS[p][1],
            )
            for p in TicketPriority
        ],
        atRiskShare=sla_clock.AT_RISK_SHARE,
        timezone=workspace.timezone,
        workDays=workspace.workDays,
        isDefault=row is None,
        canEdit=user.can("settings.manage"),
        updatedAt=row.updated_at if row else None,
        updatedBy=who,
    )


@router.get("/sla", response_model=SlaSettingsDto)
async def get_sla(db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    await sla_clock.refresh_from_db(db, force=True)
    row = await _setting(db, "sla_targets")
    return _sla_dto(row, await _setting(db, "workspace"), user, await _who(db, row.updated_by_id) if row else None)


@router.put("/sla", response_model=SlaSettingsDto, dependencies=[_manage])
async def put_sla(
    dto: SlaTargetsInput, request: Request, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)
):
    before = sla_clock.policy_payload()
    value = {t.priority.value: {"responseHours": t.responseHours, "resolutionHours": t.resolutionHours} for t in dto.targets}
    await _save(db, "sla_targets", value, user.id)
    await _audit(db, request, user, "SlaSettings", {"targets": before}, {"targets": sla_clock.policy_payload()})
    return await get_sla(db, user)


@router.delete("/sla", response_model=SlaSettingsDto, dependencies=[_manage])
async def reset_sla(request: Request, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    row = await _setting(db, "sla_targets")
    if row is not None:
        before = sla_clock.policy_payload()
        await db.delete(row)
        await db.commit()
        await sla_clock.refresh_from_db(db, force=True)
        await _audit(db, request, user, "SlaSettings", {"targets": before}, {"targets": sla_clock.policy_payload()})
    return await get_sla(db, user)


# ======================================================== integrations ====
def _env(*names: str) -> bool:
    s = get_settings()
    return all(getattr(s, n, None) or os.getenv(n) for n in names)


def _vault_status() -> tuple[str, str]:
    key = get_settings().CREDENTIAL_ENCRYPTION_KEY
    if not key:
        return "not_connected", "No key set — the credentials vault can't store or reveal logins."
    try:
        from app.common.security.crypto import decrypt_secret, encrypt_secret

        if decrypt_secret(encrypt_secret("probe")) == "probe":
            return "connected", "Key set and working. Logins are encrypted at rest."
    except Exception:
        pass
    return "attention", "A key is set but it isn't a valid Fernet key. Fix it in the API's settings and redeploy."


async def _fathom_card(db: AsyncSession) -> IntegrationDto:
    from app.modules.ops import fathom

    state = await fathom.get_state(db)
    key, secret = _env("FATHOM_API_KEY"), _env("FATHOM_WEBHOOK_SECRET")
    if state.get("lastError") and key:
        status_, text = "attention", f"Last sync failed: {state['lastError']}"
    elif key and (state.get("lastSyncAt") or state.get("lastWebhookAt")):
        last = state.get("lastWebhookAt") or state.get("lastSyncAt")
        status_, text = "connected", f"Working. Last meeting data received {last[:16].replace('T', ' ')} UTC."
    elif key or secret:
        status_, text = "configured", "Key added. Use Ops CRM → Meetings → Sync from Fathom to pull your meetings."
    else:
        status_, text = "not_connected", (
            "Add a Fathom API key to pull meeting notes. Keys are personal: create it in the Fathom account that "
            "records the team's calls (or one they're shared with), under Settings → API Access."
        )
    return IntegrationDto(
        key="fathom",
        name="Fathom",
        description="Meeting summaries, transcripts and action items.",
        status=status_,  # type: ignore[arg-type]
        statusText=text + ("" if secret else " Webhook (instant delivery) not set up."),
        usedFor=["Ops CRM → Meetings", "Action items → tickets"],
        envKeys=["FATHOM_API_KEY", "FATHOM_WEBHOOK_SECRET"],
        nextStep=None if key else (
            "Fathom → Settings → API Access → Generate API key; add it as FATHOM_API_KEY and restart the API. "
            "Optional: add a webhook to …/api/v1/integrations/fathom/webhook and put its secret in FATHOM_WEBHOOK_SECRET."
        ),
    )


async def _gbp_card(db: AsyncSession) -> IntegrationDto:
    from app.modules.gbp import connection as gbp_connection, sync as gbp_sync

    missing = gbp_connection.missing_env()
    conn = await gbp_connection.current(db)
    runs = await gbp_sync.last_runs(db, 1)
    last = runs[0] if runs else None
    if conn and conn.status == "error":
        status_, text = "attention", conn.last_error or "Google access stopped working. Reconnect on the GBP page."
    elif conn and last and last.status == "failed":
        status_, text = "attention", f"Last sync failed: {last.error}"
    elif conn and conn.last_sync_at:
        status_, text = "connected", f"Connected as {conn.google_email or 'the Google account'}. Last sync {conn.last_sync_at.strftime('%Y-%m-%d %H:%M')} UTC."
    elif conn:
        status_, text = "configured", f"Connected as {conn.google_email or 'the Google account'}; the first sync hasn't finished yet."
    elif not missing:
        status_, text = "configured", "Keys added. Click Connect on Web & Search → GBP and sign in with the account that manages the listings."
    else:
        status_, text = "not_connected", "Waiting for Google to approve Business Profile API access and for the OAuth client keys."
    return IntegrationDto(
        key="gbp",
        name="Google Business Profile",
        description="Performance, reviews and posts for every listing the connected Google account manages.",
        status=status_,  # type: ignore[arg-type]
        statusText=text,
        usedFor=["Web & Search → GBP reports", "Merchant → linked GBP listings"],
        envKeys=["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET", "GBP_OAUTH_REDIRECT_URI", "CREDENTIAL_ENCRYPTION_KEY"],
        nextStep=None if conn else ("Add " + ", ".join(missing) + " to the API's settings (environment variables) and redeploy it." if missing else "Connect on the GBP page."),
    )

async def _seo_card(db: AsyncSession) -> IntegrationDto:
    from app.modules.seo import connection as seo_connection, sync as seo_sync

    missing = seo_connection.missing_env()
    conn = await seo_connection.current(db)
    runs = await seo_sync.last_runs(db, 1)
    last = runs[0] if runs else None
    s = get_settings()
    extras = [k for k, ok in (("PageSpeed", s.PAGESPEED_API_KEY),) if not ok]
    if conn and conn.status == "error":
        status_, text = "attention", conn.last_error or "Google access stopped working. Reconnect in SEO → Connections."
    elif conn and last and last.status == "failed":
        status_, text = "attention", f"Last sync failed: {last.error}"
    elif conn and conn.last_sync_at:
        status_, text = "connected", f"Connected as {conn.google_email or 'the Google account'}. Last sync {conn.last_sync_at.strftime('%Y-%m-%d %H:%M')} UTC."
    elif conn:
        status_, text = "configured", f"Connected as {conn.google_email or 'the Google account'}; the first sync hasn't finished yet."
    elif not missing:
        status_, text = "configured", "Keys added. Click Connect in SEO → Connections and sign in with the account that has the Search Console and GA4 access."
    else:
        status_, text = "not_connected", "Turn on the Search Console and Google Analytics APIs in the Google Cloud project, then add the OAuth client keys."
    if extras:
        text += f" Not set up yet: {', '.join(extras)}."
    return IntegrationDto(
        key="seo",
        name="Search Console & Google Analytics 4 (SEO)",
        description="Clicks, search terms, indexing, visits and key events for every site (keyword positions come from Search Console); the PageSpeed key adds speed scores and Core Web Vitals.",
        status=status_,  # type: ignore[arg-type]
        statusText=text,
        usedFor=["Marketing → SEO (Command, scorecards, Intelligence, Reports)", "Client SEO reports"],
        envKeys=["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET", "SEO_OAUTH_REDIRECT_URI", "CREDENTIAL_ENCRYPTION_KEY", "PAGESPEED_API_KEY", "SERPER_API_KEY"],
        nextStep=None if conn else ("Add " + ", ".join(missing) + " to the API's settings (environment variables) and redeploy it." if missing else "Connect in SEO → Connections."),
    )


async def _ads_card(db: AsyncSession) -> IntegrationDto:
    from app.modules.ads import connection as ads_connection, sync as ads_sync

    missing = ads_connection.missing_env()
    conn = await ads_connection.current(db)
    runs = await ads_sync.last_runs(db, 1)
    last = runs[0] if runs else None
    if conn and conn.status == "error":
        status_, text = "attention", conn.last_error or "Google access stopped working. Reconnect on the Ads page."
    elif conn and last and last.status == "failed":
        status_, text = "attention", f"Last sync failed: {last.error}"
    elif conn and conn.last_sync_at:
        status_, text = "connected", f"Connected as {conn.google_email or 'the Google account'}. Last sync {conn.last_sync_at.strftime('%Y-%m-%d %H:%M')} UTC."
    elif conn:
        status_, text = "configured", f"Connected as {conn.google_email or 'the Google account'}; the first sync hasn't finished yet."
    elif not missing:
        status_, text = "configured", "Keys added. Click Connect Google Ads on the Ads page and sign in with a user of the manager account."
    else:
        status_, text = "not_connected", "Replaces the n8n Google Ads workflow. Needs the developer token and manager account ID in the API's settings (environment variables)."
    return IntegrationDto(
        key="google_ads",
        name="Google Ads",
        description="Spend, orders, ROI/ROAS, budgets, assets and verification for every client account under the manager account.",
        status=status_,  # type: ignore[arg-type]
        statusText=text,
        usedFor=["Modules → Ads (portfolio, restaurant pages, monthly report)", "Merchant → linked Google Ads accounts"],
        envKeys=["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET", "GOOGLE_ADS_DEVELOPER_TOKEN", "GOOGLE_ADS_LOGIN_CUSTOMER_ID", "ADS_OAUTH_REDIRECT_URI", "CREDENTIAL_ENCRYPTION_KEY"],
        nextStep=None if conn else ("Add " + ", ".join(missing) + " to the API's settings (environment variables) and redeploy it." if missing else "Connect on the Ads page."),
    )



def _teams_flow_card() -> IntegrationDto:
    from app.modules.ops import teams_flow

    on = teams_flow.configured()
    return IntegrationDto(
        key="teams_flow",
        name="Microsoft Teams (Power Automate)",
        description="Teams cards to a person or the Ops alerts channel, and Teams meeting invites, through the "
        "\"Super App – Notify\" flow. No admin permissions needed.",
        status="connected" if on else "not_connected",
        statusText=(
            "Connected. Use the buttons under Teams alerts to send a test."
            if on
            else "Add the flow's HTTP URL and its secret to the API settings, then redeploy."
        ),
        usedFor=[
            "Assigned to you / mentions / SLA alerts in Teams",
            "Urgent tickets and SLA breaches in the Ops alerts channel",
            "Daily digest in the channel",
            "Teams meeting invites from a ticket",
        ],
        envKeys=["OPS_TEAMS_FLOW_URL", "OPS_TEAMS_FLOW_SECRET"],
        nextStep=None if on else "Build the flow in make.powerautomate.com (see the Teams workflows setup guide).",
    )


async def _outlook_sync_card(db: AsyncSession) -> IntegrationDto:
    """Flow 2 ("Super App – Availability sync"): Outlook leave + busy times. Replaces
    the Entra app registration (declined by IT), so no admin consent is involved."""
    from app.config import get_settings
    from app.modules.ops import availability

    secret = bool(get_settings().OPS_TEAMS_FLOW_SECRET)
    snap = await availability.snapshot(db)
    updated = snap.get("updatedAt")
    when = availability._parse_time(updated) if updated else None
    stale = when is None or utcnow() - when > availability.STALE_AFTER
    if not secret:
        status_, text = "not_connected", "Add OPS_TEAMS_FLOW_SECRET to the API settings, then build the Availability sync flow."
    elif when is None:
        status_, text = "configured", "Waiting for the first run of the \"Super App – Availability sync\" flow."
    elif stale:
        status_, text = "attention", f"No update since {updated[:16].replace('T', ' ')} UTC — check the flow's run history."
    else:
        people = snap.get("people") or {}
        cal = sum(1 for p in people.values() if p.get("hasCalendar"))
        status_, text = "connected", (
            f"Last update {updated[:16].replace('T', ' ')} UTC · {len(people)} people · calendars readable for {cal}."
        )
    return IntegrationDto(
        key="outlook_sync",
        name="Outlook leave & calendar (Power Automate)",
        description="The \"Super App – Availability sync\" flow reads Outlook automatic replies and busy times every "
        "15 minutes under one Innowi account. Replaces the Entra app — no admin permissions needed.",
        status=status_,  # type: ignore[arg-type]
        statusText=text,
        usedFor=["Ops Hub (on leave / in a meeting)", "Calendar → meetings and leave", "\"On leave\" hint when assigning a ticket"],
        envKeys=["OPS_TEAMS_FLOW_SECRET"],
        nextStep=None if status_ == "connected" else "Build or fix Flow 2 in make.powerautomate.com (see the Complete Guide, section 6).",
    )


def _ops_email_card() -> IntegrationDto:
    from app.modules.ops import notifications

    on = notifications.email_configured()
    return IntegrationDto(
        key="email",
        name="Ticket e-mails",
        description="E-mails people who ticked e-mail in Settings → Notifications (sent through Resend).",
        status="connected" if on else "not_connected",
        statusText="Sending through Resend." if on else "Add RESEND_API_KEY to the API settings to send e-mails.",
        usedFor=["Assigned to you", "Mentions", "SLA warnings"],
        envKeys=["RESEND_API_KEY", "OPS_EMAIL_FROM"],
    )


@router.get("/integrations", response_model=IntegrationsDto)
async def integrations(db: AsyncSession = Depends(get_db)):
    vault_status, vault_text = _vault_status()
    return IntegrationsDto(
        data=[
            _teams_flow_card(),
            await _outlook_sync_card(db),
            _ops_email_card(),
            await _fathom_card(db),
            await _gbp_card(db),
            await _ads_card(db),
            await _seo_card(db),
            IntegrationDto(
                key="vault",
                name="Credentials vault encryption",
                description="Encrypts the logins stored in Library → Credentials.",
                status=vault_status,  # type: ignore[arg-type]
                statusText=vault_text,
                usedFor=["Library → Credentials"],
                envKeys=["CREDENTIAL_ENCRYPTION_KEY"],
            ),
        ]
    )
