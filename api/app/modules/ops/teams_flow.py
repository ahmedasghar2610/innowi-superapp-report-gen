"""Microsoft Teams and Outlook through one Power Automate flow.

The Microsoft 365 admin route (an Entra app with Graph permissions) was
declined, so the Super App talks to a flow that runs under a normal Innowi
account instead ("Super App – Notify", built in make.powerautomate.com):

    POST <OPS_TEAMS_FLOW_URL>
    x-superapp-key: <OPS_TEAMS_FLOW_SECRET>
    {"kind": "dm" | "channel" | "event", ...}

    dm       Teams card to one person (Flow bot → "Chat with Flow bot"):
             to, title, text, url
    channel  Teams card in the Ops alerts channel: title, text, url
    event    Teams meeting + Outlook invite from the flow owner's calendar:
             subject, text, start, end (local time in OPS_TEAMS_TIMEZONE,
             "YYYY-MM-DDTHH:MM:SS"), attendees ("a@x.com;b@x.com")

Unset URL or secret = everything here is skipped (returns None). Sending never
raises: a failed Teams post must not fail the request that caused it.

Teams / Outlook use each person's Super App login e-mail (the one they
registered with), so that address must be their real @innowi.com mailbox.
"""
from __future__ import annotations

import asyncio
import datetime as dt
import logging
from typing import Optional
from zoneinfo import ZoneInfo

from app.config import get_settings
from app.models.auth import User

logger = logging.getLogger("OpsTeamsFlow")

KINDS = ("dm", "channel", "event")


def configured() -> bool:
    s = get_settings()
    return bool(s.OPS_TEAMS_FLOW_URL and s.OPS_TEAMS_FLOW_SECRET)


def app_url(path: str) -> str:
    if path.startswith("http"):
        return path
    return get_settings().APP_WEB_URL.rstrip("/") + path


def microsoft_email(user: User) -> str:
    """The address Teams / Outlook know this person by: their login e-mail."""
    return user.email


def flow_timezone() -> ZoneInfo:
    return ZoneInfo(get_settings().OPS_TEAMS_TIMEZONE)


def to_flow_time(t: dt.datetime) -> str:
    """An aware datetime → wall-clock text in the time zone the flow's meeting step uses."""
    if t.tzinfo is None:
        t = t.replace(tzinfo=dt.timezone.utc)
    return t.astimezone(flow_timezone()).replace(tzinfo=None).isoformat(timespec="seconds")


async def post(payload: dict) -> Optional[bool]:
    """Send one request to the flow. None = not configured, True = the flow
    answered 2xx, False = it failed (logged)."""
    if not configured():
        return None
    s = get_settings()
    from app.modules.quotes.notify import _post_json  # same helper the Quotes Teams post uses

    try:
        code = await asyncio.to_thread(
            _post_json, s.OPS_TEAMS_FLOW_URL, payload, {"x-superapp-key": s.OPS_TEAMS_FLOW_SECRET}
        )
        return 200 <= code < 300
    except Exception as e:  # noqa: BLE001 - HTTPError, timeout, DNS: all just "not sent"
        logger.warning("Teams flow (%s) failed: %s", payload.get("kind"), e)
        return False


async def dm(to: str, title: str, text: Optional[str], url: str) -> Optional[bool]:
    return await post({"kind": "dm", "to": to, "title": title[:300], "text": (text or " ")[:2000], "url": app_url(url)})


async def channel(title: str, text: Optional[str], url: str) -> Optional[bool]:
    return await post({"kind": "channel", "title": title[:300], "text": (text or " ")[:4000], "url": app_url(url)})


async def meeting(
    subject: str, text: Optional[str], start: dt.datetime, end: dt.datetime, attendees: list[str]
) -> Optional[bool]:
    return await post(
        {
            "kind": "event",
            "subject": subject[:250],
            "text": (text or " ")[:4000],
            "start": to_flow_time(start),
            "end": to_flow_time(end),
            "attendees": ";".join(dict.fromkeys(a for a in attendees if a)),
        }
    )
