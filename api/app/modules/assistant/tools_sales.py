"""Sales lookups over the Salesforce copy.

Every query here goes through the Sales module's own visibility rules
(SalesScope): a Sales Executive only ever gets their own deals and visits,
and support cases / restaurants on accounts they work with - exactly what
the Sales screens show them. Managers and admins see everyone and may name
a salesperson with `owner`.
"""
from __future__ import annotations

import datetime as dt
from typing import Any, Optional
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import func, or_, select

from app.config import get_settings
from app.models import salesforce as m
from app.modules.salesforce import case_insights as ci
from app.modules.salesforce import service as sales
from app.modules.assistant.tools_base import (
    DATE, LIMIT, SEARCH, Ctx, Tool, ToolError, choice_arg, date_arg, day_end_exclusive, day_start, jsonable,
    limit_arg, number_arg, page, text_arg, bool_arg,
)

OWNER = {
    "type": "string",
    "description": "Salesperson's name (managers and admins only; ignored for a Sales Executive, who only ever sees their own records).",
}
MAX_GROUPS = 60


def _tz() -> ZoneInfo:
    return ZoneInfo(get_settings().SALES_TIMEZONE)


async def _owner(ctx: Ctx, args: dict) -> tuple[Optional[str], Optional[str]]:
    """(Salesforce user id to filter on, note for the model)."""
    name = text_arg(args, "owner", max_len=80)
    scope = await ctx.sales_scope()
    if not name:
        return None, None
    if not scope.see_all:
        return None, "The owner filter was ignored: this person only sees their own records."
    if name.startswith("005") and len(name) in (15, 18):
        return name, None
    rows = (await ctx.db.execute(
        select(m.SfUser.id, m.SfUser.name, m.SfUser.is_active)
        .where(m.SfUser.name.ilike(f"%{name}%"))
        .order_by(m.SfUser.is_active.desc(), m.SfUser.name)
        .limit(8)
    )).all()
    exact = [r for r in rows if r.name.lower() == name.lower()]
    if exact:
        return exact[0].id, None
    if len(rows) == 1:
        return rows[0].id, None
    if not rows:
        raise ToolError(f'No salesperson named "{name}" in Salesforce. Try sales_team to see names.')
    raise ToolError(f'Several people match "{name}": ' + "; ".join(r.name for r in rows) + ". Ask which one.")


async def _scope_note(ctx: Ctx) -> str:
    scope = await ctx.sales_scope()
    if scope.see_all:
        return "Everyone's Salesforce records."
    if scope.sf_user_id:
        return f"Only {scope.sf_user_name or 'this person'}'s own Salesforce records (they are a Sales Executive)."
    return "Nothing: this login isn't linked to a Salesforce user yet, so it sees no Salesforce records."


def _group_rows(rows, *, by_key: bool) -> list[dict[str, Any]]:
    out = [jsonable({"key": r.key if r.key not in (None, "") else "(blank)", "count": r.count,
                     **({"amount": r.amount} if hasattr(r, "amount") else {})}) for r in rows]
    if by_key:
        out.sort(key=lambda g: str(g["key"]))
    return out[:MAX_GROUPS]


# --------------------------------------------------------------- deals ----
DEAL_GROUPS = ("stage", "owner", "close_month", "created_month", "lead_source", "type", "restaurant", "record_type")


