"""Lookups over the rest of the SuperApp: partner leads and contacts, quotes,
merchants, websites, the audit log and logins.

Each one needs the same capability as the screen that shows that data, so
the assistant never shows someone more than the app already does.
"""
from __future__ import annotations

import datetime as dt
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import func, or_, select, text
from sqlalchemy.orm import selectinload

from app.config import get_settings
from app.models import quotes as qm
from app.models.audit import AuditLog
from app.models.auth import User
from app.models.enums import AccountHealth
from app.models.profiling import AccountManager, Merchant, Subscription
from app.models.website import Website
from app.modules.partner_contacts import service as contacts_svc
from app.modules.partner_leads import service as leads_svc
from app.modules.quotes import service as quotes_svc
from app.modules.assistant.tools_base import (
    DATE, LIMIT, SEARCH, Ctx, Tool, ToolError, choice_arg, date_arg, day_end_exclusive, day_start, jsonable,
    limit_arg, page, text_arg, bool_arg,
)

MAX_GROUPS = 60


def _tz() -> ZoneInfo:
    return ZoneInfo(get_settings().SALES_TIMEZONE)


def _range(args: dict) -> tuple[dt.datetime | None, dt.datetime | None]:
    tz = _tz()
    start, end = date_arg(args, "created_from"), date_arg(args, "created_to")
    return (day_start(start, tz) if start else None,
            # The partner services compare with <=; one microsecond before the next day.
            (day_end_exclusive(end, tz) - dt.timedelta(microseconds=1)) if end else None)


async def _raw_groups(ctx: Ctx, table: str, where, expr: str, *, by_key: bool) -> list[dict[str, Any]]:
    order = "1" if by_key else "count(*) desc, 1"
    rows = (await ctx.db.execute(
        text(f"select {expr} as key, count(*) as count from {table} where {where.sql} group by 1 order by {order} "
             f"limit {MAX_GROUPS}"),
        where.params,
    )).mappings().all()
    return [{"key": r["key"] if r["key"] not in (None, "") else "(blank)", "count": int(r["count"])} for r in rows]


# ------------------------------------------------------- partner leads ----
LEAD_GROUPS = {
    "status": "status",
    "source": "coalesce(source_cta, 'unknown')",
    "assigned_to": "coalesce(assigned_to, 'unassigned')",
    "partner_type": "partner_type",
    "region": "region",
    "utm_source": "utm_source",
    "month": "to_char(created_at at time zone :tz, 'YYYY-MM')",
}
LEAD_ROW = ("id, created_at, status, full_name, title, company, email, phone, partner_type, region, portfolio_size, "
            "timeline, source_cta, assigned_to, last_contacted_at")


async def partner_leads(ctx: Ctx, args: dict) -> dict[str, Any]:
    start, end = _range(args)
    assigned = text_arg(args, "assigned_to", max_len=200)
    f = leads_svc.LeadFilters(
        q=text_arg(args, "search"), status=text_arg(args, "status", max_len=40),
        source=text_arg(args, "source", max_len=120), assigned_to=assigned,
        include_spam=bool_arg(args, "include_spam"), from_=start, to=end,
    )
    w = leads_svc.build_where(f)
    total = int((await ctx.db.execute(text(f"select count(*) from {leads_svc.LEADS} where {w.sql}"), w.params)).scalar_one())
    out: dict[str, Any] = {"totals": {"leads": total},
                           "note_on_spam": "Spam is left out unless include_spam is true or status is 'spam'."}
    group_by = choice_arg(args, "group_by", tuple(LEAD_GROUPS))
    if group_by:
        w.params["tz"] = _tz().key
        out["group_by"] = group_by
        out["groups"] = await _raw_groups(ctx, leads_svc.LEADS, w, LEAD_GROUPS[group_by], by_key=group_by == "month")
        return out
    limit = limit_arg(args)
    rows = (await ctx.db.execute(
        text(f"select {LEAD_ROW} from {leads_svc.LEADS} where {w.sql} order by created_at desc limit :limit"),
        {**w.params, "limit": limit},
    )).mappings().all()
    out.update(page([jsonable(dict(r)) for r in rows], total, limit))
    return out


