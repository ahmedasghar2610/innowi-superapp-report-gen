"""Changes the assistant can propose - and only propose.

An action tool never changes anything. It checks the request against the
data (read-only), works out exactly which API calls would make the change,
saves that as a pending AssistantAction and puts a card on screen. The change
happens only when the person clicks Confirm (router.confirm_action), which
replays those calls against the SuperApp's own API *as that person*: the same
permission checks, validation, side effects and audit-log rows as doing it by
hand on the screen. The model can't add steps, pick paths or touch an action
after proposing it; every path is built here from validated ids.
"""
from __future__ import annotations

import datetime as dt
import re
import uuid
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Optional

from sqlalchemy import func, select, text

from app.models.assistant import AssistantAction
from app.models.auth import User
from app.models import quotes as qm
from app.models import roadmap as rm
from app.modules.assistant.tools_base import DATE, Ctx, Tool, ToolError, jsonable, text_arg
from app.modules.partner_contacts import service as contacts_svc
from app.modules.partner_leads import service as leads_svc
from app.schemas.partner_contacts import PARTNER_CONTACT_STATUSES
from app.schemas.partner_leads import PARTNER_LEAD_STATUSES

MAX_ITEMS = 25
EXPIRES_AFTER = dt.timedelta(minutes=30)
ROADMAP_STATUSES = ("TODO", "IN_PROGRESS", "BLOCKED", "DONE")
ROADMAP_AREAS = ("SALES", "MERCHANTS", "MARKETING", "PLATFORM")
ROADMAP_PRIORITIES = ("HIGH", "NORMAL", "LOW")


@dataclass
class Plan:
    title: str
    items: list[str]
    steps: list[dict[str, Any]]
    destructive: bool = False
    extra: dict[str, Any] = field(default_factory=dict)


Prep = Callable[[Ctx, dict], Awaitable[Plan]]


# ------------------------------------------------------------- helpers ----
def _uuid(value: Any, what: str) -> str:
    try:
        return str(uuid.UUID(str(value)))
    except (ValueError, TypeError, AttributeError):
        raise ToolError(f"{what} must be an id from an earlier lookup")


_CUID = re.compile(r"^[a-z0-9]{1,30}$")


def _cuid(value: Any, what: str) -> str:
    v = str(value or "").strip()
    if not _CUID.match(v):
        raise ToolError(f"{what} must be an id from an earlier lookup")
    return v


def _require_seen(ctx: Ctx, ids: list[str]) -> None:
    """Only records a lookup showed in this answer may be changed."""
    unseen = [i for i in ids if i not in ctx.seen_ids]
    if unseen:
        raise ToolError("Look these records up first (in this answer), then propose the change: "
                        + ", ".join(unseen[:5]))


def _id_list(args: dict, key: str, parse: Callable[[Any, str], str], what: str) -> list[str]:
    raw = args.get(key)
    if isinstance(raw, str):
        raw = [raw]
    if not isinstance(raw, list) or not raw:
        raise ToolError(f"{key} must be a list of {what} ids from an earlier lookup")
    ids = list(dict.fromkeys(parse(v, what) for v in raw))
    if len(ids) > MAX_ITEMS:
        raise ToolError(f"At most {MAX_ITEMS} records per action. Split it up.")
    return ids


def _label(name: Optional[str], extra: Optional[str] = None) -> str:
    base = (name or "").strip() or "(no name)"
    return f"{base} ({extra})" if extra else base


async def _found(ctx: Ctx, sql: str, ids: list[str]) -> dict[str, dict]:
    rows = (await ctx.db.execute(text(sql), {"ids": ids})).mappings().all()
    return {str(r["id"]): dict(r) for r in rows}


def _missing(ids: list[str], found: dict, what: str) -> None:
    gone = [i for i in ids if i not in found]
    if gone:
        raise ToolError(f"No {what} with id(s) {', '.join(gone)}. Look them up again first.")


# --------------------------------------------------------- partner leads ----
LEAD_SQL = f"select id, full_name, company, status, assigned_to from {leads_svc.LEADS} where id = any(cast(:ids as uuid[]))"