async def deals(ctx: Ctx, args: dict) -> dict[str, Any]:
    scope = await ctx.sales_scope()
    owner, note = await _owner(ctx, args)
    tz = _tz()
    now = dt.datetime.now(dt.timezone.utc)
    opp, acct, usr = m.SfOpportunity, m.SfAccount, m.SfUser

    conditions = [scope.owner_clause(opp.owner_id, owner)]
    status = choice_arg(args, "status", ("open", "won", "lost", "closed", "all"), "all")
    if status == "open":
        conditions.append(opp.is_closed.is_(False))
    elif status == "won":
        conditions.append(opp.is_won.is_(True))
    elif status == "lost":
        conditions += [opp.is_closed.is_(True), opp.is_won.is_(False)]
    elif status == "closed":
        conditions.append(opp.is_closed.is_(True))
    freshness = choice_arg(args, "freshness", ("any", "not_stale", "active", "stuck", "stale"), "any")
    if freshness == "not_stale":
        conditions.append(sales._not_stale(now))
    elif freshness == "active":
        conditions.append(or_(opp.is_closed.is_(True), opp.sf_last_modified_at >= now - sales.STUCK_AFTER))
    elif freshness == "stuck":
        conditions += [opp.is_closed.is_(False), opp.sf_last_modified_at < now - sales.STUCK_AFTER,
                       opp.sf_last_modified_at >= sales._stale_cutoff(now)]
    elif freshness == "stale":
        conditions += [opp.is_closed.is_(False), opp.sf_last_modified_at < sales._stale_cutoff(now)]
    if (stage := text_arg(args, "stage", max_len=80)):
        conditions.append(func.lower(opp.stage_name) == stage.lower())
    if (source := text_arg(args, "lead_source", max_len=80)):
        conditions.append(func.lower(opp.lead_source) == source.lower())
    if (kind := text_arg(args, "type", max_len=80)):
        conditions.append(func.lower(opp.type) == kind.lower())
    if (search := text_arg(args, "search")):
        like = f"%{search}%"
        conditions.append(or_(opp.name.ilike(like), acct.name.ilike(like)))
    if (d := date_arg(args, "closed_from")):
        conditions.append(opp.close_date >= d)
    if (d := date_arg(args, "closed_to")):
        conditions.append(opp.close_date <= d)
    if (d := date_arg(args, "created_from")):
        conditions.append(opp.sf_created_at >= day_start(d, tz))
    if (d := date_arg(args, "created_to")):
        conditions.append(opp.sf_created_at < day_end_exclusive(d, tz))
    if (n := number_arg(args, "min_amount")) is not None:
        conditions.append(opp.amount >= n)
    if (n := number_arg(args, "max_amount")) is not None:
        conditions.append(opp.amount <= n)

    def base(*cols):
        return sales._where(
            select(*cols).select_from(opp)
            .outerjoin(acct, acct.id == opp.account_id)
            .outerjoin(usr, usr.id == opp.owner_id),
            *conditions,
        )

    totals = (await ctx.db.execute(base(func.count().label("n"), func.coalesce(func.sum(opp.amount), 0).label("amt"),
                                        func.count().filter(opp.is_won.is_(True)).label("won"),
                                        func.count().filter(opp.is_closed.is_(True)).label("closed")))).one()
    result: dict[str, Any] = {
        "visibility": await _scope_note(ctx),
        "totals": jsonable({"deals": totals.n, "amount": totals.amt, "won": totals.won, "closed": totals.closed}),
    }
    if note:
        result["note"] = note

    group_by = choice_arg(args, "group_by", DEAL_GROUPS)
    if group_by:
        key = {
            "stage": opp.stage_name,
            "owner": func.coalesce(usr.name, "(no owner)"),
            "close_month": func.to_char(opp.close_date, "YYYY-MM"),
            "created_month": func.to_char(func.timezone(tz.key, opp.sf_created_at), "YYYY-MM"),
            "lead_source": opp.lead_source,
            "type": opp.type,
            "restaurant": acct.name,
            "record_type": opp.record_type_name,
        }[group_by]
        by_key = group_by.endswith("_month")
        stmt = base(key.label("key"), func.count().label("count"),
                    func.coalesce(func.sum(opp.amount), 0).label("amount")).group_by(key)
        stmt = stmt.order_by(key) if by_key else stmt.order_by(func.count().desc(), key)
        rows = (await ctx.db.execute(stmt.limit(MAX_GROUPS))).all()
        result["group_by"] = group_by
        result["groups"] = _group_rows(rows, by_key=by_key)
        return result

    limit = limit_arg(args)
    sort = choice_arg(args, "sort", ("recent", "amount", "close_date", "oldest_change"), "recent")
    order = {
        "recent": (opp.sf_last_modified_at.desc().nullslast(),),
        "amount": (opp.amount.desc().nullslast(),),
        "close_date": (opp.close_date.desc().nullslast(),),
        "oldest_change": (opp.sf_last_modified_at.asc().nullsfirst(),),
    }[sort]
    rows = (await ctx.db.execute(
        base(opp, acct.name.label("account_name"), usr.name.label("owner_name")).order_by(*order, opp.id).limit(limit)
    )).all()
    out = []
    for r in rows:
        o: m.SfOpportunity = r.SfOpportunity
        changed = o.sf_last_modified_at
        out.append(jsonable({
            "id": o.id, "name": o.name, "restaurant": r.account_name, "owner": r.owner_name,
            "stage": o.stage_name, "status": "won" if o.is_won else "lost" if o.is_closed else "open",
            "amount": o.amount, "closeDate": o.close_date,
            "created": o.sf_created_at.astimezone(tz).date() if o.sf_created_at else None,
            "lastChange": changed.astimezone(tz).date() if changed else None,
            "daysSinceChange": (now - changed).days if changed else None,
            "leadSource": o.lead_source, "link": f"/sales/deals/{o.id}",
            "restaurantLink": f"/sales/customers/{o.account_id}" if o.account_id else None,
        }))
    result.update(page(out, totals.n, limit))
    return result


