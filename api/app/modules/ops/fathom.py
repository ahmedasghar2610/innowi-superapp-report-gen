"""Fathom meeting notes → Ops CRM meetings.

Two ways in, same result (`ingest_meeting`):

- **Sync** (pull): `sync_meetings()` calls GET /meetings on the Fathom
  external API with `FATHOM_API_KEY` (header `X-Api-Key`), asking for the
  summary, transcript and action items, newest first, since the last sync.
  Used by Ops CRM → Meetings → "Sync from Fathom" and scripts/fathom_sync.py.
- **Webhook** (push): Fathom POSTs the same meeting object to
  /api/v1/integrations/fathom/webhook a few minutes after a call. The request
  is verified with `FATHOM_WEBHOOK_SECRET` (whsec_…) using Fathom's
  HMAC-SHA256 scheme (`verify_webhook`). Needs the API to be reachable from
  the internet.

API reference: https://developers.fathom.ai (List meetings, Webhooks).

A meeting is keyed by Fathom's `recording_id`, so a re-delivery updates it.
Attendees and action-item assignees are matched to Super App users by email;
the merchant is matched from external attendees' emails (a merchant
contact's email, or the same domain as a contact's email or the merchant's
website). Action items that were already turned into tickets or dismissed
are never touched by a re-delivery.
"""
from __future__ import annotations

import base64
import datetime as dt
import hashlib
import hmac
import logging
import time
from typing import Any, Optional
from urllib.parse import urlparse

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.auth import User
from app.models.enums import ActionItemStatus, MeetingSource
from app.models.ops import AppSetting, Meeting, MeetingActionItem, utcnow
from app.models.profiling import Contact, Merchant

logger = logging.getLogger("Fathom")

STATE_KEY = "fathom_state"
# Email domains that say nothing about which merchant someone belongs to.
FREEMAIL = {
    "gmail.com", "googlemail.com", "yahoo.com", "hotmail.com", "outlook.com", "live.com",
    "icloud.com", "me.com", "aol.com", "msn.com", "proton.me", "protonmail.com",
}
MAX_TRANSCRIPT_LINES = 5000
MAX_SYNC_PAGES = 20


class FathomNotConfigured(RuntimeError):
    pass


class FathomError(RuntimeError):
    pass


# ------------------------------------------------------------ webhook ----
def verify_webhook(secret: str, headers: dict[str, str], raw_body: bytes, tolerance: int = 300, now: Optional[int] = None) -> bool:
    """Fathom webhook signature check (Standard Webhooks scheme):
    HMAC-SHA256 over "{webhook-id}.{webhook-timestamp}.{raw body}" with the
    base64-decoded part of the secret after "whsec_"; the header may carry
    several space-separated "v1,<sig>" values."""
    h = {k.lower(): v for k, v in headers.items()}
    msg_id, ts, sig_header = h.get("webhook-id"), h.get("webhook-timestamp"), h.get("webhook-signature")
    if not (msg_id and ts and sig_header and secret):
        return False
    try:
        ts_int = int(ts)
    except ValueError:
        return False
    if abs((now if now is not None else int(time.time())) - ts_int) > tolerance:
        return False
    try:
        key = base64.b64decode(secret.split("_", 1)[1] if secret.startswith("whsec_") else secret)
    except Exception:
        return False
    signed = f"{msg_id}.{ts}.".encode() + raw_body
    expected = base64.b64encode(hmac.new(key, signed, hashlib.sha256).digest()).decode()
    for part in sig_header.split(" "):
        candidate = part.split(",", 1)[1] if "," in part else part
        if hmac.compare_digest(expected, candidate):
            return True
    return False


def sign_webhook(secret: str, msg_id: str, ts: int, raw_body: bytes) -> str:
    """The header value Fathom would send — used by tests and the demo script."""
    key = base64.b64decode(secret.split("_", 1)[1] if secret.startswith("whsec_") else secret)
    sig = base64.b64encode(hmac.new(key, f"{msg_id}.{ts}.".encode() + raw_body, hashlib.sha256).digest()).decode()
    return f"v1,{sig}"


# ------------------------------------------------------------ helpers ----
def _ts(v: Any) -> Optional[dt.datetime]:
    if not v:
        return None
    try:
        return dt.datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    except ValueError:
        return None


def _email(v: Any) -> Optional[str]:
    return str(v).strip().lower() if v and "@" in str(v) else None


def _domain(email: Optional[str]) -> Optional[str]:
    return email.rsplit("@", 1)[1] if email else None


def _host(url: Optional[str]) -> Optional[str]:
    if not url:
        return None
    host = urlparse(url if "//" in url else f"//{url}").hostname or ""
    return host.lower().removeprefix("www.") or None


