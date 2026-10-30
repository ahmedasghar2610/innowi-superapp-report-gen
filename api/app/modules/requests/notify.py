"""Tell people about requests: the bell, e-mail (Resend) and an optional Teams post.

Who hears what (the person who caused it never does):
    new request ................ REQUEST_NEW      → triage owners (+ the Teams channel, if set)
    status / decision changed .. REQUEST_UPDATED  → requester, voters, commenters
    new comment ................ REQUEST_UPDATED  → requester, voters, commenters, triage owners
    requester answers "needs info" → back to triage owners

Each person's choice for "Requests" in Settings → Notifications decides the bell
and e-mail; the Teams channel post (REQUESTS_TEAMS_WEBHOOK_URL) is for the team,
not one person, so it ignores personal choices.

Never raises: a failed e-mail or Teams post must not fail the request itself.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Iterable, Optional
from xml.sax.saxutils import escape

from sqlalchemy import or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models import requests as m
from app.models.auth import User
from app.models.common import cuid
from app.models.enums import NotificationKind, Role, UserStatus
from app.models.ops import Notification, utcnow
from app.modules.ops.alerts import _channels
from app.modules.ops import teams_flow
from app.modules.ops.teams_flow import microsoft_email
from app.modules.quotes.notify import _post_json

logger = logging.getLogger("requests.notify")

PREF = "requests"


def ref(r: m.Request) -> str:
    return f"R-{r.number}"


def link(r: m.Request) -> str:
    return f"/requests/{ref(r)}"


def app_url(path: str) -> str:
    return get_settings().APP_WEB_URL.rstrip("/") + path


async def triager_ids(db: AsyncSession) -> list[str]:
    """Super Admins plus everyone granted requests.triage (active only)."""
    rows = await db.execute(
        select(User.id).where(
            User.status == UserStatus.ACTIVE,
            or_(User.role == Role.SUPER_ADMIN, User.granted_capabilities.any("requests.triage")),
        )
    )
    return list(rows.scalars())


async def follower_ids(db: AsyncSession, r: m.Request) -> list[str]:
    """The requester, everyone who upvoted it and everyone who commented on it."""
    ids: set[str] = {r.requester_id} if r.requester_id else set()
    ids |= set((await db.execute(select(m.RequestVote.user_id).where(m.RequestVote.request_id == r.id))).scalars())
    ids |= {a for a in (await db.execute(
        select(m.RequestComment.author_id).where(m.RequestComment.request_id == r.id))).scalars() if a}
    return list(ids)


def _html(title: str, lines: list[tuple[str, str]], text: str, url: str) -> str:
    rows = "".join(f"<tr><td style='padding:4px 12px 4px 0;color:#6b7280'>{escape(k)}</td><td>{escape(v)}</td></tr>"
                   for k, v in lines if v)
    body = "".join(f"<p style='margin:8px 0'>{escape(p)}</p>" for p in text.split("\n") if p.strip())
    return (f"<div style='font-family:Arial,sans-serif;font-size:14px;color:#111827'>"
            f"<h2 style='font-size:18px;margin:0 0 8px'>{escape(title)}</h2>{body}<table>{rows}</table>"
            f"<p style='margin-top:16px'><a href='{escape(url)}' style='color:#2563eb'>Open in the Super App</a></p>"
            f"<p style='color:#6b7280;font-size:12px'>You get this because of your Requests choice in "
            f"Settings → Notifications.</p></div>")


async def _email(to: str, subject: str, html: str) -> Optional[bool]:
    s = get_settings()
    if not s.RESEND_API_KEY:
        return None
    payload = {"from": s.REQUESTS_EMAIL_FROM, "to": [to], "subject": subject, "html": html}
    try:
        code = await asyncio.to_thread(_post_json, "https://api.resend.com/emails", payload,
                                       {"Authorization": f"Bearer {s.RESEND_API_KEY}"})
        return 200 <= code < 300
    except Exception as e:  # noqa: BLE001
        logger.warning("Request e-mail to %s failed: %s", to, e)
        return False


async def _teams(title: str, text: str, facts: list[tuple[str, str]], url: str) -> Optional[bool]:
    hook = get_settings().REQUESTS_TEAMS_WEBHOOK_URL
    if not hook:
        return None
    card = {
        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json", "type": "AdaptiveCard", "version": "1.4",
        "body": [
            {"type": "TextBlock", "text": title, "weight": "Bolder", "size": "Medium", "wrap": True},
            {"type": "TextBlock", "text": text, "wrap": True, "spacing": "Small"},
            {"type": "FactSet", "facts": [{"title": k, "value": v} for k, v in facts if v]},
        ],
        "actions": [{"type": "Action.OpenUrl", "title": "Open in Super App", "url": url}],
    }
    payload = {"type": "message",
               "attachments": [{"contentType": "application/vnd.microsoft.card.adaptive", "content": card}]}
    try:
        code = await asyncio.to_thread(_post_json, hook, payload)
        return 200 <= code < 300
    except Exception as e:  # noqa: BLE001
        logger.warning("Teams post for requests failed: %s", e)
        return False


async def send(
    db: AsyncSession,
    r: m.Request,
    user_ids: Iterable[Optional[str]],
    kind: NotificationKind,
    title: str,
    body: Optional[str],
    *,
    actor_id: Optional[str],
    facts: Optional[list[tuple[str, str]]] = None,
    email_text: Optional[str] = None,
    teams: bool = False,
) -> int:
    """Store bell notices (commits), then e-mail / post to Teams. Returns how many people were told."""
    ids = {u for u in user_ids if u and u != actor_id}
    users = (await db.execute(select(User).where(User.id.in_(ids or {""}), User.status == UserStatus.ACTIVE))
             ).scalars().all() if ids else []
    mails: list[str] = []
    dms: list[str] = []
    for u in users:
        ch = _channels(u, PREF)
        if ch["inApp"]:
            await db.execute(insert(Notification).values(
                id=cuid(), user_id=u.id, kind=kind, ticket_id=None, actor_id=actor_id, title=title[:300],
                body=(body or "")[:500] or None, link=link(r), created_at=utcnow(),
            ))
        if ch["email"]:
            mails.append(u.email)
        if ch["teams"]:
            dms.append(microsoft_email(u))
    await db.commit()

    url = app_url(link(r))
    html = _html(title, facts or [], email_text or body or "", url)
    jobs = [_email(e, title, html) for e in mails]
    jobs += [teams_flow.dm(to, title, body, link(r)) for to in dms]  # Teams card via the Ops CRM flow
    if teams:
        jobs.append(_teams(title, email_text or body or "", facts or [], url))
    if jobs:
        await asyncio.gather(*jobs)
    return len(users)
