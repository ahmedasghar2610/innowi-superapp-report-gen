"""Add the Ops team as Super App users, plus demo tickets to test with.

    python -m scripts.seed_team                      # people + demo tickets
    python -m scripts.seed_team --password 'S0me-Pass!'
    python -m scripts.seed_team --domain innowi.com  # if your work emails use another domain
    python -m scripts.seed_team --no-tickets         # people only
    python -m scripts.seed_team --remove-demo        # delete the demo tickets again
    python -m scripts.seed_team --dry-run            # show what would change

People are matched by **email**, so running it again never makes duplicates.
Only Aima and Maheen get "Create & manage tickets" (`ticket.manage`); the
script also takes it away from anyone else who has it, so that rule holds.
(Super Admin accounts can always create tickets — that comes with the role.)

Ready for Microsoft Teams
-------------------------
Email is the link to Microsoft 365: once Teams sign-in / user sync is added,
it will look people up by their Microsoft 365 email (Graph `mail` /
`userPrincipalName`) and find these same rows — their tickets, roles and
access stay as they are. So put each person's **real work email** in TEAM
below (or pass --domain). The sync can reuse `upsert_people()` as-is: build
`Person` rows from Graph users and call it with `keep_access=True`.

New people get the password from --password (printed at the end); they can
change it in Settings → Profile. Existing people keep their password unless
you pass --reset-passwords.
"""
from __future__ import annotations

import argparse
import asyncio
import datetime as dt
from dataclasses import dataclass, field
from typing import Optional

from sqlalchemy import delete, select

from app.common.security.password import hash_password
from app.db.session import SessionLocal
from app.models.auth import User
from app.models.enums import (
    Role,
    TicketEventKind,
    TicketPriority,
    TicketRequestType,
    TicketStatus,
    TicketType,
    UserStatus,
)
from app.models.ops import Project, Ticket, TicketComment, TicketEvent, TicketSubtask
from app.models.profiling import Merchant
from app.modules.ops import sla

DEFAULT_DOMAIN = "myinnowi.com"
TICKET_CREATORS = {"aima", "maheen"}  # keys in TEAM below
DEMO_MARK = "_Demo ticket — added by scripts/seed_team.py._"


@dataclass
class Person:
    key: str  # short name used in this file
    first_name: str
    last_name: Optional[str]
    email_user: str  # the part before @; the domain comes from --domain
    role: Role
    grants: list[str] = field(default_factory=list)
    email: Optional[str] = None  # full address; overrides email_user + domain


# One place to edit. Set `email=` to a full address if someone's differs.
TEAM: list[Person] = [
    Person("ali", "Muhammad", "Ali", "muhammad.ali", Role.ADMIN),
    Person("aima", "Aima", None, "aima", Role.MARKETING_MANAGER, ["ticket.manage"]),
    Person("maheen", "Maheen", None, "maheen", Role.MARKETING_MANAGER, ["ticket.manage"]),
    Person("arbab", "Arbab", None, "arbab", Role.MARKETING_EXECUTIVE),
    Person("mobeen", "Mobeen", None, "mobeen", Role.MARKETING_EXECUTIVE),
    Person("rashid", "Rashid", None, "rashid", Role.MARKETING_EXECUTIVE),
]


def email_of(p: Person, domain: str) -> str:
    return (p.email or f"{p.email_user}@{domain}").strip().lower()