# -------------------------------------------------------------- visits ----
VISIT_GROUPS = ("status", "type", "owner", "due_month", "completed_month", "restaurant")


async def visits(ctx: Ctx, args: dict) -> dict[str, Any]:
    scope = await ctx.sales_scope()
    owner, note = await _owner(ctx, args)
    today = sales.sales_today()
    v, acct, usr = m.SfVisit, m.SfAccount, m.SfUser
    conditions = [scope.owner_clause(v.owner_id, owner)]
    status = choice_arg(args, "status", ("open", "done", "all"), "all")
    if status == "open":
        conditions.append(sales._visit_open())
    elif status == "done":
        conditions.append(v.status.in_(sales.DONE_VISIT_STATUSES))
    when = choice_arg(args, "when", ("today", "overdue", "week", "next7", "upcoming", "any"), "any")
    if when != "any":
        conditions.append(sales._visit_when(when, today))
        if when == "overdue":
            conditions.append(sales._visit_open())
    if (kind := text_arg(args, "visit_type", max_len=80)):
        conditions.append(func.lower(v.visit_type) == kind.lower())
    if (search := text_arg(args, "search")):
        like = f"%{search}%"
        conditions.append(or_(v.account_name.ilike(like), acct.name.ilike(like), v.name.ilike(like), v.address.ilike(like)))
    if (d := date_arg(args, "due_from")):
        conditions.append(v.due_date_start >= d)
    if (d := date_arg(args, "due_to")):
        conditions.append(v.due_date_start <= d)
    if (d := date_arg(args, "completed_from")):
        conditions.append(v.completed_date >= d)
    if (d := date_arg(args, "completed_to")):
        conditions.append(v.completed_date <= d)

    def base(*cols):
        return sales._where(
            select(*cols).select_from(v).outerjoin(acct, acct.id == v.account_id).outerjoin(usr, usr.id == v.owner_id),
            *conditions,
        )

    total = (await ctx.db.execute(base(func.count()))).scalar_one()
    result: dict[str, Any] = {"visibility": await _scope_note(ctx), "today": today.isoformat(), "totals": {"visits": total}}
    if note:
        result["note"] = note
    group_by = choice_arg(args, "group_by", VISIT_GROUPS)
    if group_by:
        key = {
            "status": v.status,
            "type": v.visit_type,
            "owner": func.coalesce(usr.name, "(no owner)"),
            "due_month": func.to_char(v.due_date_start, "YYYY-MM"),
            "completed_month": func.to_char(v.completed_date, "YYYY-MM"),
            "restaurant": func.coalesce(acct.name, v.account_name),
        }[group_by]
        by_key = group_by.endswith("_month")
        stmt = base(key.label("key"), func.count().label("count")).group_by(key)
        stmt = stmt.order_by(key) if by_key else stmt.order_by(func.count().desc(), key)
        rows = (await ctx.db.execute(stmt.limit(MAX_GROUPS))).all()
        result["group_by"] = group_by
        result["groups"] = _group_rows(rows, by_key=by_key)
        return result

    limit = limit_arg(args)
    sort = choice_arg(args, "sort", ("due_soonest", "due_latest", "completed_latest"), "due_soonest")
    order = {
        "due_soonest": (v.due_date_start.asc().nullslast(),),
        "due_latest": (v.due_date_start.desc().nullslast(),),
        "completed_latest": (v.completed_date.desc().nullslast(),),
    }[sort]
    rows = (await ctx.db.execute(
        base(v, acct.name.label("acct_name"), usr.name.label("owner_name")).order_by(*order, v.id).limit(limit)
    )).all()
    out = [jsonable({
        "id": r.SfVisit.id, "restaurant": r.acct_name or r.SfVisit.account_name or r.SfVisit.name,
        "type": r.SfVisit.visit_type, "status": r.SfVisit.status, "assignedTo": r.owner_name,
        "due": r.SfVisit.due_date_start, "dueEnd": r.SfVisit.due_date_end, "time": r.SfVisit.appointment_time,
        "completed": r.SfVisit.completed_date, "address": r.SfVisit.address,
        "restaurantLink": f"/sales/customers/{r.SfVisit.account_id}" if r.SfVisit.account_id else None,
    }) for r in rows]
    result.update(page(out, total, limit))
    return result