async def leads_update(ctx: Ctx, args: dict) -> Plan:
    ids = _id_list(args, "lead_ids", _uuid, "partner lead")
    _require_seen(ctx, ids)
    body: dict[str, Any] = {}
    status = text_arg(args, "status", max_len=20)
    if status:
        if status not in PARTNER_LEAD_STATUSES:
            raise ToolError(f"status must be one of: {', '.join(PARTNER_LEAD_STATUSES)}")
        body["status"] = status
    owner_changes = "assigned_to" in args
    owner_label = None
    if owner_changes:
        raw = (str(args.get("assigned_to") or "")).strip().lower()
        if raw in ("", "unassigned", "none", "nobody"):
            body["assignedTo"] = None
            owner_label = "nobody"
        else:
            team = {m["email"].lower(): m for m in await leads_svc.get_team(ctx.db)}
            member = team.get(raw)
            if not member:
                raise ToolError("assigned_to must be the email of someone on the partner team (see partner_team).")
            why = {
                "no_login": "has no Super App login yet - an admin can invite them on Team members",
                "inactive": "has been turned off in the Super App",
                "other_role": "has a role that doesn't work partner leads",
            }.get(member.get("status") or "")
            if why:
                raise ToolError(f"{member.get('name') or raw} can't be given leads: they {why}.")
            if not member.get("assignable", True):
                raise ToolError(
                    f"{member.get('name') or raw} is switched off for partner leads (Team members screen, 'Can be given leads')."
                )
            body["assignedTo"] = raw
            owner_label = member.get("name") or raw
    if not body:
        raise ToolError("Give a new status and/or assigned_to.")
    found = await _found(ctx, LEAD_SQL, ids)
    _missing(ids, found, "partner lead")
    items, steps = [], []
    for i in ids:
        row = found[i]
        changes = []
        if "status" in body:
            changes.append(f"status {row['status']} → {body['status']}")
        if owner_changes:
            changes.append(f"owner {row['assigned_to'] or 'nobody'} → {owner_label}")
        line = f"{_label(row['full_name'], row['company'])}: {', '.join(changes)}"
        items.append(line)
        steps.append({"method": "PATCH", "path": f"/partner-leads/{i}", "json": body, "label": line})
    what = []
    if "status" in body:
        what.append(f"mark as {body['status']}")
    if owner_changes:
        what.append(f"assign to {owner_label}")
    n = len(ids)
    return Plan(title=f"{' and '.join(what).capitalize()}: {n} partner lead{'s' if n != 1 else ''}", items=items, steps=steps)


async def lead_note(ctx: Ctx, args: dict) -> Plan:
    lead_id = _uuid(args.get("lead_id"), "lead_id")
    _require_seen(ctx, [lead_id])
    note = str(args.get("note") or "").strip()
    if not note or len(note) > 4000:
        raise ToolError("note must be 1-4000 characters")
    found = await _found(ctx, LEAD_SQL, [lead_id])
    _missing([lead_id], found, "partner lead")
    row = found[lead_id]
    return Plan(title=f"Add a note to {_label(row['full_name'])}", items=[note],
                steps=[{"method": "POST", "path": f"/partner-leads/{lead_id}/notes", "json": {"body": note},
                        "label": f"Note on {_label(row['full_name'], row['company'])}"}])


async def leads_delete(ctx: Ctx, args: dict) -> Plan:
    ids = _id_list(args, "lead_ids", _uuid, "partner lead")
    _require_seen(ctx, ids)
    found = await _found(ctx, LEAD_SQL, ids)
    _missing(ids, found, "partner lead")
    items = [_label(found[i]["full_name"], found[i]["company"]) for i in ids]
    steps = [{"method": "DELETE", "path": f"/partner-leads/{i}", "label": items[n]} for n, i in enumerate(ids)]
    n = len(ids)
    return Plan(title=f"Permanently delete {n} partner lead{'s' if n != 1 else ''}", items=items, steps=steps,
                destructive=True)


# ------------------------------------------------------ partner contacts ----
CONTACT_SQL = (f"select id, full_name, company, email, status, partner_type, promoted_lead_id "
               f"from {contacts_svc.CONTACTS} where id = any(cast(:ids as uuid[]))")