async def upsert_people(
    db,
    people: list[Person],
    *,
    domain: str,
    password: str,
    reset_passwords: bool = False,
    keep_access: bool = False,
    dry_run: bool = False,
) -> dict[str, User]:
    """Create or update users by email. With keep_access=True (what a Teams
    sync would use) existing people keep their role and grants and only their
    name is refreshed."""
    out: dict[str, User] = {}
    pw_hash = hash_password(password)
    for p in people:
        email = email_of(p, domain)
        u = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
        if u is None:
            u = User(
                email=email,
                password_hash=pw_hash,
                first_name=p.first_name,
                last_name=p.last_name,
                role=p.role,
                granted_capabilities=sorted(p.grants),
                password_changed_at=dt.datetime.now(dt.timezone.utc),
            )
            print(f"  add   {(p.first_name + ' ' + (p.last_name or '')).strip()} <{email}> · {p.role.value}{' · can create tickets' if 'ticket.manage' in p.grants else ''}")
            if not dry_run:
                db.add(u)
                await db.flush()
        else:
            changes = []
            if (u.first_name, u.last_name) != (p.first_name, p.last_name):
                u.first_name, u.last_name = p.first_name, p.last_name
                changes.append("name")
            if not keep_access:
                if u.role != p.role and u.role != Role.SUPER_ADMIN:
                    u.role = p.role
                    changes.append(f"role → {p.role.value}")
                if sorted(u.granted_capabilities or []) != sorted(p.grants):
                    u.granted_capabilities = sorted(p.grants)
                    changes.append(f"access → {', '.join(p.grants) or 'role only'}")
                if u.status != UserStatus.ACTIVE:
                    u.status = UserStatus.ACTIVE
                    changes.append("active")
            if reset_passwords:
                u.password_hash = pw_hash
                u.password_changed_at = dt.datetime.now(dt.timezone.utc)
                changes.append("password reset")
            print(f"  {'update' if changes else 'keep '} {email}{' · ' + ', '.join(changes) if changes else ''}")
        out[p.key] = u
    return out


async def only_creators_can_create(db, keep: set[str], dry_run: bool) -> None:
    """Take ticket.manage away from everyone not in `keep` (user ids)."""
    rows = (await db.execute(select(User).where(User.granted_capabilities.any("ticket.manage")))).scalars().all()
    for u in rows:
        if u.id in keep:
            continue
        print(f"  revoke ticket.manage from {u.email} (only Aima and Maheen create tickets)")
        if not dry_run:
            u.granted_capabilities = [c for c in (u.granted_capabilities or []) if c != "ticket.manage"]


# ------------------------------------------------------------ demo data ----
MERCHANTS = ["Cha2Cha", "Pho Ha Plus Vietnamese Cuisine", "Nizario's Pizza", "Atulya Bharat"]
PROJECTS = ["Merchant requests", "Email & SMS", "SuperApp", "Website relaunch"]

# status flow used to write the history: the ticket walks these steps.
FLOW = [TicketStatus.NEW, TicketStatus.IN_PROGRESS, TicketStatus.IN_REVIEW, TicketStatus.DONE]


@dataclass
class Demo:
    title: str
    type: TicketType
    category: str
    sub: str
    priority: TicketPriority
    status: TicketStatus
    assignee: str
    creator: str
    project: str
    merchant: Optional[str] = None
    days_ago: float = 1.0  # created this long ago
    due_in_days: Optional[int] = None  # relative to today; negative = overdue
    first_response_h: Optional[float] = 1.0  # hours after creation; None = not yet
    done_after_h: Optional[float] = None  # DONE only
    request: TicketRequestType = TicketRequestType.NEW_REQUEST
    description: str = ""
    subtasks: list[tuple[str, bool]] = field(default_factory=list)
    comments: list[tuple[str, str, float]] = field(default_factory=list)  # (who, text, hours after creation)


