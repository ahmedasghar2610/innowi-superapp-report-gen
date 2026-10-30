"""The partner ladder: stages, where a partner came from, and assigning partners
(or an ISO's agents) to the sales team.

Decisions (Shayan / Emma, 2026-10-27):
* Stages: New, then the onboarding steps Vaseem's team tracks (Demo scheduled ->
  ... -> IU enrollment -> Certified), or Not interested. Whether a partner is
  *active* is not a stage: it is worked out from deals (>= 1 in the last 30 days).
* Came from: Elavon, BMO, Direct, Conference, or Inbound (partner site, support,
  generic), plus who or what (the introducer, the conference).
* Agents under an ISO are organizations of their own (kind PARTNER_AGENT,
  parent = the ISO), so each has a stage, an owner and deals credited to it.
* A sales lead hands out many partners at once: pick the people and how many
  each gets (or split evenly); agents in the same state or city stay together
  where the numbers allow, and the split can even out what people already own.
  ``plan_assignment`` is pure so it can be previewed and unit tested.
"""
from __future__ import annotations

import datetime as dt
from collections import OrderedDict
from dataclasses import dataclass, field
from typing import Iterable, Literal, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.deals import Organization, OrganizationEvent

PARTNER_STAGES: "OrderedDict[str, str]" = OrderedDict([
    ("NEW", "New"),
    ("DEMO_SCHEDULED", "Demo scheduled"),
    ("DEMO_HELD", "Demo held"),
    ("NDA_SENT", "NDA sent"),
    ("NDA_SIGNED", "NDA signed"),
    ("AGREEMENT_SENT", "Agreement sent"),
    ("AGREEMENT_SIGNED", "Agreement signed"),
    ("COLLATERAL_SENT", "Collateral sent"),
    ("IU_ENROLLED", "IU enrollment"),
    ("CERTIFIED", "Certified"),
    ("NOT_INTERESTED", "Not interested"),
])
STAGE_KEYS = tuple(PARTNER_STAGES)
# The journey in order; NOT_INTERESTED sits outside it.
STAGE_ORDER = STAGE_KEYS[:-1]

CAME_FROM: "OrderedDict[str, str]" = OrderedDict([
    ("ELAVON", "Elavon"),
    ("BMO", "BMO"),
    ("DIRECT", "Direct"),
    ("CONFERENCE", "Conference"),
    ("INBOUND_PARTNER", "Inbound · Partner"),
    ("INBOUND_SUPPORT", "Inbound · Support"),
    ("INBOUND_GENERIC", "Inbound · Generic"),
])

StageKey = Literal["NEW", "DEMO_SCHEDULED", "DEMO_HELD", "NDA_SENT", "NDA_SIGNED", "AGREEMENT_SENT",
                   "AGREEMENT_SIGNED", "COLLATERAL_SENT", "IU_ENROLLED", "CERTIFIED", "NOT_INTERESTED"]
CameFromKey = Literal["ELAVON", "BMO", "DIRECT", "CONFERENCE", "INBOUND_PARTNER", "INBOUND_SUPPORT", "INBOUND_GENERIC"]

# "Selling" = at least one deal in this many days (Shayan's definition of an active partner).
SELLING_WINDOW_DAYS = 30


def utcnow() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def stage_rank(stage: str) -> int:
    return STAGE_ORDER.index(stage) if stage in STAGE_ORDER else -1


def record(db: AsyncSession, org_id: str, kind: str, *, user_id: Optional[str] = None,
           from_value: Optional[str] = None, to_value: Optional[str] = None, body: Optional[str] = None) -> None:
    db.add(OrganizationEvent(organization_id=org_id, kind=kind, user_id=user_id, from_value=from_value,
                             to_value=to_value, body=body))


def set_stage(db: AsyncSession, o: Organization, stage: str, *, user_id: Optional[str]) -> bool:
    """Move the organization to `stage`; keeps Certified / IU enrollment in step. True if it changed."""
    if stage == o.stage:
        return False
    now = utcnow()
    record(db, o.id, "STAGE_CHANGED", user_id=user_id, from_value=o.stage, to_value=stage)
    o.stage, o.stage_changed_at = stage, now
    if stage_rank(stage) >= stage_rank("IU_ENROLLED") and o.iu_enrolled_at is None:
        o.iu_enrolled_at = now
    if stage == "CERTIFIED" and not o.certified:
        o.certified, o.certified_at = True, now
    return True


def set_owner(db: AsyncSession, o: Organization, owner_id: Optional[str], *, user_id: Optional[str],
              owner_name: Optional[str] = None, previous_name: Optional[str] = None, body: Optional[str] = None) -> bool:
    if owner_id == o.owner_id:
        return False
    record(db, o.id, "OWNER_CHANGED", user_id=user_id, from_value=previous_name, to_value=owner_name, body=body)
    o.owner_id = owner_id
    o.assigned_at = utcnow() if owner_id else None
    return True