async def partner_lead_detail(ctx: Ctx, args: dict) -> dict[str, Any]:
    lead_id = leads_svc.parse_uuid(str(args.get("lead_id") or ""))
    if not lead_id:
        raise ToolError("lead_id must be an id from partner_leads.")
    lead = await leads_svc.get_lead(ctx.db, lead_id)
    if not lead:
        raise ToolError("No partner lead with that id.")
    notes = await leads_svc.get_notes(ctx.db, lead_id)
    events = await leads_svc.get_events(ctx.db, lead_id)
    return jsonable({"lead": lead, "notes": notes[:20], "history": events[:20], "link": "/partners"})


async def partner_team(ctx: Ctx, args: dict) -> dict[str, Any]:
    return {"team": jsonable(await leads_svc.get_team(ctx.db))}


# ---------------------------------------------------- partner contacts ----
CONTACT_GROUPS = {
    "status": "status",
    "event": "coalesce(nullif(met_at, ''), 'unknown')",
    "partner_type": "partner_type",
    "source": "source",
    "scanned_by": "scanned_by",
    "month": "to_char(created_at at time zone :tz, 'YYYY-MM')",
}
CONTACT_ROW = ("id, created_at, status, full_name, title, company, email, phone, partner_type, met_at, met_on, source, "
               "scanned_by, promoted_lead_id")


async def partner_contacts(ctx: Ctx, args: dict) -> dict[str, Any]:
    start, end = _range(args)
    promoted = args.get("promoted")
    f = contacts_svc.ContactFilters(
        q=text_arg(args, "search"), status=text_arg(args, "status", max_len=40),
        event=text_arg(args, "event", max_len=160), source=text_arg(args, "source", max_len=60),
        promoted=None if promoted is None else bool_arg(args, "promoted"), from_=start, to=end,
    )
    w = contacts_svc.build_where(f)
    total = int((await ctx.db.execute(text(f"select count(*) from {contacts_svc.CONTACTS} where {w.sql}"), w.params)).scalar_one())
    out: dict[str, Any] = {"totals": {"contacts": total}}
    group_by = choice_arg(args, "group_by", tuple(CONTACT_GROUPS))
    if group_by:
        w.params["tz"] = _tz().key
        out["group_by"] = group_by
        out["groups"] = await _raw_groups(ctx, contacts_svc.CONTACTS, w, CONTACT_GROUPS[group_by], by_key=group_by == "month")
        return out
    limit = limit_arg(args)
    rows = (await ctx.db.execute(
        text(f"select {CONTACT_ROW} from {contacts_svc.CONTACTS} where {w.sql} order by created_at desc limit :limit"),
        {**w.params, "limit": limit},
    )).mappings().all()
    out.update(page([jsonable(dict(r)) for r in rows], total, limit, link="/partners/network"))
    return out