async def _users_by_email(db: AsyncSession, emails: set[str]) -> dict[str, User]:
    if not emails:
        return {}
    rows = (await db.execute(select(User).where(func.lower(User.email).in_(emails)))).scalars().all()
    return {u.email.lower(): u for u in rows}


async def match_merchant(db: AsyncSession, external_emails: list[str]) -> Optional[Merchant]:
    """A merchant contact with that exact email wins; then a contact or the
    merchant's website on the same (non-freemail) domain."""
    emails = [e for e in external_emails if e]
    if not emails:
        return None
    row = (
        await db.execute(
            select(Merchant).join(Contact, Contact.merchant_id == Merchant.id).where(func.lower(Contact.email).in_(emails)).limit(1)
        )
    ).scalars().first()
    if row:
        return row
    domains = {d for d in (_domain(e) for e in emails) if d and d not in FREEMAIL}
    if not domains:
        return None
    for d in domains:
        row = (
            await db.execute(
                select(Merchant).join(Contact, Contact.merchant_id == Merchant.id).where(func.lower(Contact.email).like(f"%@{d}")).limit(1)
            )
        ).scalars().first()
        if row:
            return row
    sites = (await db.execute(select(Merchant).where(Merchant.website_url.is_not(None)))).scalars().all()
    for m in sites:
        if _host(m.website_url) in domains:
            return m
    return None


# ------------------------------------------------------------- ingest ----
async def ingest_meeting(db: AsyncSession, payload: dict, source: MeetingSource = MeetingSource.FATHOM) -> tuple[Meeting, bool]:
    """Create or update one meeting from a Fathom meeting object. Returns
    (meeting, created). The caller commits."""
    rec_id = payload.get("recording_id")
    try:
        rec_id = int(rec_id) if rec_id is not None else None
    except (TypeError, ValueError):
        rec_id = None
    meeting = None
    if rec_id is not None:
        meeting = (await db.execute(select(Meeting).where(Meeting.fathom_recording_id == rec_id))).scalar_one_or_none()
    created = meeting is None
    if created:
        meeting = Meeting(fathom_recording_id=rec_id, source=source, title="Meeting")
        db.add(meeting)

    invitees = payload.get("calendar_invitees") or []
    transcript = payload.get("transcript") or []
    speaker_emails = {_email((t.get("speaker") or {}).get("matched_calendar_invitee_email")) for t in transcript}
    speaker_names = {((t.get("speaker") or {}).get("display_name") or "").strip().lower() for t in transcript}
    recorded_by = payload.get("recorded_by") or {}
    actions = payload.get("action_items") or []

    emails = {_email(i.get("email")) for i in invitees} | {_email((a.get("assignee") or {}).get("email")) for a in actions}
    emails |= {_email(recorded_by.get("email"))}
    users = await _users_by_email(db, {e for e in emails if e})

    attendees = []
    for i in invitees:
        e = _email(i.get("email"))
        name = (i.get("name") or "").strip() or (e or "Guest")
        attendees.append(
            {
                "name": name,
                "email": e,
                "isExternal": bool(i.get("is_external")),
                "userId": users[e].id if e in users else None,
                "spoke": (e in speaker_emails) or (name.lower() in speaker_names)
                or ((i.get("matched_speaker_display_name") or "").strip().lower() in speaker_names - {""}),
            }
        )

    meeting.title = (payload.get("meeting_title") or payload.get("title") or "Meeting")[:300]
    meeting.started_at = _ts(payload.get("recording_start_time")) or _ts(payload.get("scheduled_start_time")) or _ts(payload.get("created_at"))
    meeting.ended_at = _ts(payload.get("recording_end_time")) or _ts(payload.get("scheduled_end_time"))
    meeting.scheduled_start_at = _ts(payload.get("scheduled_start_time"))
    meeting.scheduled_end_at = _ts(payload.get("scheduled_end_time"))
    meeting.fathom_url = payload.get("url")
    meeting.share_url = payload.get("share_url")
    meeting.call_url = payload.get("meeting_url")
    meeting.recorded_by_name = recorded_by.get("name")
    meeting.recorded_by_email = _email(recorded_by.get("email"))
    meeting.attendees = attendees
    summary = (payload.get("default_summary") or {}).get("markdown_formatted")
    if summary:
        meeting.summary = summary
    if transcript:
        meeting.transcript = [
            {
                "speaker": (t.get("speaker") or {}).get("display_name") or "Speaker",
                "email": _email((t.get("speaker") or {}).get("matched_calendar_invitee_email")),
                "text": t.get("text") or "",
                "timestamp": t.get("timestamp"),
            }
            for t in transcript[:MAX_TRANSCRIPT_LINES]
        ]
    meeting.language = payload.get("transcript_language")
    if meeting.merchant_match != "manual":
        m = await match_merchant(db, [a["email"] for a in attendees if a["isExternal"] and a["email"]])
        meeting.merchant_id = m.id if m else None
        meeting.merchant_match = "auto" if m else None
    await db.flush()

    # Action items: keep decided ones, refresh open ones.
    existing = (
        await db.execute(select(MeetingActionItem).where(MeetingActionItem.meeting_id == meeting.id))
    ).scalars().all()
    decided = {a.description.strip().lower(): a for a in existing if a.status != ActionItemStatus.OPEN}
    for a in existing:
        if a.status == ActionItemStatus.OPEN:
            await db.delete(a)
    for pos, a in enumerate(actions):
        desc = (a.get("description") or "").strip()
        if not desc or desc.lower() in decided:
            continue
        who = a.get("assignee") or {}
        e = _email(who.get("email"))
        db.add(
            MeetingActionItem(
                meeting_id=meeting.id,
                position=pos,
                description=desc,
                assignee_name=who.get("name"),
                assignee_email=e,
                assignee_user_id=users[e].id if e in users else None,
                recording_timestamp=a.get("recording_timestamp"),
                playback_url=a.get("recording_playback_url"),
                status=ActionItemStatus.OPEN,
            )
        )
    await db.flush()
    return meeting, created


