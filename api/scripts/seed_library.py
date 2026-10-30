"""
Starter content for the Ops CRM Library, taken from the Ops CRM prototype v4, the lead's decisions
and the Super App's own design tokens.

    python -m scripts.seed_library                         # add missing pages
    python -m scripts.seed_library --owner aima@innowi.com # set the page owner
    python -m scripts.seed_library --update                # also overwrite the text of existing pages
    python -m scripts.seed_library --dry-run               # report, write nothing

Idempotent: a page is matched by section + title (+ merchant), and is left
alone if it exists, unless --update is passed (which saves the old text as a
version first, exactly like an edit in the app).

Merchant pages are attached to the prototype's merchants (Cha2Cha, Pho Ha
Plus, Nizario's Pizza), matched by name. A merchant that doesn't exist yet is
created with just its name (and address where the prototype gave one) — pass
--no-create-merchants to skip those pages instead. Sections marked
"_To fill in_" had no detail in the prototype — complete them in the app.

Pages are owned by --owner, or by the first Super Admin when not given.

Demo logins are also added to the credentials vault (the prototype's
Instagram / Google Business Profile / website-admin entries). They are clearly
fake — every one is labelled "(demo)" and its password starts with "demo-" —
so the vault can be tried out. Delete them, or replace them with real logins,
before the team relies on the vault. This needs CREDENTIAL_ENCRYPTION_KEY in
.env; without it the pages are still added and the logins are skipped.
Pass --no-demo-credentials to leave the vault empty.
"""
from __future__ import annotations

import argparse
import asyncio
from typing import Optional

from sqlalchemy import func, select

from app.common.security.crypto import CredentialKeyMissing, encrypt_secret
from app.db.session import SessionLocal
from app.models.auth import User
from app.models.enums import CredentialAction, LibrarySection, Role
from app.models.ops import Credential, CredentialAccessLog, LibraryPage, LibraryPageVersion, utcnow
from app.models.profiling import Merchant

# ---------------------------------------------------------------- content ----
INNOWI_BRAND = """## Typeface
**Inter** for everything in the Super App — headings, body, tables. One family, weights 400 / 500 / 600.

## Colours
- Primary blue #2C67F5 — buttons, links, the selected item
- Ink #32425B — body text
- Muted grey #6B7280 — secondary text and labels
- Success #059669 · Warning #D97706 · Destructive #DC2626 — status only, never decoration

## Icons
One library (**Lucide**), outline style, 16px in menus and buttons.

## Status
A status colour never travels without its label and icon — "✓ Met", "⚠ At risk", "✕ Overdue". Colour alone is never the only signal.

## Voice
Plain, warm and direct. Say what happened and what to do next; no jargon in anything a merchant will read.
"""

ROUTING_RULES = """## How a ticket is created
- Only **Aima** and **Maheen** create tickets for now (the *ticket manager* permission). More people can be added later.
- Every ticket has exactly **one assignee** — no team queues, nobody "picks up" work.
- A merchant is optional: internal work (SuperApp build, approvals) has no merchant.

## Type sets the categories
- **Marketing** — campaigns, promotions, social media, email and SMS
- **Design** — logos, menus, signage, social assets
- **Website** — new sites, content updates, bugs, SEO fixes, domains and hosting
- **Internal** — process, tooling, approvals

## Who can change what
1. Everyone can read tickets and comment.
2. The assignee moves their own ticket through the statuses and works its sub-tasks.
3. Aima and Maheen edit, reassign and delete.

## Statuses
New → In Progress → Awaiting Merchant → In Review → Done. While a ticket is **Awaiting Merchant** the SLA clock pauses.

## SLA targets (working days; weekends don't count)
- **Urgent** — respond within 2 hours, resolve within 1 working day
- **High** — respond within 4 hours, resolve within 2 working days
- **Medium** — respond within 1 working day, resolve within 5 working days
- **Low** — respond within 2 working days, resolve within 10 working days

## Planned: tickets created by Super App modules
_Not switched on yet — these are the prototype's proposed rules._
- SEO · ranking drop over 5 positions → Website, **High**
- Website · a page returns 404 → Website, **Urgent**
- GBP · 3+ new reviews under 3 stars → Marketing, **High**
- Campaign scheduled without assets → suggest a Design ticket
"""