# --------------------------------------------------------------- quotes ----
async def quotes(ctx: Ctx, args: dict) -> dict[str, Any]:
    kind = choice_arg(args, "kind", ("requests", "links"), "requests")
    tz = _tz()
    search = text_arg(args, "search")
    start, end = date_arg(args, "created_from"), date_arg(args, "created_to")
    rep = text_arg(args, "sent_by", max_len=200)
    status = text_arg(args, "status", max_len=20)
    L, R = qm.QuoteLink, qm.QuoteRequest
    if kind == "links":
        conds = []
        if search:
            conds.append(or_(L.restaurant_name.ilike(f"%{search}%"), L.contact_name.ilike(f"%{search}%")))
        if status:
            conds.append(L.status == status.upper())
        if rep:
            conds.append(L.created_by_email.ilike(f"%{rep}%"))
        if start:
            conds.append(L.created_at >= day_start(start, tz))
        if end:
            conds.append(L.created_at < day_end_exclusive(end, tz))
        total = (await ctx.db.execute(select(func.count()).select_from(L).where(*conds))).scalar_one()
        out: dict[str, Any] = {"kind": "quote links sent to restaurants", "totals": {"links": total}}
        if args.get("group_by") == "plan":
            raise ToolError("Quote links have no hardware plan; group requests by plan instead (kind='requests').")
        group_by = choice_arg(args, "group_by", ("status", "mode", "sent_by", "month"))
        if group_by:
            key = {"status": L.status, "mode": L.mode, "sent_by": L.created_by_email,
                   "month": func.to_char(func.timezone(tz.key, L.created_at), "YYYY-MM")}[group_by]
            rows = (await ctx.db.execute(select(key.label("key"), func.count().label("count")).where(*conds)
                                         .group_by(key).order_by(key if group_by == "month" else func.count().desc())
                                         .limit(MAX_GROUPS))).all()
            out["group_by"] = group_by
            out["groups"] = [{"key": r.key, "count": r.count} for r in rows]
            return out
        limit = limit_arg(args)
        rows = (await ctx.db.execute(select(L).where(*conds).order_by(L.created_at.desc()).limit(limit))).scalars().all()
        out.update(page([jsonable({
            "restaurant": x.restaurant_name, "contact": x.contact_name, "email": x.contact_email,
            "pricesShown": x.mode == qm.MODE_SHOW, "status": x.status, "discountPercent": x.discount_percent,
            "sentBy": x.created_by_email, "created": x.created_at, "expires": x.expires_at,
            "timesOpened": x.open_count, "lastOpened": x.last_opened_at, "id": x.id, "link": f"/quotes/links/{x.id}",
        }) for x in rows], total, limit))
        return out

    conds = []
    if search:
        conds.append(or_(R.restaurant_name.ilike(f"%{search}%"), R.contact_name.ilike(f"%{search}%"), R.number.ilike(f"%{search}%")))
    if status:
        conds.append(R.status == status.upper())
    if rep:
        conds.append(L.created_by_email.ilike(f"%{rep}%"))
    if start:
        conds.append(R.created_at >= day_start(start, tz))
    if end:
        conds.append(R.created_at < day_end_exclusive(end, tz))
    joined = select(func.count()).select_from(R).join(L, L.id == R.link_id).where(*conds)
    total = (await ctx.db.execute(joined)).scalar_one()
    sums = (await ctx.db.execute(
        select(func.coalesce(func.sum(R.one_time_total), 0), func.coalesce(func.sum(R.monthly_software_total), 0),
               func.coalesce(func.sum(R.monthly_lease_total), 0)).select_from(R).join(L, L.id == R.link_id).where(*conds)
    )).one()
    out = {"kind": "quote requests restaurants submitted", "totals": jsonable(
        {"requests": total, "oneTime": sums[0], "monthlySoftware": sums[1], "monthlyLease": sums[2]}),
        "statuses": "REQUESTED (team to price), PROPOSED (restaurant saw prices), ACCEPTED, DECLINED, CLOSED"}
    group_by = choice_arg(args, "group_by", ("status", "plan", "mode", "sent_by", "month"))
    if group_by:
        key = {"status": R.status, "plan": R.hardware_plan, "mode": R.mode, "sent_by": L.created_by_email,
               "month": func.to_char(func.timezone(tz.key, R.created_at), "YYYY-MM")}[group_by]
        rows = (await ctx.db.execute(
            select(key.label("key"), func.count().label("count"), func.coalesce(func.sum(R.one_time_total), 0).label("oneTime"))
            .select_from(R).join(L, L.id == R.link_id).where(*conds).group_by(key)
            .order_by(key if group_by == "month" else func.count().desc()).limit(MAX_GROUPS))).all()
        out["group_by"] = group_by
        out["groups"] = [jsonable({"key": r.key, "count": r.count, "oneTimeTotal": r.oneTime}) for r in rows]
        return out
    limit = limit_arg(args)
    rows = (await ctx.db.execute(
        select(R, L.created_by_email).join(L, L.id == R.link_id).where(*conds).order_by(R.created_at.desc()).limit(limit)
    )).all()
    out.update(page([jsonable({
        "number": r.QuoteRequest.number, "restaurant": r.QuoteRequest.restaurant_name,
        "contact": r.QuoteRequest.contact_name, "email": r.QuoteRequest.contact_email, "status": r.QuoteRequest.status,
        "hardwarePlan": r.QuoteRequest.hardware_plan, "oneTimeTotal": r.QuoteRequest.one_time_total,
        "monthlySoftware": r.QuoteRequest.monthly_software_total, "monthlyLease": r.QuoteRequest.monthly_lease_total,
        "sentBy": r.created_by_email, "created": r.QuoteRequest.created_at, "accepted": r.QuoteRequest.accepted_at,
        "id": r.QuoteRequest.id, "link": f"/quotes/requests/{r.QuoteRequest.id}",
    }) for r in rows], total, limit))
    return out