# ============================================================ assignment ====
@dataclass(frozen=True)
class AssignItem:
    id: str
    name: str
    # Territory used to keep agents together ("CA", "san diego, ca"); "" when unknown.
    group: str = ""


@dataclass
class PersonPlan:
    user_id: str
    target: int
    existing: int = 0
    item_ids: list[str] = field(default_factory=list)
    groups: "OrderedDict[str, int]" = field(default_factory=OrderedDict)

    @property
    def remaining(self) -> int:
        return self.target - len(self.item_ids)


class AssignmentError(ValueError):
    """The split asked for can't be done (more than there are, nobody picked…)."""


def split_targets(n: int, people: list[str], counts: Optional[dict[str, int]] = None,
                  existing: Optional[dict[str, int]] = None, balance_load: bool = False) -> dict[str, int]:
    """How many each person gets.

    * counts given: exactly those (their sum may be below n; the rest stay unassigned).
    * otherwise split n evenly; with ``balance_load`` the split first tops up the
      people who own the least, so everyone ends as even as the numbers allow.
    """
    if not people:
        raise AssignmentError("Pick at least one person.")
    if len(set(people)) != len(people):
        raise AssignmentError("Each person can be picked once.")
    if counts is not None:
        if any(counts.get(p, 0) < 0 for p in people):
            raise AssignmentError("Counts can't be negative.")
        total = sum(counts.get(p, 0) for p in people)
        if total > n:
            raise AssignmentError(f"The counts add up to {total}, but there are only {n} to hand out.")
        return {p: counts.get(p, 0) for p in people}
    existing = existing or {}
    targets = {p: 0 for p in people}
    if balance_load:
        # Water-filling: one at a time to whoever has the fewest in total; ties go in pick order.
        for _ in range(n):
            p = min(people, key=lambda x: (existing.get(x, 0) + targets[x], people.index(x)))
            targets[p] += 1
        return targets
    base, extra = divmod(n, len(people))
    for i, p in enumerate(people):
        targets[p] = base + (1 if i < extra else 0)
    return targets


def plan_assignment(items: Iterable[AssignItem], targets: dict[str, int], *, keep_together: bool = True,
                    existing: Optional[dict[str, int]] = None) -> list[PersonPlan]:
    """Hand `items` out so each person gets their target.

    With ``keep_together`` items are grouped by territory and whole groups go to
    one person where they fit (largest groups first, each to the person with the
    least room that still fits it); a group bigger than anyone's room is split
    across whoever has the most room left.
    Items without a territory fill whatever room is left. Deterministic: same
    input, same plan."""
    existing = existing or {}
    plans = [PersonPlan(user_id=p, target=t, existing=existing.get(p, 0)) for p, t in targets.items()]
    pool = sorted(items, key=lambda i: (i.group == "", i.group, i.name.lower(), i.id))
    if keep_together:
        groups: "OrderedDict[str, list[AssignItem]]" = OrderedDict()
        loose: list[AssignItem] = []
        for it in pool:
            (groups.setdefault(it.group, []) if it.group else loose).append(it)
        ordered = sorted(groups.items(), key=lambda kv: (-len(kv[1]), kv[0]))

        def give(pl: PersonPlan, key: str, members: list[AssignItem]) -> None:
            for it in members:
                pl.item_ids.append(it.id)
            pl.groups[key] = pl.groups.get(key, 0) + len(members)

        # 1. Whole groups first, biggest first, each to the person with the least room that still fits it
        #    (keeps big rooms free for big groups).
        too_big: list[tuple[str, list[AssignItem]]] = []
        for key, members in ordered:
            fits = [pl for pl in plans if pl.remaining >= len(members)]
            if fits:
                give(min(fits, key=lambda x: (x.remaining, plans.index(x))), key, list(members))
            else:
                too_big.append((key, list(members)))
        # 2. Groups nobody can take whole: split them across whoever has the most room.
        for key, members in too_big:
            while members:
                open_plans = [pl for pl in plans if pl.remaining > 0]
                if not open_plans:
                    break
                pl = max(open_plans, key=lambda x: (x.remaining, -plans.index(x)))
                take, members = members[:pl.remaining], members[pl.remaining:]
                give(pl, key, take)
        pool = loose
    for it in pool:
        open_plans = [pl for pl in plans if pl.remaining > 0]
        if not open_plans:
            break
        pl = max(open_plans, key=lambda x: (x.remaining, -plans.index(x)))
        pl.item_ids.append(it.id)
        key = it.group or "No location"
        pl.groups[key] = pl.groups.get(key, 0) + 1
    return plans


def territory(o: Organization, by: str) -> str:
    """The grouping key for keep-together: state ("CA") or city + state."""
    state = (o.state or "").strip().upper()
    if by == "city":
        city = (o.city or "").strip().lower()
        return f"{city.title()}, {state}".strip(", ") if city or state else ""
    if by == "state":
        return state
    return ""