async def contacts_update(ctx: Ctx, args: dict) -> Plan:
    ids = _id_list(args, "contact_ids", _uuid, "partner contact")
    _require_seen(ctx, ids)
    body: dict[str, Any] = {}
    if (status := text_arg(args, "status", max_len=30)):
        if status not in PARTNER_CONTACT_STATUSES:
            raise ToolError(f"status must be one of: {', '.join(PARTNER_CONTACT_STATUSES)}")
        body["status"] = status
    if (ptype := text_arg(args, "partner_type", max_len=80)):
        body["partnerType"] = ptype
    if not body:
        raise ToolError("Give a new status and/or partner_type.")
    found = await _found(ctx, CONTACT_SQL, ids)
    _missing(ids, found, "partner contact")
    items, steps = [], []
    for i in ids:
        row = found[i]
        changes = []
        if "status" in body:
            changes.append(f"status {row['status']} → {body['status']}")
        if "partnerType" in body:
            changes.append(f"type {row['partner_type'] or '—'} → {body['partnerType']}")
        line = f"{_label(row['full_name'], row['company'])}: {', '.join(changes)}"
        items.append(line)
        steps.append({"method": "PATCH", "path": f"/partner-contacts/{i}", "json": body, "label": line})
    n = len(ids)
    return Plan(title=f"Update {n} partner network contact{'s' if n != 1 else ''}", items=items, steps=steps)


async def contact_promote(ctx: Ctx, args: dict) -> Plan:
    cid = _uuid(args.get("contact_id"), "contact_id")
    _require_seen(ctx, [cid])
    found = await _found(ctx, CONTACT_SQL, [cid])
    _missing([cid], found, "partner contact")
    row = found[cid]
    if row["promoted_lead_id"]:
        raise ToolError("That contact is already a partner lead.")
    if not row["email"]:
        raise ToolError("That contact has no e-mail address, and a partner lead needs one. Add it on the Network screen first.")
    body: dict[str, Any] = {}
    if (ptype := text_arg(args, "partner_type", max_len=80)):
        body["partnerType"] = ptype
    line = _label(row["full_name"], row["company"])
    return Plan(title=f"Turn {line} into a partner lead", items=[f"{line} · {row['email']}"],
                steps=[{"method": "POST", "path": f"/partner-contacts/{cid}/promote", "json": body, "label": line}])


# ---------------------------------------------------------------- quotes ----
async def quote_links_revoke(ctx: Ctx, args: dict) -> Plan:
    ids = _id_list(args, "link_ids", _cuid, "quote link")
    _require_seen(ctx, ids)
    rows = (await ctx.db.execute(select(qm.QuoteLink).where(qm.QuoteLink.id.in_(ids)))).scalars().all()
    found = {r.id: r for r in rows}
    _missing(ids, found, "quote link")
    active = [i for i in ids if found[i].status == "ACTIVE"]
    if not active:
        raise ToolError("Those links are already revoked.")
    items = [f"{found[i].restaurant_name} (sent by {found[i].created_by_email})" for i in active]
    steps = [{"method": "POST", "path": f"/quotes/links/{i}/revoke", "label": items[n]} for n, i in enumerate(active)]
    n = len(active)
    return Plan(title=f"Revoke {n} quote link{'s' if n != 1 else ''} (the restaurant can no longer open it)",
                items=items, steps=steps, destructive=True)


async def quote_request_update(ctx: Ctx, args: dict) -> Plan:
    rid = _cuid(args.get("request_id"), "request_id")
    _require_seen(ctx, [rid])
    r = await ctx.db.get(qm.QuoteRequest, rid)
    if r is None:
        raise ToolError("No quote request with that id. Look it up again first.")
    body: dict[str, Any] = {}
    changes = []
    if (status := text_arg(args, "status", max_len=20)):
        status = status.upper()
        if status not in ("REQUESTED", "PROPOSED", "DECLINED", "CLOSED"):
            raise ToolError("status must be REQUESTED, PROPOSED, DECLINED or CLOSED")
        if r.status == qm.STATUS_ACCEPTED:
            raise ToolError("That proposal was accepted; its status can't change.")
        body["status"] = status
        changes.append(f"status {r.status} → {status}")
    if "staff_note" in args:
        note = str(args.get("staff_note") or "").strip()[:4000]
        body["staffNote"] = note or None
        changes.append("staff note: " + (f"“{note}”" if note else "cleared"))
    if not body:
        raise ToolError("Give a new status and/or staff_note.")
    line = f"{r.number} · {r.restaurant_name}: {'; '.join(changes)}"
    return Plan(title=f"Update quote request {r.number}", items=[line],
                steps=[{"method": "PATCH", "path": f"/quotes/requests/{rid}", "json": body, "label": line}])