async def price_list(ctx: Ctx, args: dict) -> dict[str, Any]:
    items = await quotes_svc.list_price_items(ctx.db, active_only=not bool_arg(args, "include_inactive"))
    search = (text_arg(args, "search") or "").lower()
    rows = [jsonable({
        "sku": i.sku, "name": i.name, "section": i.section, "kind": i.kind, "unit": i.unit_label,
        "monthly": i.monthly_price, "purchase": i.purchase_price, "lease": i.lease_price, "description": i.description,
    }) for i in items if not search or search in (i.name or "").lower() or search in (i.sku or "").lower()]
    return {"items": rows[:80], "total": len(rows), "link": "/quotes/price-list"}


# ------------------------------------------------------------ merchants ----
MERCHANT_GROUPS = ("health", "cuisine", "pos", "website_platform", "account_manager")


async def merchants(ctx: Ctx, args: dict) -> dict[str, Any]:
    M = Merchant
    conds = []
    if (search := text_arg(args, "search")):
        conds.append(or_(M.restaurant_name.ilike(f"%{search}%"), M.legal_name.ilike(f"%{search}%"),
                         M.merchant_code.ilike(f"%{search}%")))
    if (health := text_arg(args, "health", max_len=10)):
        try:
            conds.append(M.account_health == AccountHealth(health.upper()))
        except ValueError:
            raise ToolError("health must be GREEN, YELLOW or RED")
    total = (await ctx.db.execute(select(func.count()).select_from(M).where(*conds))).scalar_one()
    out: dict[str, Any] = {"totals": {"merchants": total}, "about": "Restaurants managed in the SuperApp's marketing side."}
    group_by = choice_arg(args, "group_by", MERCHANT_GROUPS)
    if group_by:
        key = {"health": M.account_health, "cuisine": M.cuisine_category, "pos": M.pos_system,
               "website_platform": M.website_platform, "account_manager": AccountManager.name}[group_by]
        stmt = select(key.label("key"), func.count().label("count")).select_from(M)
        if group_by == "account_manager":
            stmt = stmt.outerjoin(AccountManager, AccountManager.id == M.account_manager_id)
        rows = (await ctx.db.execute(stmt.where(*conds).group_by(key).order_by(func.count().desc()).limit(MAX_GROUPS))).all()
        out["group_by"] = group_by
        out["groups"] = [jsonable({"key": r.key if r.key is not None else "(blank)", "count": r.count}) for r in rows]
        return out
    limit = limit_arg(args)
    rows = (await ctx.db.execute(
        select(M).options(selectinload(M.account_manager), selectinload(M.locations))
        .where(*conds).order_by(M.restaurant_name).limit(limit)
    )).scalars().all()
    out.update(page([jsonable({
        "id": x.id, "name": x.restaurant_name, "code": x.merchant_code, "cuisine": x.cuisine_category,
        "pos": x.pos_system, "website": x.website_url, "websitePlatform": x.website_platform,
        "onlineOrdering": x.online_ordering, "health": x.account_health, "profileComplete": x.profile_completion_pct,
        "accountManager": x.account_manager.name if x.account_manager else None, "locations": len(x.locations),
        "nextAction": x.next_action, "onboarding": x.onboarding_date, "goLive": x.go_live_date,
        "link": f"/merchants/{x.id}",
    }) for x in rows], total, limit))
    return out


async def merchant_detail(ctx: Ctx, args: dict) -> dict[str, Any]:
    merchant_id = text_arg(args, "merchant_id", max_len=40)
    name = text_arg(args, "name")
    M = Merchant
    stmt = select(M).options(selectinload(M.account_manager), selectinload(M.locations), selectinload(M.contacts),
                             selectinload(M.subscription))
    if merchant_id:
        x = (await ctx.db.execute(stmt.where(M.id == merchant_id))).scalars().first()
    elif name:
        x = (await ctx.db.execute(stmt.where(M.restaurant_name.ilike(f"%{name}%")).order_by(M.restaurant_name).limit(1))).scalars().first()
    else:
        raise ToolError("Give merchant_id or name.")
    if not x:
        raise ToolError("No merchant found.")
    sub: Subscription | None = x.subscription
    return jsonable({
        "id": x.id, "name": x.restaurant_name, "legalName": x.legal_name, "code": x.merchant_code,
        "cuisine": x.cuisine_category, "pos": x.pos_system, "website": x.website_url,
        "websitePlatform": x.website_platform, "onlineOrdering": x.online_ordering,
        "googleAdsBudget": x.google_ads_budget, "metaAdsBudget": x.meta_ads_budget,
        "businessGoals": x.business_goals, "targetAudience": x.target_audience, "slowDayparts": x.slow_dayparts,
        "seasonalPeaks": x.seasonal_peaks, "health": x.account_health, "profileComplete": x.profile_completion_pct,
        "nextAction": x.next_action, "openBlockers": x.open_blockers, "notes": x.notes,
        "onboarding": x.onboarding_date, "goLive": x.go_live_date,
        "accountManager": x.account_manager.name if x.account_manager else None,
        "subscription": {"package": sub.package_code, "status": sub.status, "mrr": sub.mrr,
                         "renewal": sub.renewal_date} if sub else None,
        "locations": [{"address": l.address, "city": l.city, "state": l.state} for l in x.locations][:15],
        "contacts": [{"name": c.name, "role": c.role, "email": c.email, "phone": c.phone} for c in x.contacts][:15],
        "link": f"/merchants/{x.id}",
    })