# --------------------------------------------------------------- cases ----
DEPARTMENT_NOTE = ("Department is the team recorded on the case (Case Assigned To) when set - only a few percent "
                   "are - otherwise estimated from the issue category; Unclassified = no category or 'Other'. "
                   "Say that departments are mostly estimated.")

CASE_GROUPS = ("status", "priority", "origin", "handled_by", "opened_month", "restaurant", "department",
               "issue_category", "department_source")


async def cases(ctx: Ctx, args: dict) -> dict[str, Any]:
    scope = await ctx.sales_scope()
    owner, note = await _owner(ctx, args)
    tz = _tz()
    c, acct, usr = m.SfCase, m.SfAccount, m.SfUser
    conditions = [sales._account_condition(c.account_id, scope, owner)]
    status = choice_arg(args, "status", ("open", "closed", "all"), "all")
    if status == "open":
        conditions.append(c.is_closed.is_(False))
    elif status == "closed":
        conditions.append(c.is_closed.is_(True))
    if (p := text_arg(args, "priority", max_len=40)):
        conditions.append(func.lower(c.priority) == p.lower())
    if (search := text_arg(args, "search")):
        # Same matching as the Case analysis screen (subject, number, details, restaurant).
        conditions.extend(ci.conditions(ci.CaseFilters(search=search), tz.key))
    if (d := date_arg(args, "opened_from")):
        conditions.append(c.sf_created_at >= day_start(d, tz))
    if (d := date_arg(args, "opened_to")):
        conditions.append(c.sf_created_at < day_end_exclusive(d, tz))
    if (dep := text_arg(args, "department", max_len=60)):
        conditions.append(func.lower(ci.department_expr()) == dep.lower())
    if (cat := text_arg(args, "issue_category", max_len=60)):
        conditions.append(func.lower(ci.category_expr()) == cat.lower())

    def base(*cols):
        return sales._where(
            select(*cols).select_from(c).outerjoin(acct, acct.id == c.account_id).outerjoin(usr, usr.id == c.owner_id),
            *conditions,
        )

    total = (await ctx.db.execute(base(func.count()))).scalar_one()
    result: dict[str, Any] = {"visibility": await _scope_note(ctx), "totals": {"cases": total}}
    scope_obj = await ctx.sales_scope()
    if not scope_obj.see_all:
        result["visibility"] += " Cases: all support cases on the restaurants they work with."
    if note:
        result["note"] = note
    group_by = choice_arg(args, "group_by", CASE_GROUPS)
    if group_by:
        key = {
            "status": c.status,
            "priority": c.priority,
            "origin": c.origin,
            "handled_by": ci.handler_label(),
            "opened_month": func.to_char(func.timezone(tz.key, c.sf_created_at), "YYYY-MM"),
            "restaurant": acct.name,
            "department": ci.department_expr(),
            "issue_category": ci.category_expr(),
            "department_source": ci.source_expr(),
        }[group_by]
        by_key = group_by.endswith("_month")
        stmt = base(key.label("key"), func.count().label("count")).group_by(key)
        stmt = stmt.order_by(key) if by_key else stmt.order_by(func.count().desc(), key)
        rows = (await ctx.db.execute(stmt.limit(MAX_GROUPS))).all()
        result["group_by"] = group_by
        result["groups"] = _group_rows(rows, by_key=by_key)
        if group_by in ("department", "issue_category", "department_source"):
            result["department_note"] = DEPARTMENT_NOTE
            result["link"] = "/sales/cases/insights"
        return result

    limit = limit_arg(args)
    rows = (await ctx.db.execute(
        base(c, acct.name.label("acct_name"), usr.name.label("owner_name"))
        .order_by(c.sf_created_at.desc().nullslast(), c.id).limit(limit)
    )).all()
    out = [jsonable({
        "caseNumber": r.SfCase.case_number, "subject": r.SfCase.subject, "status": r.SfCase.status,
        "priority": r.SfCase.priority, "origin": r.SfCase.origin, "restaurant": r.acct_name, "handledBy": r.owner_name,
        "issueCategory": r.SfCase.issue_category,
        "details": (r.SfCase.details or "")[:300] or None,
        "opened": r.SfCase.sf_created_at.astimezone(tz).date() if r.SfCase.sf_created_at else None,
        "closed": r.SfCase.sf_closed_at.astimezone(tz).date() if r.SfCase.sf_closed_at else None,
        "restaurantLink": f"/sales/customers/{r.SfCase.account_id}" if r.SfCase.account_id else None,
    }) for r in rows]
    result.update(page(out, total, limit))
    return result