ONBOARDING = """Work through this when a new merchant signs. Each item maps to a tab on the merchant's **Profiling** page.

## Week 1 — kickoff
1. Kickoff call booked with the owner; meeting notes saved
2. **Contacts** — owner, marketing contact, content approver, billing
3. **Locations** — address, phone, opening hours for every location
4. **Services** — package and services they've bought (Website, SEO, GBP, Email/SMS…)

## Access
- **Connections** — website admin, Google Business Profile, Instagram / Facebook, POS / online ordering
- Logins the team needs go in **Library → Credentials vault** (never in a ticket or chat)

## Brand
- **Brand** tab — logo files, colours, fonts, voice
- A **Brand guidelines** page for the merchant in **Library → Merchants**
- **Keywords** and **Competitors** for SEO

## Paperwork
- **Documents** — signed agreement, W-9 / tax forms, any brand or menu files

## Done when
- Profile completeness is above 80%
- First tickets are created for the launch work, each with one assignee and a due date
"""

CAMPAIGN_BRIEF = """Copy this into a Marketing ticket's description before work starts.

## Merchant and goal
- Merchant:
- What should this campaign achieve? (e.g. fill slow weekday lunches)

## Audience
- Who are we talking to?

## Offer
- What exactly is the offer, and the terms?

## Channels and dates
- Email / SMS / social / ads:
- Start and end dates:

## Assets needed
- Copy:
- Images / design (create a **Design** ticket and link it):

## Approval
- Who approves on the merchant's side, and by when?

> Attach the brief to the ticket before design starts.
"""

WEBSITE_CHANGE = """Use this for a **Website** ticket so the change can be made without a back-and-forth.

## Which page
- URL:
- Desktop, mobile or both?

## What should change
- Current:
- New:

## Content
- New text (exact wording):
- New images or menu file attached? (yes / no)

## Deadline
- Needed live by:
- Is anything time-sensitive (a promotion, new hours)?

## Check after publishing
- Page loads on mobile
- Hours / phone match Google Business Profile
"""

CHA2CHA = """## Logo
Use the wordmark on all storefront and print applications. Minimum clear space is the height of the "C". Do not stretch, recolour, or place on busy photography. Vector masters live in Figma; PNG exports are for social only.

## Colours
- Tea green #1F6F5C
- Honey #F4C95D
- Ink #2B2B2B
- Cream #FBF7EF

## Typography
Headings: **Fraunces Semibold**. Body: **DM Sans Regular**. Menus use Fraunces at 18pt minimum for legibility in low light.

## Voice
Warm, playful, never salesy. Refer to customers as "friends", never "guests". Emojis are fine on social, not in SMS.

## Contacts
- Owner: Ivy Pham · ivy@cha2cha.com
"""

PHO_HA_PLUS = """Pho Ha Plus Vietnamese Cuisine · Garden Grove, CA · Growth plan · Services: Website, SEO, GMB, Email/SMS.

## Contacts
- Owner: Thanh Nguyen

## Website relaunch (kickoff notes)
- Launch target **20 Oct**, soft launch on staging by 13 Oct
- Keep the existing domain; SSL renewal handled under the relaunch project
- Migrate menu pages first, then location / hours, then the blog
- The ordering widget stays on the old site until cut-over day
- Existing menu photography can be reused
- Open question: keep the Vietnamese-language page? (Thanh to confirm)

## Logo
_To fill in_

## Colours
_To fill in_

## Typography
_To fill in_

## Voice
_To fill in_
"""

NIZARIOS = """## Recent work
- Lunch combo offer campaign
- Seasonal specials menu insert
- Google Business Profile review response templates

## Logo
_To fill in_

## Colours
_To fill in_

## Typography
_To fill in_

## Voice
_To fill in_
"""

# (section, title, parent title, merchant name, body)
PAGES: list[tuple[LibrarySection, str, Optional[str], Optional[str], str]] = [
    (LibrarySection.COMPANY, "Innowi brand guidelines", None, None, INNOWI_BRAND),
    (LibrarySection.PROCESS, "Processes & SOPs", None, None,
     "How the Ops team works. Open a sub-page below, or add one with **New page → Processes & SOPs → Inside: Processes & SOPs**."),
    (LibrarySection.PROCESS, "Ticket routing rules", "Processes & SOPs", None, ROUTING_RULES),
    (LibrarySection.PROCESS, "Merchant onboarding checklist", "Processes & SOPs", None, ONBOARDING),
    (LibrarySection.TEMPLATE, "Templates", None, None,
     "Reusable briefs and request forms. Copy one into a ticket's description."),
    (LibrarySection.TEMPLATE, "Campaign brief", "Templates", None, CAMPAIGN_BRIEF),
    (LibrarySection.TEMPLATE, "Website change request", "Templates", None, WEBSITE_CHANGE),
    (LibrarySection.MERCHANT, "Brand guidelines", None, "Cha2Cha", CHA2CHA),
    (LibrarySection.MERCHANT, "Brand guidelines", None, "Pho Ha Plus Vietnamese Cuisine", PHO_HA_PLUS),
    (LibrarySection.MERCHANT, "Brand guidelines", None, "Nizario's Pizza", NIZARIOS),
]