# ------------------------------------------------------------- websites ----
async def websites(ctx: Ctx, args: dict) -> dict[str, Any]:
    W = Website
    conds = []
    if (search := text_arg(args, "search")):
        conds.append(or_(W.name.ilike(f"%{search}%"), W.slug.ilike(f"%{search}%")))
    if (status := text_arg(args, "status", max_len=32)):
        conds.append(W.status == status)
    total = (await ctx.db.execute(select(func.count()).select_from(W).where(*conds))).scalar_one()
    out: dict[str, Any] = {"totals": {"websites": total},
                           "statuses": "in_creation, under_review, live, update_required, inactive (the site lifecycle)"}
    if args.get("group_by") == "status":
        rows = (await ctx.db.execute(select(W.status, func.count()).where(*conds).group_by(W.status))).all()
        out["groups"] = [{"key": r[0], "count": r[1]} for r in rows]
        return out
    limit = limit_arg(args)
    rows = (await ctx.db.execute(
        select(W.id, W.name, W.slug, W.status, W.contact_email, W.updated_at, W.created_at, Merchant.restaurant_name)
        .outerjoin(Merchant, Merchant.id == W.merchant_id).where(*conds).order_by(W.updated_at.desc()).limit(limit)
    )).all()
    out.update(page([jsonable({
        "name": r.name, "slug": r.slug, "status": r.status, "merchant": r.restaurant_name,
        "contactEmail": r.contact_email, "created": r.created_at, "updated": r.updated_at, "link": "/web/website",
    }) for r in rows], total, limit))
    return out


# ------------------------------------------------------------ audit log ----
async def audit_log(ctx: Ctx, args: dict) -> dict[str, Any]:
    A = AuditLog
    tz = _tz()
    conds = []
    if (actor := text_arg(args, "actor", max_len=200)):
        conds.append(A.actor_email.ilike(f"%{actor}%"))
    if (entity := text_arg(args, "entity_type", max_len=80)):
        conds.append(func.lower(A.entity_type) == entity.lower())
    if (action := choice_arg(args, "action", ("CREATE", "UPDATE", "DELETE"))):
        conds.append(A.action == action)
    if (d := date_arg(args, "from")):
        conds.append(A.created_at >= day_start(d, tz))
    if (d := date_arg(args, "to")):
        conds.append(A.created_at < day_end_exclusive(d, tz))
    total = (await ctx.db.execute(select(func.count()).select_from(A).where(*conds))).scalar_one()
    out: dict[str, Any] = {"totals": {"changes": total}}
    group_by = choice_arg(args, "group_by", ("actor", "action", "entity_type", "day"))
    if group_by:
        key = {"actor": A.actor_email, "action": A.action, "entity_type": A.entity_type,
               "day": func.to_char(func.timezone(tz.key, A.created_at), "YYYY-MM-DD")}[group_by]
        rows = (await ctx.db.execute(select(key.label("key"), func.count().label("count")).where(*conds).group_by(key)
                                     .order_by(key if group_by == "day" else func.count().desc()).limit(MAX_GROUPS))).all()
        out["group_by"] = group_by
        out["groups"] = [jsonable({"key": r.key, "count": r.count}) for r in rows]
        return out
    limit = limit_arg(args)
    rows = (await ctx.db.execute(select(A).where(*conds).order_by(A.created_at.desc()).limit(limit))).scalars().all()
    out.update(page([jsonable({
        "when": r.created_at, "who": r.actor_email, "role": r.actor_role, "action": r.action, "what": r.entity_type,
        "changedFields": r.changed_fields, "outcome": r.outcome, "path": r.path,
    }) for r in rows], total, limit, link="/audit-log"))
    return out


