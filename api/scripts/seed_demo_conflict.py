"""
Demo data for trying the Website <-> Merchant LINK flow by hand, with
conflicts. Creates two records that are deliberately NOT linked:

  Merchant  "Bluefin Harbor Grill"      (code DEMO-002)  — the Profile
  Website   "Bluefin Harbor Grill & Bar" (/bluefin-harbor) — UNASSIGNED

They describe the same restaurant but disagree on five business fields, so
linking them shows the "which value wins" prompt:

  Field          Merchant Profile                 Website
  -------------  -------------------------------  --------------------------------
  Business name  Bluefin Harbor Grill             Bluefin Harbor Grill & Bar
  Phone          (562) 555-0190                   (562) 555-0177
  Email          owner@bluefinharbor.demo         info@bluefinharbor.demo
  Address        215 Shoreline Village Dr         250 Shoreline Village Dr, Suite B
  Hours          Mon–Sun 11am–10pm                Mon–Thu 11am–9pm · Fri–Sun 11am–11pm
  City           Long Beach, CA 90802             Long Beach, CA 90802   (same → no conflict)

Re-running resets both records to exactly this state (unlinked, conflicting),
so you can try the link again with different choices.

Run from the API folder:
    python -m scripts.seed_demo_conflict
Remove:
    python -m scripts.seed_demo_conflict --remove
"""
from __future__ import annotations

import asyncio
import copy
import sys

from sqlalchemy import delete, select, text, update

from app.db.session import SessionLocal
from app.models.enums import AccountHealth, ContactRole
from app.models.profiling import Contact, Location, Merchant
from app.models.website import Website
from app.modules.merchant_profiling.completeness_service import refresh_completion_cache
from app.modules.websites.service import summarise
from app.db.schemas import qualified

MERCHANT_CODE = "DEMO-002"
SLUG = "bluefin-harbor"

PROFILE = {
    "name": "Bluefin Harbor Grill",
    "phone": "(562) 555-0190",
    "email": "owner@bluefinharbor.demo",
    "address": "215 Shoreline Village Dr",
    "city": "Long Beach", "state": "CA", "zip": "90802",
    "hours": "Mon–Sun 11am–10pm",
}

WEBSITE_VALUES = {
    "business": {
        "name": "Bluefin Harbor Grill & Bar",
        "tagline": "Seafood and sunsets on the Long Beach waterfront",
        "email": "info@bluefinharbor.demo",
        "phone": "(562) 555-0177",
        "address": "250 Shoreline Village Dr, Suite B",
        "city": "Long Beach, CA 90802",
        "country": "United States",
        "hours": "Mon–Thu 11am–9pm · Fri–Sun 11am–11pm",
    },
    "brand": {"primary": "#0F4C75", "secondary": "#F2F7FA", "accent": "#F29E4C",
              "textColor": "#1F2933", "headingFont": "Barlow Condensed", "bodyFont": "Inter"},
    "hero": {
        "headline": "Fresh off the boat. Straight to your table.",
        "subtext": "Line-caught fish, raw bar, and the best harbor view in Long Beach.",
        "ctaLabel": "Order Online", "ctaLink": "https://order.bluefinharbor.demo",
    },
    "about": {
        "eyebrow": "Our story", "heading": "Family-run on the harbor since 2009",
        "story": "Three generations of fishermen, one kitchen. We buy from the morning boats and write the menu after.",
    },
    "offerings": {
        "heading": "From the dock", "intro": "What came in this morning.",
        "ctaLink": "https://order.bluefinharbor.demo",
        "items": [
            {"name": "Grilled Yellowtail Collar", "price": "$22", "description": "Ponzu, charred scallion, lime."},
            {"name": "Harbor Fish Tacos", "price": "$16", "description": "Beer-battered rockfish, cabbage slaw, chipotle crema."},
            {"name": "Seafood Cioppino", "price": "$34", "description": "Mussels, clams, prawns, sourdough."},
        ],
    },
    "orderUrl": "https://order.bluefinharbor.demo",
    "social": {
        "heading": "Why locals keep coming back",
        "points": [
            {"title": "Morning-boat fish", "emoji": "🎣", "description": "Nothing frozen, ever."},
            {"title": "Harbor-view patio", "emoji": "⛵", "description": "Heated, dog-friendly, sunset-facing."},
        ],
    },
    "contact": {"heading": "Visit us", "mapAddress": "250 Shoreline Village Dr, Long Beach, CA 90802"},
    "meta": {"title": "Bluefin Harbor Grill & Bar | Seafood in Long Beach, CA",
             "description": "Line-caught seafood and a harbor-view patio in Shoreline Village."},
}