# Demo vault entries: (merchant name or None for Innowi, label, username, login page, password, notes)
DEMO_CREDENTIALS: list[tuple[Optional[str], str, str, str, str, str]] = [
    ("Cha2Cha", "Instagram · @cha2cha (demo)", "cha2cha", "https://www.instagram.com/accounts/login/",
     "demo-insta-Cha2Cha!", "DEMO — replace with the real login. 2FA codes go to Ivy's phone."),
    ("Cha2Cha", "Google Business Profile (demo)", "owner@cha2cha.example", "https://business.google.com",
     "demo-gbp-Cha2Cha!", "DEMO — replace with the real login."),
    ("Cha2Cha", "Website admin · WordPress (demo)", "innowi-admin", "https://cha2cha.example/wp-admin",
     "demo-wp-Cha2Cha!", "DEMO — replace with the real login."),
    ("Pho Ha Plus Vietnamese Cuisine", "Website admin · WordPress (demo)", "innowi-admin",
     "https://phohaplus.example/wp-admin", "demo-wp-PhoHa!", "DEMO — replace with the real login. Keep live until the 20 Oct cut-over."),
    ("Pho Ha Plus Vietnamese Cuisine", "Google Business Profile (demo)", "thanh@phohaplus.example",
     "https://business.google.com", "demo-gbp-PhoHa!", "DEMO — replace with the real login."),
    ("Nizario's Pizza", "Google Business Profile (demo)", "owner@nizarios.example", "https://business.google.com",
     "demo-gbp-Nizarios!", "DEMO — replace with the real login. Used for review responses."),
    (None, "Canva team account (demo)", "design@innowi.example", "https://www.canva.com/login",
     "demo-canva-Innowi!", "DEMO — replace with the real login. Shared by the design team."),
]


async def _seed_credentials(db, owner: Optional[User], dry_run: bool, merchants: dict[str, Merchant]) -> tuple[int, int]:
    added = kept = 0
    try:
        encrypt_secret("probe")
    except CredentialKeyMissing:
        print("\n  skip  demo logins — CREDENTIAL_ENCRYPTION_KEY isn't set in .env (see .env.example)")
        return 0, 0
    for merchant_name, label, username, url, secret, notes in DEMO_CREDENTIALS:
        merchant = merchants.get(merchant_name) if merchant_name else None
        if merchant_name and not merchant:
            print(f"  skip  login {label} — merchant {merchant_name} not found")
            continue
        stmt = select(Credential).where(Credential.label == label)
        stmt = stmt.where(Credential.merchant_id == merchant.id) if merchant else stmt.where(Credential.merchant_id.is_(None))
        if (await db.execute(stmt)).scalars().first():
            kept += 1
            continue
        where = merchant.restaurant_name if merchant else "Innowi"
        print(f"  add   login {where} · {label}")
        added += 1
        if dry_run:
            continue
        c = Credential(
            merchant_id=merchant.id if merchant else None,
            label=label,
            username=username,
            url=url,
            notes=notes,
            secret_encrypted=encrypt_secret(secret),
            created_by_id=owner.id if owner else None,
        )
        db.add(c)
        await db.flush()
        db.add(
            CredentialAccessLog(
                credential_id=c.id,
                credential_label=c.label,
                merchant_id=c.merchant_id,
                user_id=owner.id if owner else None,
                user_email=owner.email if owner else "seed script",
                action=CredentialAction.CREATED,
                reason="demo data (scripts/seed_library.py)",
            )
        )
    return added, kept


async def _find_merchant(db, name: str) -> Optional[Merchant]:
    rows = (
        await db.execute(select(Merchant).where(Merchant.restaurant_name.ilike(f"%{name}%")).order_by(Merchant.created_at))
    ).scalars().all()
    exact = [m for m in rows if m.restaurant_name.lower() == name.lower()]
    return (exact or rows or [None])[0]


