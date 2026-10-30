"""/public/partner-leads/action — the one-click buttons in the partner-lead e-mails. No login.

The e-mails ("Assign to Asif", "Mark as Won") link to the Super App page
/lead-action?t=<token>. That page shows what the button will do and only acts
when the person clicks Confirm, so mail link-scanners that open every link
can't trigger anything. Both steps come here:

  POST { token, commit: false }  -> what the button will do
  POST { token, commit: true }   -> do it

The work itself stays in the Supabase function partner-lead-action (it checks
the token, makes the change through partner_apply_token() and sends the owner
e-mail / Teams card); this route only forwards to it, so the page never needs
the Supabase key and the function's answer is cut down to what the page shows.
The token is a random UUID created per button, so guessing one isn't practical.
"""
from __future__ import annotations

import logging
import uuid
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.config import get_settings

logger = logging.getLogger("PartnerLeads")

router = APIRouter(prefix="/public/partner-leads", tags=["Partner Leads (public)"])


class LeadActionIn(BaseModel):
    token: str
    commit: bool = False

    model_config = {"extra": "forbid"}


class LeadActionLead(BaseModel):
    fullName: Optional[str] = None
    company: Optional[str] = None


class LeadActionOut(BaseModel):
    ok: bool
    # invalid | expired | lead_gone | assignee_missing | already_assigned | not_on_team | not_owner | server
    error: Optional[str] = None
    owner: Optional[str] = None  # already_assigned: who has the lead now
    action: Optional[str] = None  # assign | status
    valueLabel: Optional[str] = None
    lead: Optional[LeadActionLead] = None
    already: bool = False
    committed: bool = False


ERRORS = ("invalid", "expired", "lead_gone", "assignee_missing", "already_assigned", "not_on_team", "not_owner")


def action_url() -> Optional[str]:
    # Its own setting: turning the assignee notification off (PARTNER_LEADS_NOTIFY_URL="")
    # must not break the e-mail buttons.
    return get_settings().PARTNER_LEADS_ACTION_URL or None


@router.post("/action", response_model=LeadActionOut)
async def lead_action(body: LeadActionIn) -> LeadActionOut:
    try:
        token = str(uuid.UUID(body.token))
    except (ValueError, AttributeError, TypeError):
        return LeadActionOut(ok=False, error="invalid")
    url = action_url()
    if not url:
        raise HTTPException(status_code=503, detail="Lead buttons aren't set up on this server")
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            res = await client.post(
                url,
                json={"token": token, "commit": body.commit},
                headers={"apikey": get_settings().PARTNER_LEADS_NOTIFY_APIKEY, "Content-Type": "application/json"},
            )
        data = res.json()
    except Exception as e:  # network, timeout, non-JSON
        logger.warning("Partner lead action: function call failed: %s", e)
        return LeadActionOut(ok=False, error="server")
    if not isinstance(data, dict) or not data.get("ok"):
        err = data.get("error") if isinstance(data, dict) else None
        if err not in ERRORS:
            return LeadActionOut(ok=False, error="server")
        owner = data.get("owner") if err == "already_assigned" and isinstance(data.get("owner"), str) else None
        return LeadActionOut(ok=False, error=err, owner=owner)
    lead = data.get("lead") if isinstance(data.get("lead"), dict) else {}
    return LeadActionOut(
        ok=True,
        action=data.get("action"),
        valueLabel=str(data.get("value_label") or data.get("value") or ""),
        lead=LeadActionLead(fullName=lead.get("full_name"), company=lead.get("company")),
        already=bool(data.get("already")),
        committed=bool(data.get("committed")),
    )