# --------------------------------------------------------- restaurants ----
RESTAURANT_GROUPS = ("health", "city", "state", "owner")


async def restaurants(ctx: Ctx, args: dict) -> dict[str, Any]:
    scope = await ctx.sales_scope()
    owner, note = await _owner(ctx, args)
    cols = sales._customer_columns(scope, owner)
    base = sales._customer_select(scope, owner, cols)
    if (search := text_arg(args, "search")):
        base = base.where(m.SfAccount.name.ilike(f"%{search}%"))
    if (city := text_arg(args, "city", max_len=80)):
        base = base.where(func.lower(m.SfAccount.billing_city) == city.lower())
    if (state := text_arg(args, "state", max_len=40)):
        base = base.where(func.lower(m.SfAccount.billing_state) == state.lower())
    if (health := text_arg(args, "health", max_len=40)):
        base = base.where(func.lower(cols.health) == health.lower())
    if bool_arg(args, "only_customers"):
        base = base.where(cols.won_deals > 0)
    sub = base.subquery()
    total = (await ctx.db.execute(select(func.count()).select_from(sub))).scalar_one()
    result: dict[str, Any] = {"visibility": await _scope_note(ctx), "totals": {"restaurants": total}}
    if note:
        result["note"] = note
    group_by = choice_arg(args, "group_by", RESTAURANT_GROUPS)
    if group_by:
        key = {"health": sub.c.health, "city": sub.c.billing_city, "state": sub.c.billing_state,
               "owner": sub.c.owner_name}[group_by]
        rows = (await ctx.db.execute(
            select(key.label("key"), func.count().label("count")).select_from(sub)
            .group_by(key).order_by(func.count().desc(), key).limit(MAX_GROUPS)
        )).all()
        result["group_by"] = group_by
        result["groups"] = _group_rows(rows, by_key=False)
        return result
    limit = limit_arg(args)
    rows = (await ctx.db.execute(base.order_by(m.SfAccount.name, m.SfAccount.id).limit(limit))).all()
    out = []
    for r in rows:
        a: m.SfAccount = r.SfAccount
        out.append(jsonable({
            "id": a.id, "name": a.name, "city": a.billing_city, "state": a.billing_state, "phone": a.phone,
            "accountOwner": r.owner_name, "health": r.health, "lastCheckIn": r.last_touchpoint,
            "openDeals": r.open_deals, "wonDeals": r.won_deals, "openCases": r.open_cases,
            "link": f"/sales/customers/{a.id}",
        }))
    result.update(page(out, total, limit))
    return result


def _cap(items: list, n: int = 15) -> list:
    return items[:n]


async def restaurant_detail(ctx: Ctx, args: dict) -> dict[str, Any]:
    scope = await ctx.sales_scope()
    account_id = text_arg(args, "restaurant_id", max_len=18)
    name = text_arg(args, "name")
    if not account_id and name:
        row = (await ctx.db.execute(
            sales._customer_select(scope).where(m.SfAccount.name.ilike(f"%{name}%"))
            .order_by(func.length(m.SfAccount.name), m.SfAccount.name).limit(5)
        )).all()
        if not row:
            raise ToolError(f'No restaurant matching "{name}" that this person can see.')
        if len(row) > 1 and row[0].SfAccount.name.lower() != name.lower():
            return {"matches": [{"id": r.SfAccount.id, "name": r.SfAccount.name, "city": r.SfAccount.billing_city}
                                for r in row], "note": "Several restaurants match; pick one by id."}
        account_id = row[0].SfAccount.id
    if not account_id:
        raise ToolError("Give restaurant_id or name.")
    try:
        detail = await sales.get_customer(ctx.db, scope, account_id)
    except HTTPException:
        raise ToolError("That restaurant isn't in the Salesforce copy or this person can't see it.")
    data = jsonable(detail)
    for key in ("contacts", "deals", "visits", "cases", "touchpoints"):
        items = data.get(key) or []
        data[key] = _cap(items)
        if len(items) > 15:
            data[f"{key}Total"] = len(items)
    data["link"] = f"/sales/customers/{account_id}"
    data["visibility"] = await _scope_note(ctx)
    return data