T, P, S = TicketType, TicketPriority, TicketStatus
DEMOS: list[Demo] = [
    Demo("Checkout 404 on Atulya Bharat ordering page", T.WEBSITE, "Bug / fix", "Forms / ordering", P.URGENT, S.IN_PROGRESS,
         "arbab", "aima", "Merchant requests", "Atulya Bharat", days_ago=4, due_in_days=-1, first_response_h=0.5,
         request=TicketRequestType.ISSUE,
         description="Customers get a 404 after tapping **Checkout**. Started after this morning's menu import.",
         subtasks=[("Reproduce on mobile and desktop", True), ("Fix the order route", False), ("Test a real order with the merchant", False)],
         comments=[("arbab", "Reproduced — the ordering link still points at the old menu slug.", 0.6),
                   ("aima", "Merchant is losing orders, please keep me posted every couple of hours.", 1.5)]),
    Demo("New logo for storefront signage", T.DESIGN, "Logo", "Refresh existing", P.HIGH, S.IN_PROGRESS,
         "mobeen", "aima", "Merchant requests", "Cha2Cha", days_ago=1.5, due_in_days=3, first_response_h=2,
         description="Two colour variants (dark on light, light on dark) for a new storefront sign. Keep the wordmark; refresh the icon.\n\nSign vendor needs vector files by the due date.",
         subtasks=[("Collect current brand files", True), ("Icon explorations (3 directions)", True),
                   ("Merchant picks a direction", False), ("Export vectors for the sign vendor", False)],
         comments=[("mobeen", "Three directions are in Figma. Waiting for the merchant to pick one.", 20)]),
    Demo("SEO alert: ranking drop for \"pho near me\"", T.WEBSITE, "SEO fix", "Ranking drop", P.HIGH, S.NEW,
         "rashid", "maheen", "Merchant requests", "Pho Ha Plus Vietnamese Cuisine", days_ago=0.2, due_in_days=4, first_response_h=None,
         description="Dropped from #3 to #11 this week. Check the GBP category and the menu page title."),
    Demo("Lunch combo offer campaign", T.MARKETING, "Promotion / offer", "Bundle", P.MEDIUM, S.AWAITING_MERCHANT,
         "arbab", "maheen", "Merchant requests", "Nizario's Pizza", days_ago=4, due_in_days=6, first_response_h=3,
         description="Weekday lunch bundle: slice + drink. Need the merchant's price before we build the post and SMS.",
         comments=[("arbab", "Asked the owner for the bundle price — waiting on him.", 26)]),
    Demo("Instagram launch posts (6)", T.MARKETING, "Social media", "Post schedule", P.HIGH, S.IN_REVIEW,
         "mobeen", "aima", "Email & SMS", "Cha2Cha", days_ago=3, due_in_days=1, first_response_h=1,
         subtasks=[("Write captions", True), ("Design 6 posts", True), ("Aima sign-off", False)],
         comments=[("mobeen", "All six are ready for review in the shared folder.", 40)]),
    Demo("Printed menu redesign", T.DESIGN, "Menu", "Printed menu", P.MEDIUM, S.NEW,
         "mobeen", "maheen", "Merchant requests", "Pho Ha Plus Vietnamese Cuisine", days_ago=0.5, due_in_days=9, first_response_h=None),
    Demo("Update holiday hours on the website", T.WEBSITE, "Content update", "Hours / contact", P.LOW, S.DONE,
         "rashid", "aima", "Merchant requests", "Nizario's Pizza", days_ago=6, due_in_days=-3, first_response_h=2, done_after_h=20,
         comments=[("rashid", "Updated on the site and on Google Business Profile.", 20)]),
    Demo("Autumn SMS blast — approve copy", T.INTERNAL, "Process", "Approval", P.URGENT, S.DONE,
         "maheen", "aima", "Email & SMS", None, days_ago=5, due_in_days=-4, first_response_h=0.5, done_after_h=6),
    Demo("Fix mobile menu overlapping the logo", T.WEBSITE, "Bug / fix", "Mobile layout", P.MEDIUM, S.DONE,
         "arbab", "maheen", "Website relaunch", "Cha2Cha", days_ago=16, due_in_days=-8, first_response_h=5, done_after_h=240,
         comments=[("arbab", "Took longer than planned — the theme overrides the header on small screens.", 236)]),
    Demo("Story set for weekend special", T.DESIGN, "Social assets", "Story set", P.LOW, S.IN_PROGRESS,
         "mobeen", "maheen", "Email & SMS", "Atulya Bharat", days_ago=2, due_in_days=5, first_response_h=4),
    Demo("Monthly newsletter — October", T.MARKETING, "Email / SMS", "Newsletter", P.MEDIUM, S.IN_PROGRESS,
         "rashid", "aima", "Email & SMS", "Pho Ha Plus Vietnamese Cuisine", days_ago=3, due_in_days=2, first_response_h=6,
         subtasks=[("Pick 3 dishes to feature", True), ("Draft copy", False), ("Send test email", False)]),
    Demo("Give Rashid access to the GBP dashboards", T.INTERNAL, "Tooling", "Access", P.LOW, S.NEW,
         "ali", "maheen", "SuperApp", None, days_ago=1, first_response_h=None),
    Demo("Connect Microsoft Teams to the Super App", T.INTERNAL, "Tooling", "Integration", P.HIGH, S.IN_PROGRESS,
         "ali", "aima", "SuperApp", None, days_ago=1, due_in_days=7, first_response_h=1,
         description="Needs the Microsoft 365 admin to register the app (tenant ID, client ID, client secret). Unlocks Teams sign-in, assignee emails and presence in Ops Hub.",
         subtasks=[("Send the request to the Microsoft 365 admin", True), ("Add the keys to .env", False), ("Test sign-in with Teams", False)]),
    Demo("Write the ticket routing SOP", T.INTERNAL, "Process", "Documentation", P.MEDIUM, S.IN_REVIEW,
         "aima", "maheen", "SuperApp", None, days_ago=2, due_in_days=1, first_response_h=2,
         comments=[("aima", "Draft is in Library → Processes & SOPs. Maheen, please review.", 30)]),
    Demo("Domain renewal for Nizario's", T.WEBSITE, "Domain / hosting", "Renewal", P.HIGH, S.NEW,
         "arbab", "aima", "Merchant requests", "Nizario's Pizza", days_ago=1.8, due_in_days=0, first_response_h=None,
         description="Domain expires soon. Confirm who pays and renew for 2 years."),
]