# --------------------------------------------------------------- roadmap ----
async def roadmap(ctx: Ctx, args: dict) -> dict[str, Any]:
    from app.models import roadmap as rm

    I, P = rm.Item, rm.Phase
    conds = []
    if (search := text_arg(args, "search")):
        conds.append(or_(I.title.ilike(f"%{search}%"), I.description.ilike(f"%{search}%")))
    if (status := text_arg(args, "status", max_len=20)):
        conds.append(I.status == status.upper())
    if (area := text_arg(args, "area", max_len=20)):
        conds.append(I.area == area.upper())
    if (owner := text_arg(args, "owner", max_len=200)):
        conds.append(or_(User.email.ilike(f"%{owner}%"), User.first_name.ilike(f"%{owner}%")))
    phases = (await ctx.db.execute(select(P).order_by(P.sort_order, P.start_month))).scalars().all()
    rows = (await ctx.db.execute(
        select(I, User.email, User.first_name, User.last_name).outerjoin(User, User.id == I.owner_id)
        .where(*conds).order_by(I.phase_id, I.sort_order).limit(200)
    )).all()
    names = {p.id: p.name for p in phases}
    return {
        "phases": [jsonable({"id": p.id, "name": p.name, "goal": p.goal, "from": p.start_month, "to": p.end_month})
                   for p in phases],
        "items": [jsonable({
            "id": r.Item.id, "phase": names.get(r.Item.phase_id), "title": r.Item.title, "area": r.Item.area,
            "status": r.Item.status, "priority": r.Item.priority, "targetDate": r.Item.target_date,
            "doneOn": r.Item.done_on, "owner": " ".join(p for p in (r.first_name, r.last_name) if p) or r.email,
            "ownerEmail": r.email, "notes": (r.Item.notes or "")[:300] or None,
        }) for r in rows],
        "link": "/roadmap",
    }


# ---------------------------------------------------------------- logins ----
async def superapp_users(ctx: Ctx, args: dict) -> dict[str, Any]:
    rows = (await ctx.db.execute(select(User).order_by(User.email))).scalars().all()
    return {"users": [jsonable({
        "email": u.email, "name": " ".join(p for p in (u.first_name, u.last_name) if p) or None,
        "role": u.role, "status": u.status, "lastLogin": u.last_login_at, "created": u.created_at,
    }) for u in rows][:200], "link": "/team-members"}


CREATED = {"created_from": DATE, "created_to": DATE}