async def deal_detail(ctx: Ctx, args: dict) -> dict[str, Any]:
    scope = await ctx.sales_scope()
    deal_id = text_arg(args, "deal_id", max_len=18)
    if not deal_id:
        raise ToolError("deal_id is required (from an earlier sales_deals lookup).")
    try:
        detail = await sales.get_deal(ctx.db, scope, deal_id)
    except HTTPException:
        raise ToolError("That deal isn't in the Salesforce copy or this person can't see it.")
    data = jsonable(detail)
    customer = data.get("customer") or {}
    for key in ("contacts", "deals", "visits", "cases", "touchpoints"):
        if key in customer:
            customer[key] = _cap(customer[key], 8)
    data["link"] = f"/sales/deals/{deal_id}"
    return data


async def overview(ctx: Ctx, args: dict) -> dict[str, Any]:
    scope = await ctx.sales_scope()
    owner, note = await _owner(ctx, args)
    summary = jsonable(await sales.summary(ctx.db, scope, owner=owner))
    insights = jsonable(await sales.insights(ctx.db, scope, owner=owner))
    for key in ("stuckDeals", "visitsDue", "openCases"):
        summary[key] = _cap(summary.get(key) or [], 8)
    out = {"visibility": await _scope_note(ctx), "myDay": summary, "insights": insights,
           "definitions": {"stuck": "open deal unchanged 30-180 days", "stale": "open deal unchanged over 180 days",
                           "wonByMonth": "by close date, last 12 months"}}
    if note:
        out["note"] = note
    return out


async def team(ctx: Ctx, args: dict) -> dict[str, Any]:
    rows = jsonable(await sales.team(ctx.db))
    return {"people": rows, "definitions": {"staleDeals": "open, unchanged over 180 days",
                                            "openCases": "open support cases they handle"}}


async def sync_info(ctx: Ctx, args: dict) -> dict[str, Any]:
    last = await sales.last_sync_at(ctx.db)
    return jsonable({"lastCopiedFromSalesforce": last, "timezone": get_settings().SALES_TIMEZONE})


DEAL_PROPS = {
    "status": {"type": "string", "enum": ["open", "won", "lost", "closed", "all"], "description": "Default all."},
    "freshness": {"type": "string", "enum": ["any", "not_stale", "active", "stuck", "stale"],
                  "description": ("Default any. not_stale: leaves out open deals unchanged for over 180 days - this "
                                  "is what the Pipeline and Deals screens show by default, so use it for 'the "
                                  "pipeline'. active: changed in the last 30 days or closed; stuck: open and "
                                  "unchanged 30-180 days; stale: open and unchanged over 180 days.")},
    "stage": {"type": "string", "description": "Exact Salesforce stage name, e.g. 'Closed Won' or 'Proposal'."},
    "lead_source": {"type": "string"},
    "type": {"type": "string", "description": "Opportunity type."},
    "search": {"type": "string", "description": "Words in the deal or restaurant name."},
    "owner": OWNER,
    "closed_from": DATE, "closed_to": DATE,
    "created_from": DATE, "created_to": DATE,
    "min_amount": {"type": "number"}, "max_amount": {"type": "number"},
    "group_by": {"type": "string", "enum": list(DEAL_GROUPS),
                 "description": "Return counts and summed amount per group instead of rows. Months are YYYY-MM."},
    "sort": {"type": "string", "enum": ["recent", "amount", "close_date", "oldest_change"]},
    "limit": LIMIT,
}