def _ref(u: User) -> dict:
    name = f"{u.first_name or ''} {u.last_name or ''}".strip() or u.email
    return {"id": u.id, "name": name}


async def _merchant(db, name: str, dry_run: bool) -> Optional[Merchant]:
    short = name.split(" Vietnamese")[0]
    rows = (await db.execute(select(Merchant).where(Merchant.restaurant_name.ilike(f"%{short}%")).order_by(Merchant.created_at))).scalars().all()
    if rows:
        return next((m for m in rows if m.restaurant_name.lower() == name.lower()), rows[0])
    print(f"  add   merchant {name}")
    if dry_run:
        return None
    m = Merchant(restaurant_name=name, source="SAMPLE")
    db.add(m)
    await db.flush()
    return m


async def _project(db, name: str, dry_run: bool) -> Optional[Project]:
    p = (await db.execute(select(Project).where(Project.name == name))).scalar_one_or_none()
    if p or dry_run:
        return p
    p = Project(name=name, position=len(PROJECTS))
    db.add(p)
    await db.flush()
    return p


async def add_demo_tickets(db, people: dict[str, User], dry_run: bool) -> int:
    await sla.refresh_from_db(db, force=True)  # use the SLA targets from Settings
    now = dt.datetime.now(dt.timezone.utc)
    today = now.date()
    added = 0
    for d in DEMOS:
        exists = (
            await db.execute(select(Ticket.id).where(Ticket.title == d.title, Ticket.description.contains(DEMO_MARK, autoescape=True)))
        ).first()
        if exists:
            print(f"  keep  ticket “{d.title}”")
            continue
        print(f"  add   ticket “{d.title}” · {d.status.value} · → {d.assignee}")
        added += 1
        if dry_run:
            continue
        creator, assignee = people[d.creator], people[d.assignee]
        created = now - dt.timedelta(days=d.days_ago)
        t = Ticket(
            title=d.title,
            description=(d.description + "\n\n" if d.description else "") + DEMO_MARK,
            type=d.type,
            category=d.category,
            sub_category=d.sub,
            request_type=d.request,
            priority=d.priority,
            status=d.status,
            project_id=(await _project(db, d.project, dry_run)).id,
            merchant_id=(await _merchant(db, d.merchant, dry_run)).id if d.merchant else None,
            assignee_id=assignee.id,
            created_by_id=creator.id,
            due_date=today + dt.timedelta(days=d.due_in_days) if d.due_in_days is not None else None,
            created_at=created,
            updated_at=created,
            response_due_at=sla.response_due(created, d.priority),
            resolution_due_at=sla.resolution_due(created, d.priority),
        )
        if d.first_response_h is not None:
            t.first_response_at = min(now, created + dt.timedelta(hours=d.first_response_h))
        if d.status == TicketStatus.AWAITING_MERCHANT:
            t.sla_paused_at = min(now, created + dt.timedelta(hours=(d.comments[-1][2] if d.comments else 24)))
        if d.status == TicketStatus.DONE:
            t.completed_at = min(now, created + dt.timedelta(hours=d.done_after_h or 8))
        db.add(t)
        await db.flush()

        # History, so the ticket page reads like real work.
        events = [(created, creator, TicketEventKind.CREATED, {"assignee": _ref(assignee)})]
        steps = FLOW[: FLOW.index(d.status) + 1] if d.status in FLOW else [TicketStatus.NEW, TicketStatus.IN_PROGRESS, d.status]
        last_comment = max((created + dt.timedelta(hours=h) for _, _, h in d.comments), default=None)
        last = t.completed_at or t.sla_paused_at or last_comment or (t.first_response_at or created) + dt.timedelta(hours=1)
        last = min(last, now)
        for i, (a, b) in enumerate(zip(steps, steps[1:])):
            at = (t.first_response_at or created) + (last - (t.first_response_at or created)) * (i / max(1, len(steps) - 2))
            events.append((min(at, now), assignee, TicketEventKind.STATUS_CHANGED, {"from": a.value, "to": b.value}))
        for e_at, who, kind, data in events:
            db.add(TicketEvent(ticket_id=t.id, actor_id=who.id, kind=kind, data=data, created_at=e_at))
        for i, (title, done) in enumerate(d.subtasks):
            db.add(TicketSubtask(ticket_id=t.id, title=title, done=done, position=i, created_at=created,
                                 done_at=created + dt.timedelta(hours=2 + i * 3) if done else None))
        for who, text, h in d.comments:
            db.add(TicketComment(ticket_id=t.id, author_id=people[who].id, body=text, created_at=min(now, created + dt.timedelta(hours=h))))
        t.updated_at = max([e[0] for e in events] + [created])
    return added