# --------------------------------------------------------------- roadmap ----
async def _owner_id(ctx: Ctx, email: Optional[str]) -> Optional[str]:
    if email is None:
        return None
    user = (await ctx.db.execute(select(User).where(func.lower(User.email) == email.strip().lower()))).scalar_one_or_none()
    if not user:
        raise ToolError(f"No SuperApp login with the email {email}.")
    return user.id


async def roadmap_create(ctx: Ctx, args: dict) -> Plan:
    title = text_arg(args, "title", max_len=200)
    if not title:
        raise ToolError("title is required")
    phase_ref = text_arg(args, "phase", max_len=120)
    if not phase_ref:
        raise ToolError("phase is required (a phase id or name from the roadmap lookup)")
    phase = await ctx.db.get(rm.Phase, phase_ref) if phase_ref.isalnum() and len(phase_ref) <= 30 else None
    if phase is None:
        matches = (await ctx.db.execute(select(rm.Phase).where(rm.Phase.name.ilike(f"%{phase_ref}%")))).scalars().all()
        if len(matches) != 1:
            raise ToolError(f'"{phase_ref}" matches {len(matches)} phases; use the phase id from the roadmap lookup.')
        phase = matches[0]
    area = (text_arg(args, "area", max_len=20) or "").upper()
    if area not in ROADMAP_AREAS:
        raise ToolError(f"area must be one of {', '.join(ROADMAP_AREAS)}")
    body: dict[str, Any] = {"phaseId": phase.id, "title": title, "area": area}
    for key, allowed, field_ in (("status", ROADMAP_STATUSES, "status"), ("priority", ROADMAP_PRIORITIES, "priority")):
        if (v := text_arg(args, key, max_len=20)):
            v = v.upper()
            if v not in allowed:
                raise ToolError(f"{key} must be one of {', '.join(allowed)}")
            body[field_] = v
    if (desc := text_arg(args, "description", max_len=4000)):
        body["description"] = desc
    if args.get("target_date"):
        try:
            body["targetDate"] = dt.date.fromisoformat(str(args["target_date"])[:10]).isoformat()
        except ValueError:
            raise ToolError("target_date must be YYYY-MM-DD")
    if args.get("owner_email"):
        body["ownerId"] = await _owner_id(ctx, str(args["owner_email"]))
    details = [f"Phase: {phase.name}", f"Area: {area}", f"Status: {body.get('status', 'TODO')}",
               f"Priority: {body.get('priority', 'NORMAL')}"]
    if args.get("owner_email"):
        details.append(f"Owner: {args['owner_email']}")
    if body.get("targetDate"):
        details.append(f"Target: {body['targetDate']}")
    return Plan(title=f"Add roadmap item “{title}”", items=details,
                steps=[{"method": "POST", "path": "/roadmap/items", "json": body, "label": title}])


ROADMAP_FIELDS = {"title": "title", "status": "status", "priority": "priority", "area": "area", "notes": "notes",
                  "target_date": "targetDate", "description": "description"}


async def roadmap_update(ctx: Ctx, args: dict) -> Plan:
    item_id = _cuid(args.get("item_id"), "item_id")
    _require_seen(ctx, [item_id])
    item = await ctx.db.get(rm.Item, item_id)
    if item is None:
        raise ToolError("No roadmap item with that id. Look it up again first.")
    body: dict[str, Any] = {}
    changes = []
    for key, out in ROADMAP_FIELDS.items():
        if key not in args or args[key] is None:
            continue
        value = str(args[key]).strip()
        if not value and key in ("title", "status", "priority", "area"):
            continue  # blank means "leave as is" for these
        if key in ("status", "priority", "area"):
            value = value.upper()
            allowed = {"status": ROADMAP_STATUSES, "priority": ROADMAP_PRIORITIES, "area": ROADMAP_AREAS}[key]
            if value not in allowed:
                raise ToolError(f"{key} must be one of {', '.join(allowed)}")
        if key == "target_date":
            try:
                value = dt.date.fromisoformat(value[:10]).isoformat()
            except ValueError:
                raise ToolError("target_date must be YYYY-MM-DD")
        body[out] = value[:4000]
        changes.append(f"{key.replace('_', ' ')} → {value[:4000]}")
    if "owner_email" in args:
        email = args.get("owner_email")
        body["ownerId"] = await _owner_id(ctx, str(email)) if email else None
        changes.append(f"owner → {email or 'nobody'}")
    if not body:
        raise ToolError("Nothing to change.")
    if not ctx.can("roadmap.manage"):
        if item.owner_id != ctx.user.id:
            raise ToolError("Only admins and the item's owner can change it.")
        extra = set(body) - {"status", "notes", "targetDate"}
        if extra:
            raise ToolError("As the item's owner you can change its status, notes and target date; ask an admin for the rest.")
    return Plan(title=f"Update roadmap item “{item.title}”", items=changes,
                steps=[{"method": "PATCH", "path": f"/roadmap/items/{item_id}", "json": body, "label": item.title}])