TOOLS: list[Tool] = [
    Tool(
        name="sales_overview", label="Reading the sales overview", capability="sales.view", run=overview,
        description=("Headline sales numbers: open/stuck/stale deal counts, visits due today/overdue/next 7 days, open "
                     "cases, pipeline by stage, deals won and created per month for the last 12 months, restaurant "
                     "health mix and (for managers) a leaderboard. Start here for broad 'how are we doing' questions."),
        properties={"owner": OWNER},
    ),
    Tool(
        name="sales_deals", label="Looking up deals", capability="sales.view", run=deals,
        description=("Salesforce opportunities (deals). Filter by status, stage, owner, dates, amount or name. Without "
                     "group_by returns matching rows plus totals (count, summed amount); with group_by returns counts "
                     "and amounts per stage/owner/month etc. Use group_by for any 'how many / how much / by month' question."),
        properties=DEAL_PROPS,
    ),
    Tool(
        name="sales_deal_detail", label="Opening a deal", capability="sales.view", run=deal_detail,
        description="One deal with its restaurant, contacts and recent activity. deal_id comes from sales_deals.",
        properties={"deal_id": {"type": "string"}}, required=("deal_id",),
    ),
    Tool(
        name="sales_visits", label="Looking up visits", capability="sales.view", run=visits,
        description=("Field visits (installs, trainings, check-ins). Filter by status (open/done), when "
                     "(today/overdue/week/next7/upcoming), type, owner, due or completed dates, restaurant. "
                     "group_by gives counts per status/type/owner/month."),
        properties={
            "status": {"type": "string", "enum": ["open", "done", "all"]},
            "when": {"type": "string", "enum": ["today", "overdue", "week", "next7", "upcoming", "any"]},
            "visit_type": {"type": "string"}, "search": SEARCH, "owner": OWNER,
            "due_from": DATE, "due_to": DATE, "completed_from": DATE, "completed_to": DATE,
            "group_by": {"type": "string", "enum": list(VISIT_GROUPS)},
            "sort": {"type": "string", "enum": ["due_soonest", "due_latest", "completed_latest"]},
            "limit": LIMIT,
        },
    ),
    Tool(
        name="sales_cases", label="Looking up support cases", capability="sales.view", run=cases,
        description=("Support cases from Salesforce. Filter by status, priority, opened dates, subject/restaurant "
                     "words, department, issue_category, or the salesperson whose restaurants they are on. group_by "
                     "gives counts; department and issue_category answer 'which teams / what kind of issues'. "
                     "Department is mostly an ESTIMATE from the issue category (say so); department_source shows "
                     "how many are recorded vs estimated."),
        properties={
            "status": {"type": "string", "enum": ["open", "closed", "all"]},
            "priority": {"type": "string"}, "search": SEARCH, "owner": OWNER,
            "opened_from": DATE, "opened_to": DATE,
            "department": {"type": "string"}, "issue_category": {"type": "string"},
            "group_by": {"type": "string", "enum": list(CASE_GROUPS)},
            "limit": LIMIT,
        },
    ),
    Tool(
        name="sales_restaurants", label="Looking up restaurants", capability="sales.view", run=restaurants,
        description=("Restaurants (Salesforce accounts) with health from their latest check-in, open/won deal and open "
                     "case counts. Filter by name, city, state, health, owner, or only paying customers (a won deal). "
                     "group_by health/city/state/owner gives counts."),
        properties={
            "search": SEARCH, "city": {"type": "string"}, "state": {"type": "string", "description": "e.g. CA"},
            "health": {"type": "string", "description": "Health from the latest check-in, e.g. Green / Yellow / Red."},
            "only_customers": {"type": "boolean"}, "owner": OWNER,
            "group_by": {"type": "string", "enum": list(RESTAURANT_GROUPS)}, "limit": LIMIT,
        },
    ),
    Tool(
        name="sales_restaurant_detail", label="Opening a restaurant", capability="sales.view", run=restaurant_detail,
        description="Everything about one restaurant: contacts, deals, visits, cases and check-ins. Pass restaurant_id or a name.",
        properties={"restaurant_id": {"type": "string"}, "name": {"type": "string"}},
    ),
    Tool(
        name="sales_team", label="Comparing the sales team", capability="sales.viewAll", run=team,
        description="Every salesperson with their open, stale, won and new deals, visits to do and done, cases and last login.",
        properties={},
    ),
    Tool(
        name="sales_data_freshness", label="Checking when Salesforce was last copied", capability="sales.view",
        run=sync_info, description="When the Salesforce data was last copied into the SuperApp.", properties={},
    ),
]