async def main(
    update: bool,
    dry_run: bool,
    owner_email: Optional[str],
    create_merchants: bool = True,
    demo_credentials: bool = True,
) -> None:
    async with SessionLocal() as db:
        owner: Optional[User] = None
        if owner_email:
            owner = (await db.execute(select(User).where(User.email == owner_email.lower()))).scalar_one_or_none()
            if not owner:
                raise SystemExit(f"No user with email {owner_email}")
        else:
            owner = (
                await db.execute(select(User).where(User.role == Role.SUPER_ADMIN).order_by(User.created_at).limit(1))
            ).scalar_one_or_none()

        created = updated = skipped = merchants_added = 0
        by_title: dict[tuple[LibrarySection, str], LibraryPage] = {}
        merchants_by_name: dict[str, Merchant] = {}

        for section, title, parent_title, merchant_name, body in PAGES:
            merchant = None
            if merchant_name:
                merchant = await _find_merchant(db, merchant_name.split(" Vietnamese")[0])
                if not merchant and create_merchants:
                    merchant = Merchant(restaurant_name=merchant_name, source="SAMPLE")
                    print(f"  add   merchant {merchant_name}")
                    merchants_added += 1
                    if not dry_run:
                        db.add(merchant)
                        await db.flush()
                if not merchant:
                    print(f"  skip  {merchant_name} · {title} — no merchant named like '{merchant_name}'")
                    skipped += 1
                    continue
                merchants_by_name[merchant_name] = merchant

            parent = by_title.get((section, parent_title)) if parent_title else None
            stmt = select(LibraryPage).where(LibraryPage.section == section, LibraryPage.title == title)
            stmt = stmt.where(LibraryPage.merchant_id == merchant.id) if merchant else stmt.where(LibraryPage.merchant_id.is_(None))
            existing = (await db.execute(stmt)).scalars().first()
            label = f"{merchant.restaurant_name} · {title}" if merchant else title

            if existing:
                by_title[(section, title)] = existing
                if update and existing.body != body:
                    if not dry_run:
                        db.add(LibraryPageVersion(page_id=existing.id, version=existing.version, title=existing.title,
                                                  body=existing.body, edited_by_id=existing.updated_by_id))
                        existing.body = body
                        existing.version += 1
                        existing.updated_by_id = owner.id if owner else existing.updated_by_id
                        existing.updated_at = utcnow()
                    print(f"  update {label}")
                    updated += 1
                else:
                    print(f"  keep  {label}")
                    skipped += 1
                continue

            max_pos = (await db.execute(select(func.max(LibraryPage.position)).where(LibraryPage.section == section))).scalar() or 0
            page = LibraryPage(
                title=title,
                section=section,
                parent_id=parent.id if parent else None,
                merchant_id=merchant.id if merchant else None,
                body=body,
                position=max_pos + 1,
                owner_id=owner.id if owner else None,
                updated_by_id=owner.id if owner else None,
            )
            print(f"  add   {label}")
            created += 1
            if not dry_run:
                db.add(page)
                await db.flush()
            by_title[(section, title)] = page

        logins_added = logins_kept = 0
        if demo_credentials:
            for name in {m for m, *_ in DEMO_CREDENTIALS if m and m not in merchants_by_name}:
                found = await _find_merchant(db, name.split(" Vietnamese")[0])
                if found:
                    merchants_by_name[name] = found
            logins_added, logins_kept = await _seed_credentials(db, owner, dry_run, merchants_by_name)

        if dry_run:
            await db.rollback()
        else:
            await db.commit()
        print(
            f"\n{created} pages added, {updated} updated, {skipped} kept/skipped, {merchants_added} merchants added, "
            f"{logins_added} demo logins added ({logins_kept} already there)"
            f"{' (dry run — nothing written)' if dry_run else ''}."
        )


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--update", action="store_true", help="overwrite the text of pages that already exist")
    ap.add_argument("--dry-run", action="store_true", help="report what would change, write nothing")
    ap.add_argument("--owner", help="email of the person to set as owner (default: the first Super Admin)")
    ap.add_argument("--no-create-merchants", action="store_true", help="skip merchant pages whose merchant doesn't exist")
    ap.add_argument("--no-demo-credentials", action="store_true", help="don't add the demo logins to the vault")
    a = ap.parse_args()
    asyncio.run(main(a.update, a.dry_run, a.owner, not a.no_create_merchants, not a.no_demo_credentials))