async def roadmap_delete(ctx: Ctx, args: dict) -> Plan:
    ids = _id_list(args, "item_ids", _cuid, "roadmap item")
    _require_seen(ctx, ids)
    rows = (await ctx.db.execute(select(rm.Item).where(rm.Item.id.in_(ids)))).scalars().all()
    found = {r.id: r for r in rows}
    _missing(ids, found, "roadmap item")
    items = [found[i].title for i in ids]
    steps = [{"method": "DELETE", "path": f"/roadmap/items/{i}", "label": items[n]} for n, i in enumerate(ids)]
    n = len(ids)
    return Plan(title=f"Delete {n} roadmap item{'s' if n != 1 else ''}", items=items, steps=steps, destructive=True)


# ----------------------------------------------------------- proposing ----
def action_card(row: AssistantAction) -> dict[str, Any]:
    status = row.status
    now = dt.datetime.now(dt.timezone.utc)
    if status == "pending" and row.expires_at <= now:
        status = "expired"
    elif status == "running" and row.decided_at and now - row.decided_at > dt.timedelta(minutes=5):
        status = "interrupted"  # the server stopped part-way; results show what went through
    return jsonable({
        "id": row.id, "name": row.name, "title": row.title, "items": row.items, "destructive": row.destructive,
        "status": status, "results": row.results, "expiresAt": row.expires_at, "steps": len(row.steps or []),
    })


async def save_plan(ctx: Ctx, name: str, plan: Plan) -> dict[str, Any]:
    """Save a plan as a pending action, put its card on screen, and tell the model it's NOT done."""
    if ctx.session_factory is None:
        raise ToolError("Actions aren't available here.")
    if not plan.steps:
        raise ToolError("Nothing to do.")
    now = dt.datetime.now(dt.timezone.utc)
    row = AssistantAction(
        user_id=ctx.user.id, chat_id=ctx.chat_id, name=name, title=plan.title[:200],
        # Shown in full: the card must show everything the steps will write.
        items=list(plan.items), destructive=plan.destructive, steps=plan.steps,
        status="pending", expires_at=now + EXPIRES_AFTER,
    )
    async with ctx.session_factory() as db:
        db.add(row)
        await db.commit()
        await db.refresh(row)
    card = action_card(row)
    ctx.actions.append(card)
    return {
        "proposed": True, "actionId": row.id, "title": plan.title, "items": plan.items,
        "note": ("NOT done yet. It's on screen as a card with Confirm and Cancel; nothing changes until the "
                 "person clicks Confirm. Tell them in one sentence what will happen and ask them to confirm. "
                 "Never say it's done."),
    }


def _proposer(name: str, prep: Prep):
    async def run(ctx: Ctx, args: dict) -> dict[str, Any]:
        if ctx.session_factory is None:
            raise ToolError("Actions aren't available here.")
        return await save_plan(ctx, name, await prep(ctx, args))

    return run


IDS = {"type": "array", "items": {"type": "string"}, "maxItems": MAX_ITEMS}
PROPOSE = ("Proposes a change; nothing happens until the person clicks Confirm on the card. "
           "Use ids from a lookup in this conversation, never guessed ones.")

