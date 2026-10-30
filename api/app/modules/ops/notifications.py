"""Ops CRM notices outside the app: Teams and e-mail.

`alerts.notify()` stores the bell notice and *queues* the outside deliveries
on the database session (`queue()`); the caller commits and then calls
`flush(db)`, so nobody is messaged about something that was rolled back and
the HTTP calls don't hold a database transaction open.

    teams    → a Teams card to the person (teams_flow.dm), via the Power
               Automate flow, to their Microsoft address (Settings → Profile)
    email    → an e-mail through Resend (RESEND_API_KEY), to the same address
    channel  → a card in the Ops alerts channel (teams_flow.channel)

Each channel is skipped quietly when it isn't configured; nothing here raises.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Optional
from xml.sax.saxutils import escape

from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.auth import User
from app.modules.ops import teams_flow

logger = logging.getLogger("OpsNotifications")

_OUTBOX = "ops_outbox"
FLUSH_TIMEOUT_S = 25.0


async def notify_assigned(
    *,
    ticket_key: str,
    ticket_title: str,
    assignee_email: Optional[str],
    actor_email: Optional[str],
    reassigned: bool,
) -> None:
    """Kept for callers; the assignee is now told through alerts.notify (bell,
    Teams and e-mail, following their Settings → Notifications choices)."""
    return None


def email_configured() -> bool:
    return bool(get_settings().RESEND_API_KEY)


def queue(
    db: AsyncSession,
    *,
    user: User,
    channels: list[str],
    title: str,
    body: Optional[str],
    link: Optional[str],
) -> None:
    """Remember a Teams / e-mail delivery for `flush()` after the commit."""
    if not channels:
        return
    to = teams_flow.microsoft_email(user)
    db.info.setdefault(_OUTBOX, []).append(("person", to, list(channels), title, body, link or "/ops/tickets"))


def queue_channel(db: AsyncSession, *, title: str, body: Optional[str], link: Optional[str]) -> None:
    """Remember a post for the Ops alerts channel."""
    db.info.setdefault(_OUTBOX, []).append(("channel", None, ["channel"], title, body, link or "/ops/tickets"))


def discard(db: AsyncSession) -> None:
    db.info.pop(_OUTBOX, None)


async def flush(db: AsyncSession) -> int:
    """Send everything queued on this session. Returns how many messages went out."""
    items = db.info.pop(_OUTBOX, None) or []
    if not items:
        return 0
    jobs = []
    for kind, to, channels, title, body, link in items:
        if kind == "channel":
            jobs.append(teams_flow.channel(title, body, link))
            continue
        if "teams" in channels:
            jobs.append(teams_flow.dm(to, title, body, link))
        if "email" in channels:
            jobs.append(send_email(to, title, body, link))
    try:
        results = await asyncio.wait_for(asyncio.gather(*jobs, return_exceptions=True), FLUSH_TIMEOUT_S)
    except asyncio.TimeoutError:
        logger.warning("Ops notifications: gave up after %ss (%s message(s))", FLUSH_TIMEOUT_S, len(jobs))
        return 0
    return sum(1 for r in results if r is True)


def _email_html(title: str, body: Optional[str], url: str) -> str:
    text = "".join(f"<p style='margin:8px 0'>{escape(p)}</p>" for p in (body or "").split("\n") if p.strip())
    return (
        "<div style='font-family:Arial,sans-serif;font-size:14px;color:#111827'>"
        f"<h2 style='font-size:18px;margin:0 0 8px'>{escape(title)}</h2>{text}"
        f"<p style='margin-top:16px'><a href='{escape(url)}' style='color:#2563eb'>Open in the Super App</a></p>"
        "<p style='color:#6b7280;font-size:12px'>You get this because of your choices in "
        "Settings → Notifications.</p></div>"
    )


async def send_email(to: str, title: str, body: Optional[str], link: Optional[str]) -> Optional[bool]:
    s = get_settings()
    if not s.RESEND_API_KEY:
        return None
    from app.modules.quotes.notify import _post_json

    url = teams_flow.app_url(link or "/ops/tickets")
    payload = {
        "from": s.OPS_EMAIL_FROM or s.REQUESTS_EMAIL_FROM,
        "to": [to],
        "subject": title[:250],
        "html": _email_html(title, body, url),
    }
    try:
        code = await asyncio.to_thread(
            _post_json, "https://api.resend.com/emails", payload, {"Authorization": f"Bearer {s.RESEND_API_KEY}"}
        )
        return 200 <= code < 300
    except Exception as e:  # noqa: BLE001
        logger.warning("Ops e-mail to %s failed: %s", to, e)
        return False


def deliver_external(*, email: str, channels: list[str], title: str, body: Optional[str], link: Optional[str]) -> None:
    """Old entry point (logs only). Use queue() + flush() instead."""
    if channels:
        logger.info("Notify %s via %s (use notifications.queue): %s", email, "+".join(channels), title)