async def remove() -> None:
    """Delete the demo website and merchant with plain DELETE statements.

    The ORM's db.delete(merchant) tried to lazy-load every child row in an
    async session and failed before committing. The database already cascades
    locations, contacts, brand, subscription (ON DELETE CASCADE), and any
    other website linked to this merchant becomes unassigned (ON DELETE SET
    NULL) rather than being deleted.
    """
    async with SessionLocal() as db:
        merchant_id = await db.scalar(select(Merchant.id).where(Merchant.merchant_code == MERCHANT_CODE))
        other_sites: list[str] = []
        if merchant_id:
            other_sites = list(
                (await db.scalars(
                    select(Website.slug).where(Website.merchant_id == merchant_id, Website.slug != SLUG)
                )).all()
            )
            await db.execute(
                update(Website).where(Website.merchant_id == merchant_id).values(merchant_id=None)
                .execution_options(synchronize_session=False)
            )
        site_rows = (await db.execute(
            delete(Website).where(Website.slug == SLUG).execution_options(synchronize_session=False)
        )).rowcount
        merchant_rows = 0
        if merchant_id:
            merchant_rows = (await db.execute(
                delete(Merchant).where(Merchant.id == merchant_id).execution_options(synchronize_session=False)
            )).rowcount
        await db.commit()
    print(f"[seed:conflict] website /{SLUG}: {'deleted' if site_rows else 'not found'}")
    print(f"[seed:conflict] merchant {MERCHANT_CODE}: {'deleted' if merchant_rows else 'not found'}")
    for slug in other_sites:
        print(f"[seed:conflict] website /{slug} was linked to {MERCHANT_CODE} — kept, now unassigned")

async def main() -> None:
    async with SessionLocal() as db:
        has_col = await db.scalar(text(
            "select count(*) from information_schema.columns "
            f"where table_schema='{qualified('marketing')}' and table_name='website' and column_name='merchant_id'"
        ))
        if not has_col:
            sys.exit("[seed:conflict] marketing.website.merchant_id is missing — run `alembic upgrade head` first.")

        # ---------------- merchant (the Profile side)
        merchant = await db.scalar(select(Merchant).where(Merchant.merchant_code == MERCHANT_CODE))
        created = merchant is None
        if merchant is None:
            merchant = Merchant(merchant_code=MERCHANT_CODE, source="SAMPLE")
            db.add(merchant)
        merchant.restaurant_name = PROFILE["name"]
        merchant.cuisine_category = "Seafood"
        merchant.account_health = AccountHealth.YELLOW
        merchant.location_count = 1
        merchant.website_url = None          # reset whatever a previous link wrote
        merchant.website_platform = None
        merchant.notes = "Demo merchant for the link-conflict walkthrough (python -m scripts.seed_demo_conflict --remove)."
        await db.flush()

        loc = await db.scalar(select(Location).where(Location.merchant_id == merchant.id, Location.is_primary.is_(True)))
        if loc is None:
            loc = Location(merchant_id=merchant.id, is_primary=True)
            db.add(loc)
        loc.address = PROFILE["address"]
        loc.city, loc.state, loc.zip = PROFILE["city"], PROFILE["state"], PROFILE["zip"]
        loc.hours = PROFILE["hours"]
        loc.timezone = "America/Los_Angeles"

        for role, name in ((ContactRole.OWNER, "Daniel Okafor"), (ContactRole.BILLING, "Priya Shah")):
            c = await db.scalar(select(Contact).where(Contact.merchant_id == merchant.id, Contact.role == role))
            if c is None:
                c = Contact(merchant_id=merchant.id, role=role)
                db.add(c)
            c.name = name
            if role == ContactRole.OWNER:
                c.phone, c.email = PROFILE["phone"], PROFILE["email"]
            else:
                c.phone, c.email = "(562) 555-0191", "billing@bluefinharbor.demo"

        # ---------------- website (the site side) — UNASSIGNED, conflicting
        site = await db.scalar(select(Website).where(Website.slug == SLUG))
        site_created = site is None
        if site is None:
            site = Website(slug=SLUG)
            db.add(site)
        values = copy.deepcopy(WEBSITE_VALUES)
        site.values = values
        for col, v in summarise(values).items():
            setattr(site, col, v)
        site.status = "in_creation"
        site.merchant_id = None
        site.notes = "Demo website for the link-conflict walkthrough — deliberately unassigned."

        await db.commit()
        await refresh_completion_cache(db, merchant.id)

    print(f"[seed:conflict] merchant {'created' if created else 'reset'}: {PROFILE['name']} ({MERCHANT_CODE})")
    print(f"[seed:conflict] website  {'created' if site_created else 'reset'}: {WEBSITE_VALUES['business']['name']} (/{SLUG}) — UNASSIGNED")
    print("[seed:conflict] 5 conflicting fields: name, phone, email, address, hours (city matches).")
    print("[seed:conflict] Now link them in the Super App: Websites → 'Unassigned only' → link icon.")


if __name__ == "__main__":
    asyncio.run(remove() if "--remove" in sys.argv else main())