TOOLS: list[Tool] = [
    Tool(
        name="partner_leads", label="Looking up partner leads", capability="partners.view", run=partner_leads,
        description=("Applications from partners.innowi.com (ISOs, agents, resellers who want to sell Innowi). Filter by "
                     "status (new, contacted, qualified, ... or spam), source, assigned_to (an email or 'unassigned'), "
                     "name/company/email words and created dates. group_by for counts by status/source/owner/type/region/month."),
        properties={"search": SEARCH, "status": {"type": "string"}, "source": {"type": "string"},
                    "assigned_to": {"type": "string"}, "include_spam": {"type": "boolean"}, **CREATED,
                    "group_by": {"type": "string", "enum": list(LEAD_GROUPS)}, "limit": LIMIT},
    ),
    Tool(
        name="partner_lead_detail", label="Opening a partner lead", capability="partners.view", run=partner_lead_detail,
        description="One partner lead with everything they wrote, the team's notes and its history. lead_id from partner_leads.",
        properties={"lead_id": {"type": "string"}}, required=("lead_id",),
    ),
    Tool(
        name="partner_team", label="Checking the partner team", capability="partners.view", run=partner_team,
        description=("The partner team, built from Super App people: everyone signed up (status active) or invited "
                     "(status invited) with a role that works leads (admins, sales managers, sales executives), with "
                     "assignable (can be given leads) and receives_new_leads (gets the new-lead e-mails). Rows with status "
                     "no_login / inactive / other_role are past owners kept for their name; they can't be given leads "
                     "until an admin invites them or gives them a sales role on Team members."),
        properties={},
    ),
    Tool(
        name="partner_contacts", label="Looking up partner network contacts", capability="partners.view", run=partner_contacts,
        description=("Partner Network: people met at events or scanned from business cards, before they become leads. "
                     "Filter by status, event (met_at), source, promoted (became a lead), words and created dates. "
                     "group_by for counts."),
        properties={"search": SEARCH, "status": {"type": "string"}, "event": {"type": "string"},
                    "source": {"type": "string"}, "promoted": {"type": "boolean"}, **CREATED,
                    "group_by": {"type": "string", "enum": list(CONTACT_GROUPS)}, "limit": LIMIT},
    ),
    Tool(
        name="quotes", label="Looking up quotes", capability="quotes.view", run=quotes,
        description=("Quote builder. kind='requests' (default): quotes restaurants submitted, with one-time and monthly "
                     "totals and status. kind='links': quote links the team sent (opens, discount, who sent it). Filter "
                     "by restaurant words, status, sent_by (email), created dates; group_by for counts."),
        properties={"kind": {"type": "string", "enum": ["requests", "links"]}, "search": SEARCH,
                    "status": {"type": "string"}, "sent_by": {"type": "string"}, **CREATED,
                    "group_by": {"type": "string", "enum": ["status", "mode", "plan", "sent_by", "month"],
                                 "description": "plan (BUY/LEASE) is for requests only; mode = prices shown or hidden."},
                    "limit": LIMIT},
    ),
    Tool(
        name="price_list", label="Reading the price list", capability="quotes.view", run=price_list,
        description="Innowi's price list: hardware, software and services with monthly, purchase and lease prices.",
        properties={"search": SEARCH, "include_inactive": {"type": "boolean"}},
    ),
    Tool(
        name="merchants", label="Looking up merchants", capability="profile.view", run=merchants,
        description=("Merchants managed in the SuperApp (marketing profiles): health, cuisine, POS, website, account "
                     "manager, onboarding. Filter by words or health (GREEN/YELLOW/RED); group_by for counts."),
        properties={"search": SEARCH, "health": {"type": "string", "enum": ["GREEN", "YELLOW", "RED"]},
                    "group_by": {"type": "string", "enum": list(MERCHANT_GROUPS)}, "limit": LIMIT},
    ),
    Tool(
        name="merchant_detail", label="Opening a merchant", capability="profile.view", run=merchant_detail,
        description="One merchant's full profile: goals, budgets, locations, contacts, subscription. merchant_id or name.",
        properties={"merchant_id": {"type": "string"}, "name": {"type": "string"}},
    ),
    Tool(
        name="websites", label="Looking up websites", capability="website.view", run=websites,
        description="Restaurant websites built in the SuperApp and their status. Filter by words or status; group_by status.",
        properties={"search": SEARCH, "status": {"type": "string"}, "group_by": {"type": "string", "enum": ["status"]},
                    "limit": LIMIT},
    ),
    Tool(
        name="audit_log", label="Reading the audit log", capability="audit.view", run=audit_log,
        description="Who changed what in the SuperApp. Filter by actor email, entity type, action, dates; group_by for counts.",
        properties={"actor": {"type": "string"}, "entity_type": {"type": "string"},
                    "action": {"type": "string", "enum": ["CREATE", "UPDATE", "DELETE"]}, "from": DATE, "to": DATE,
                    "group_by": {"type": "string", "enum": ["actor", "action", "entity_type", "day"]}, "limit": LIMIT},
    ),
    Tool(
        name="roadmap", label="Reading the roadmap", capability="roadmap.view", run=roadmap,
        description="The SuperApp roadmap: phases and items with status (TODO, IN_PROGRESS, BLOCKED, DONE), area, owner and target date. Filter by words, status, area or owner.",
        properties={"search": SEARCH, "status": {"type": "string", "enum": ["TODO", "IN_PROGRESS", "BLOCKED", "DONE"]},
                    "area": {"type": "string", "enum": ["SALES", "MERCHANTS", "MARKETING", "PLATFORM"]},
                    "owner": {"type": "string"}},
    ),
    Tool(
        name="superapp_users", label="Checking SuperApp logins", capability="users.manage", run=superapp_users,
        description="Everyone with a SuperApp login: role, status and last sign-in.", properties={},
    ),
]