ACTION_TOOLS: list[Tool] = [
    Tool(name="propose_partner_leads_update", label="Preparing a change to partner leads", capability="partners.edit",
         run=_proposer("partner_leads_update", leads_update),
         description=f"Change the status (new, contacted, qualified, proposal, won, lost, spam) and/or owner of partner leads. {PROPOSE}",
         properties={"lead_ids": IDS, "status": {"type": "string", "enum": list(PARTNER_LEAD_STATUSES)},
                     "assigned_to": {"type": ["string", "null"], "description": "Partner team email, or 'unassigned'."}},
         required=("lead_ids",)),
    Tool(name="propose_partner_lead_note", label="Preparing a note on a partner lead", capability="partners.edit",
         run=_proposer("partner_lead_note", lead_note),
         description=f"Add a note to one partner lead. {PROPOSE}",
         properties={"lead_id": {"type": "string"}, "note": {"type": "string"}}, required=("lead_id", "note")),
    Tool(name="propose_partner_leads_delete", label="Preparing to delete partner leads", capability="partners.delete",
         run=_proposer("partner_leads_delete", leads_delete),
         description=(f"Permanently delete partner leads with their notes and history (for test or junk entries). "
                      f"There is no undo. {PROPOSE}"),
         properties={"lead_ids": IDS}, required=("lead_ids",)),
    Tool(name="propose_partner_contacts_update", label="Preparing a change to partner contacts",
         capability="partners.edit", run=_proposer("partner_contacts_update", contacts_update),
         description=f"Change the status ({', '.join(PARTNER_CONTACT_STATUSES)}) and/or partner type of Partner Network contacts. {PROPOSE}",
         properties={"contact_ids": IDS, "status": {"type": "string", "enum": list(PARTNER_CONTACT_STATUSES)},
                     "partner_type": {"type": "string"}}, required=("contact_ids",)),
    Tool(name="propose_partner_contact_promote", label="Preparing to turn a contact into a lead",
         capability="partners.edit", run=_proposer("partner_contact_promote", contact_promote),
         description=f"Turn one Partner Network contact into a partner lead. {PROPOSE}",
         properties={"contact_id": {"type": "string"}, "partner_type": {"type": "string"}}, required=("contact_id",)),
    Tool(name="propose_quote_links_revoke", label="Preparing to revoke quote links", capability="quotes.edit",
         run=_proposer("quote_links_revoke", quote_links_revoke),
         description=f"Revoke quote links so restaurants can no longer open them. {PROPOSE}",
         properties={"link_ids": IDS}, required=("link_ids",)),
    Tool(name="propose_quote_request_update", label="Preparing a change to a quote request", capability="quotes.edit",
         run=_proposer("quote_request_update", quote_request_update),
         description=f"Change a quote request's status (REQUESTED, PROPOSED, DECLINED, CLOSED) and/or staff note. {PROPOSE}",
         properties={"request_id": {"type": "string"},
                     "status": {"type": "string", "enum": ["REQUESTED", "PROPOSED", "DECLINED", "CLOSED"]},
                     "staff_note": {"type": ["string", "null"]}}, required=("request_id",)),
    Tool(name="propose_roadmap_item_create", label="Preparing a new roadmap item", capability="roadmap.manage",
         run=_proposer("roadmap_item_create", roadmap_create),
         description=f"Add an item to the roadmap. {PROPOSE}",
         properties={"phase": {"type": "string", "description": "Phase id or name"}, "title": {"type": "string"},
                     "area": {"type": "string", "enum": list(ROADMAP_AREAS)},
                     "status": {"type": "string", "enum": list(ROADMAP_STATUSES)},
                     "priority": {"type": "string", "enum": list(ROADMAP_PRIORITIES)},
                     "owner_email": {"type": "string"}, "target_date": DATE, "description": {"type": "string"}},
         required=("phase", "title", "area")),
    Tool(name="propose_roadmap_item_update", label="Preparing a change to a roadmap item", capability="roadmap.view",
         run=_proposer("roadmap_item_update", roadmap_update),
         description=(f"Change a roadmap item (admins: anything; an item's owner: status, notes, target date). {PROPOSE}"),
         properties={"item_id": {"type": "string"}, "title": {"type": "string"},
                     "status": {"type": "string", "enum": list(ROADMAP_STATUSES)},
                     "priority": {"type": "string", "enum": list(ROADMAP_PRIORITIES)},
                     "area": {"type": "string", "enum": list(ROADMAP_AREAS)}, "notes": {"type": "string"},
                     "target_date": DATE, "description": {"type": "string"},
                     "owner_email": {"type": ["string", "null"]}}, required=("item_id",)),
    Tool(name="propose_roadmap_items_delete", label="Preparing to delete roadmap items", capability="roadmap.manage",
         run=_proposer("roadmap_items_delete", roadmap_delete),
         description=f"Delete roadmap items. {PROPOSE}", properties={"item_ids": IDS}, required=("item_ids",)),
]
