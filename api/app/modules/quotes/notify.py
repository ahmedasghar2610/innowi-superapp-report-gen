"""Tell the right people when a quote moves: submitted, countered, signed, executed.

Channels, each optional (unset = skipped; the request is in the Super App either way):
  * Teams: a Workflows webhook (QUOTES_TEAMS_WEBHOOK_URL), an adaptive card.
  * E-mail: through Resend (RESEND_API_KEY) - to the rep who sent the link plus
    QUOTES_NOTIFY_EMAILS for team events, and to the restaurant's contact for
    client-facing events (a staff counter-offer, the fully signed copy).
    Resend only sends from a verified domain.

Client e-mails carry no quote URL on purpose: link tokens are stored only as
hashes, so the restaurant opens the quote through the link they already have.

Never raises: a failed notification must not fail the restaurant's request. The
outcome per channel is stored on the request (quote_request.notified) so the
Super App can show what went out.
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import urllib.request
from decimal import Decimal
from typing import Optional
from xml.sax.saxutils import escape

from app.config import get_settings
from app.models import quotes as m

logger = logging.getLogger("quotes.notify")
TIMEOUT = 8.0


def _usd(v) -> str:
    return f"${Decimal(str(v)):,.2f}"


USER_AGENT = "innowi-superapp/1.0 (+https://superapp-web-test.vercel.app)"


def _post_json(url: str, payload: dict, headers: Optional[dict] = None) -> int:
    # A named User-Agent is required: Resend's firewall rejects Python's default
    # ("Python-urllib/3.x") with 403 / error code 1010 before the request reaches its API.
    req = urllib.request.Request(url, data=json.dumps(payload).encode(), method="POST",
                                 headers={"Content-Type": "application/json", "User-Agent": USER_AGENT,
                                          **(headers or {})})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as res:  # noqa: S310 - URLs come from settings
        return res.status


def _summary(r: m.QuoteRequest) -> tuple[str, list[tuple[str, str]]]:
    monthly = Decimal(r.monthly_software_total) + Decimal(r.monthly_lease_total)
    facts = [
        ("Restaurant", r.restaurant_name),
        ("Contact", f"{r.contact_name} · {r.contact_email}" + (f" · {r.contact_phone}" if r.contact_phone else "")),
        ("Quote", r.number),
        ("Prices shown to client", "Yes" if r.mode == m.MODE_SHOW else "No (special pricing)"),
        ("One-time", _usd(r.one_time_total)),
        ("Monthly", _usd(monthly) + (" (incl. lease)" if Decimal(r.monthly_lease_total) else "")),
        ("Items", ", ".join(f"{line['qty']}× {line['name']}" for line in r.lines[:12])),
    ]
    return monthly, facts


async def _teams(title: str, text: str, facts: list[tuple[str, str]], url: str) -> Optional[bool]:
    hook = get_settings().QUOTES_TEAMS_WEBHOOK_URL
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
    payload = {"type": "message", "attachments": [{"contentType": "application/vnd.microsoft.card.adaptive", "content": card}]}
    try:
        code = await asyncio.to_thread(_post_json, hook, payload)
        return 200 <= code < 300
    except Exception as e:  # noqa: BLE001
        logger.warning("Teams notification failed: %s", e)
        return False


async def _email(to: list[str], subject: str, html: str,
                 attachment: Optional[tuple[str, bytes]] = None) -> Optional[bool]:
    s = get_settings()
    if not s.RESEND_API_KEY or not to:
        return None
    payload: dict = {"from": s.QUOTES_EMAIL_FROM, "to": to, "subject": subject, "html": html}
    if attachment:
        name, content = attachment
        payload["attachments"] = [{"filename": name, "content": base64.b64encode(content).decode()}]
    try:
        code = await asyncio.to_thread(
            _post_json, "https://api.resend.com/emails", payload,
            {"Authorization": f"Bearer {s.RESEND_API_KEY}"},
        )
        return 200 <= code < 300
    except Exception as e:  # noqa: BLE001 - Resend answers 403 for an unverified domain
        logger.warning("Quote e-mail failed: %s", e)
        return False


def _recipients(link: m.QuoteLink) -> list[str]:
    extra = [e.strip() for e in get_settings().QUOTES_NOTIFY_EMAILS.split(",") if e.strip()]
    out: list[str] = []
    for e in [link.created_by_email, *extra]:
        if e and e.lower() not in {x.lower() for x in out}:
            out.append(e)
    return out


def _staff_message(event: str, r: m.QuoteRequest) -> tuple[str, str]:
    if event == "submitted" and r.mode == m.MODE_SHOW:
        return f"🧾 {r.restaurant_name} built a quote ({r.number})", "They saw the prices and got a proposal right away."
    if event == "submitted":
        return f"📝 {r.restaurant_name} sent a quote request ({r.number})", "Prices were hidden from them; price it and follow up."
    if event == "revised_client":
        return (f"🔁 {r.restaurant_name} sent changes on {r.number} (rev {r.current_revision_no})",
                "They adjusted the quote. Review the new revision and counter or countersign.")
    if event == "signed":
        signer = r.accepted_name or r.contact_name
        return (f"✍️ {r.restaurant_name} signed {r.number}",
                f"Signed by {signer}" + (f", {r.accepted_title}" if r.accepted_title else "")
                + ". Countersign it in the Super App to execute the agreement.")
    if event == "declined":
        return f"🚫 {r.restaurant_name} declined {r.number}", (r.declined_reason or "No reason given.")
    if event == "executed":
        return (f"✅ {r.number} is fully signed ({r.restaurant_name})",
                "Both parties signed. The signed copy went to the client by e-mail.")
    if event == "accepted":  # legacy accepts, kept for old rows
        return f"✅ {r.restaurant_name} accepted proposal {r.number}", f"Accepted by {r.accepted_name}."
    return f"Quote {r.number} updated", ""


def _html(title: str, text: str, facts: list[tuple[str, str]], link_html: str = "") -> str:
    rows = "".join(f"<tr><td style='padding:4px 12px 4px 0;color:#6b7280'>{escape(k)}</td><td>{escape(v)}</td></tr>"
                   for k, v in facts if v)
    return (f"<div style='font-family:Arial,sans-serif;font-size:14px'><h2 style='font-size:18px'>{escape(title)}</h2>"
            f"<p>{escape(text)}</p><table>{rows}</table>{link_html}</div>")


async def notify(event: str, r: m.QuoteRequest, link: m.QuoteLink,
                 pdf_bytes: Optional[bytes] = None) -> dict:
    """Send the channels an event calls for; returns {'teams': ..., 'email': ..., 'clientEmail': ...}.

    Events: 'submitted' | 'revised_client' | 'signed' | 'declined' (to the team),
    'revised_staff' (to the client), 'executed' (to both, with the signed PDF).
    """
    base = get_settings().APP_WEB_URL.rstrip("/")
    url = f"{base}/quotes/requests/{r.id}"
    _, facts = _summary(r)
    out: dict = {}

    if event == "revised_staff":
        # To the client. No URL: they open the quote through the link they already have.
        title = f"Your Innowi quote {r.number} was updated"
        current = next((rev for rev in r.revisions if rev.rev_no == r.current_revision_no), None)
        note = (current.note if current else None) or "Your Innowi contact sent you an updated version."
        html = _html(title, note, [("Quote", r.number), ("Restaurant", r.restaurant_name)],
                     "<p>Open the quote link you received to review the update, adjust it, or sign.</p>")
        out["clientEmail"] = await _email([r.contact_email], title, html)
        return out

    title, text = _staff_message(event, r)
    link_html = f"<p><a href='{escape(url)}'>Open {escape(r.number)} in the Super App</a></p>"
    teams, email = await asyncio.gather(
        _teams(title, text, facts, url),
        _email(_recipients(link), title, _html(title, text, facts, link_html),
               attachment=(f"Innowi-agreement-{r.number}.pdf", pdf_bytes) if pdf_bytes else None),
    )
    out["teams"], out["email"] = teams, email

    if event == "signed":
        c_title = f"We received your signature on Innowi proposal {r.number}"
        c_html = _html(c_title, "Thank you! Innowi will countersign next, and you'll get the fully signed copy by e-mail.",
                       [("Quote", r.number), ("Restaurant", r.restaurant_name)])
        out["clientEmail"] = await _email([r.contact_email], c_title, c_html)
    elif event == "executed":
        c_title = f"Your signed Innowi agreement {r.number}"
        c_html = _html(c_title, "Both parties have signed. The fully signed copy is attached for your records.",
                       [("Quote", r.number), ("Restaurant", r.restaurant_name)])
        out["clientEmail"] = await _email(
            [r.contact_email], c_title, c_html,
            attachment=(f"Innowi-agreement-{r.number}.pdf", pdf_bytes) if pdf_bytes else None)
    return out