async def remove_demo_tickets(db, dry_run: bool) -> int:
    ids = (await db.execute(select(Ticket.id).where(Ticket.description.contains(DEMO_MARK, autoescape=True)))).scalars().all()
    print(f"  remove {len(ids)} demo ticket(s)")
    if ids and not dry_run:
        await db.execute(delete(Ticket).where(Ticket.id.in_(ids)))
    return len(ids)


async def main(args) -> None:
    async with SessionLocal() as db:
        if args.remove_demo:
            n = await remove_demo_tickets(db, args.dry_run)
            if not args.dry_run:
                await db.commit()
            print(f"\n{n} demo tickets removed. People were left as they are.")
            return

        print("People")
        people = await upsert_people(
            db, TEAM, domain=args.domain, password=args.password, reset_passwords=args.reset_passwords, dry_run=args.dry_run
        )
        keep = {people[k].id for k in TICKET_CREATORS if people[k].id}
        await only_creators_can_create(db, keep, args.dry_run)

        added = 0
        if not args.no_tickets:
            if args.dry_run and any(u.id is None for u in people.values()):
                print("\nDemo tickets: skipped in --dry-run until the people exist.")
            else:
                print("\nDemo tickets")
                added = await add_demo_tickets(db, people, args.dry_run)

        if args.dry_run:
            await db.rollback()
            print("\nDry run — nothing was written.")
            return
        await db.commit()

    print(f"\nDone. {len(TEAM)} people checked, {added} demo tickets added.")
    print(f"New people sign in with their email and the password: {args.password}")
    print("Only Aima and Maheen can create tickets. Remove the demo tickets any time with --remove-demo.")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--domain", default=DEFAULT_DOMAIN, help=f"email domain for the team (default {DEFAULT_DOMAIN})")
    # No default: a password written in the repo would be the same for every
    # new account and known to anyone who can read the code.
    ap.add_argument("--password", required=True, help="password for people being added (12+ characters)")
    ap.add_argument("--reset-passwords", action="store_true", help="also set that password for people who already exist")
    ap.add_argument("--no-tickets", action="store_true", help="add the people only")
    ap.add_argument("--remove-demo", action="store_true", help="delete the demo tickets this script added")
    ap.add_argument("--dry-run", action="store_true", help="show what would change, write nothing")
    asyncio.run(main(ap.parse_args()))