# -------------------------------------------------------------- state ----
async def get_state(db: AsyncSession) -> dict:
    row = await db.get(AppSetting, STATE_KEY)
    return dict(row.value) if row else {}


async def update_state(db: AsyncSession, **changes) -> None:
    row = await db.get(AppSetting, STATE_KEY)
    if row is None:
        row = AppSetting(key=STATE_KEY, value={})
        db.add(row)
    value = dict(row.value or {})
    value.update({k: (v.isoformat() if isinstance(v, dt.datetime) else v) for k, v in changes.items()})
    row.value = value
    row.updated_at = utcnow()


# --------------------------------------------------------------- sync ----
async def fetch_meetings(api_key: str, created_after: Optional[dt.datetime], base: str) -> list[dict]:
    import httpx

    params: list[tuple[str, str]] = [
        ("include_summary", "true"),
        ("include_action_items", "true"),
        ("include_transcript", "true"),
    ]
    if created_after:
        params.append(("created_after", created_after.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")))
    items: list[dict] = []
    cursor = None
    async with httpx.AsyncClient(timeout=30) as client:
        for _ in range(MAX_SYNC_PAGES):
            q = params + ([("cursor", cursor)] if cursor else [])
            r = await client.get(f"{base.rstrip('/')}/meetings", params=q, headers={"X-Api-Key": api_key})
            if r.status_code in (401, 403):
                raise FathomError("Fathom rejected the API key — check FATHOM_API_KEY.")
            if r.status_code == 429:
                raise FathomError("Fathom is rate-limiting requests — try again in a minute.")
            if r.status_code >= 400:
                raise FathomError(f"Fathom returned {r.status_code}.")
            body = r.json()
            items.extend(body.get("items") or [])
            cursor = body.get("next_cursor")
            if not cursor:
                break
    return items


async def sync_meetings(db: AsyncSession, days_back: int = 30) -> dict:
    s = get_settings()
    if not s.FATHOM_API_KEY:
        raise FathomNotConfigured("FATHOM_API_KEY isn't set in the API's settings (environment variables).")
    state = await get_state(db)
    last = _ts(state.get("lastSyncAt"))
    since = (last - dt.timedelta(hours=6)) if last else utcnow() - dt.timedelta(days=days_back)
    try:
        items = await fetch_meetings(s.FATHOM_API_KEY, since, s.FATHOM_API_BASE)
    except FathomError as exc:
        await update_state(db, lastError=str(exc), lastErrorAt=utcnow())
        await db.commit()
        raise
    except Exception as exc:  # network
        logger.warning("Fathom sync failed: %s", exc)
        await update_state(db, lastError="Couldn't reach Fathom.", lastErrorAt=utcnow())
        await db.commit()
        raise FathomError("Couldn't reach Fathom. Check the network and try again.") from exc
    added = updated = 0
    for item in items:
        _, created = await ingest_meeting(db, item)
        added += created
        updated += not created
    await update_state(db, lastSyncAt=utcnow(), lastError=None, lastSyncAdded=added, lastSyncUpdated=updated)
    await db.commit()
    return {"fetched": len(items), "added": added, "updated": updated}
