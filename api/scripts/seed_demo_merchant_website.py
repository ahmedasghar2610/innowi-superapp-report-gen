"""
Demo data: one merchant with a location, an owner contact and a brand profile,
plus a LIVE website for it that is NOT linked — link it yourself from the
Websites list ("Link") or the merchant's Website & SEO tab ("Link existing
site"). The site deliberately disagrees with the Profile on four fields, so
the link dialog shows conflicts to resolve:

    field     Merchant Profile                          Website
    name      Sage & Ember Kitchen                      Sage and Ember
    phone     (626) 555-0148                            (626) 555-0199
    email     hello@sageandember.demo                   info@sageandember.demo
    hours     Tue–Sun 11:30am–9:30pm · Closed Mondays   Tue–Sun 11am–10pm · Closed Mondays

Address and city match, so they are not conflicts.

Idempotent: re-running updates the same rows (matched by merchant code
DEMO-001 and website slug sage-and-ember) instead of duplicating them.

Run from the API folder (the same .env the API uses):
    python -m scripts.seed_demo_merchant_website
Remove again:
    python -m scripts.seed_demo_merchant_website --remove
"""
from __future__ import annotations

import asyncio
import sys
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select, text, update
from sqlalchemy.orm import selectinload

from app.db.session import SessionLocal
from app.models.catalog import Package
from app.models.enums import AccountHealth, ContactRole, PackageStatus, YesNo
from app.models.profiling import BrandProfile, Contact, Location, Merchant, Subscription
from app.models.website import Website
from app.modules.merchant_profiling.completeness_service import refresh_completion_cache
from app.modules.websites.service import summarise
from app.db.schemas import qualified

MERCHANT_CODE = "DEMO-001"
SLUG = "sage-and-ember"

WEBSITE_VALUES = {
    "business": {
        "name": "Sage and Ember",
        "tagline": "Wood-fired comfort food in the heart of Pasadena",
        "email": "info@sageandember.demo",
        "phone": "(626) 555-0199",
        "address": "412 E Colorado Blvd",
        "city": "Pasadena, CA 91101",
        "country": "United States",
        "hours": "Tue–Sun 11am–10pm · Closed Mondays",
    },
    "brand": {
        "primary": "#2F5D50",
        "secondary": "#F4EDE4",
        "accent": "#D98E3C",
        "textColor": "#2B2B2B",
        "headingFont": "Playfair Display",
        "bodyFont": "Inter",
    },
    "hero": {
        "headline": "Slow-cooked. Wood-fired. Made to share.",
        "subtext": "Seasonal plates from a scratch kitchen, a short wine list we actually drink, and a patio that catches the afternoon sun.",
        "ctaLabel": "Order Online",
        "ctaLink": "https://order.sageandember.demo",
        "imageAlt": "Wood-fired oven with flatbreads",
    },
    "about": {
        "eyebrow": "Our story",
        "heading": "A neighbourhood kitchen since 2016",
        "story": "Sage & Ember started as a weekend pop-up behind a Pasadena bakery. Ten years on, we still cook everything over almond wood, still buy from the same three farms, and still close on Mondays so the team can rest.",
        "ctaLabel": "Book a table",
        "ctaLink": "https://sageandember.demo/reserve",
    },
    "offerings": {
        "eyebrow": "The menu",
        "heading": "What we're cooking this season",
        "intro": "A short menu that changes with the market. These four never leave.",
        "ctaLabel": "View Full Menu & Order",
        "cardCta": "Order this",
        "ctaLink": "https://order.sageandember.demo",
        "items": [
            {"name": "Ember Roast Chicken", "price": "$26", "description": "Half bird, salsa verde, charred lemon, smashed potatoes."},
            {"name": "Sage Butternut Flatbread", "price": "$18", "description": "Brown butter, sage, ricotta, toasted hazelnuts."},
            {"name": "Coal-Roasted Short Rib", "price": "$34", "description": "48-hour braise, horseradish cream, pickled shallots."},
            {"name": "Burnt Honey Panna Cotta", "price": "$11", "description": "Bee pollen, olive oil, sea salt."},
        ],
    },
    "orderUrl": "https://order.sageandember.demo",
    "social": {
        "eyebrow": "Why guests come back",
        "heading": "Cooked with fire, served with care",
        "points": [
            {"title": "Scratch kitchen", "emoji": "🔥", "description": "Every sauce, stock and loaf is made in-house, daily."},
            {"title": "Three farms, one menu", "emoji": "🌱", "description": "Produce from growers within 60 miles of the restaurant."},
            {"title": "Sunny patio", "emoji": "☀️", "description": "Dog-friendly, heated in winter, shaded in summer."},
        ],
        "reviewsHeading": "What Pasadena is saying",
        "ratingText": "4.8 ★ from 612 Google reviews",
    },
    "contact": {
        "heading": "Find us",
        "line": "412 E Colorado Blvd, Pasadena, CA 91101 · (626) 555-0148",
        "mapAddress": "412 E Colorado Blvd, Pasadena, CA 91101",
        "directionsLabel": "Get directions",
        "directionsLink": "https://maps.google.com/?q=412+E+Colorado+Blvd+Pasadena+CA",
        "formType": "message",
        "submitLabel": "Send message",
        "success": "Thanks — we'll get back to you within a day.",
    },
    "footer": {
        "about": "Wood-fired comfort food in Pasadena since 2016.",
        "instagram": "https://instagram.com/sageandember.demo",
        "facebook": "https://facebook.com/sageandember.demo",
        "rights": "© Sage & Ember Kitchen. All rights reserved.",
    },
    "meta": {
        "title": "Sage & Ember Kitchen | Wood-Fired Restaurant in Pasadena, CA",
        "description": "Seasonal wood-fired plates, a short wine list and a sunny patio on Colorado Blvd. Order online or book a table.",
        "keywords": "pasadena restaurant, wood-fired, farm to table, patio dining",
    },
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
    print(f"[seed:demo] website /{SLUG}: {'deleted' if site_rows else 'not found'}")
    print(f"[seed:demo] merchant {MERCHANT_CODE}: {'deleted' if merchant_rows else 'not found'}")
    for slug in other_sites:
        print(f"[seed:demo] website /{slug} was linked to {MERCHANT_CODE} — kept, now unassigned")

async def main() -> None:
    now = datetime.now(timezone.utc)
    async with SessionLocal() as db:
        # The website ↔ merchant link needs migration e4f5a6b7c8d9.
        has_col = await db.scalar(text(
            "select count(*) from information_schema.columns "
            f"where table_schema='{qualified('marketing')}' and table_name='website' and column_name='merchant_id'"
        ))
        if not has_col:
            sys.exit("[seed:demo] marketing.website.merchant_id is missing — run `alembic upgrade head` first.")

        # ---------------- merchant
        merchant = await db.scalar(
            select(Merchant)
            .where(Merchant.merchant_code == MERCHANT_CODE)
            .options(selectinload(Merchant.locations), selectinload(Merchant.contacts),
                     selectinload(Merchant.brand_profile), selectinload(Merchant.subscription))
        )
        created = merchant is None
        if merchant is None:
            merchant = Merchant(merchant_code=MERCHANT_CODE, source="SAMPLE")
            merchant.locations, merchant.contacts = [], []
            db.add(merchant)

        merchant.restaurant_name = "Sage & Ember Kitchen"
        merchant.legal_name = "Sage & Ember Hospitality LLC"
        merchant.cuisine_category = "New American · Wood-fired"
        merchant.online_ordering = "https://order.sageandember.demo"
        merchant.pos_system = "Toast"
        merchant.customer_list_source = "Toast export"
        merchant.google_ads_budget = 1500
        merchant.meta_ads_budget = 600
        merchant.business_goals = "Lift weekday lunch covers 20% and grow direct online orders over third-party apps."
        merchant.target_audience = "Pasadena professionals 28–55, families on weekends, Caltech visitors."
        merchant.slow_dayparts = "Tuesday–Thursday lunch"
        merchant.seasonal_peaks = "Rose Parade week, Mother's Day, December"
        merchant.alcohol_license = YesNo.YES
        merchant.dietary_certs = "Vegetarian & gluten-free options"
        merchant.location_count = 1
        merchant.report_frequency = "Monthly"
        merchant.report_recipients = "maya@sageandember.demo"
        merchant.account_health = AccountHealth.GREEN
        merchant.next_action = "Collect new food photography for the site"
        merchant.onboarding_date = now - timedelta(days=45)
        merchant.go_live_date = now - timedelta(days=10)
        merchant.notes = "Demo merchant — safe to delete (python -m scripts.seed_demo_merchant_website --remove)."
        await db.flush()

        # ---------------- primary location
        loc = next((l for l in merchant.locations if l.is_primary), None)
        if loc is None:
            loc = Location(merchant_id=merchant.id, is_primary=True)
            db.add(loc)
        loc.address = "412 E Colorado Blvd"
        loc.city, loc.state, loc.zip = "Pasadena", "CA", "91101"
        loc.hours = "Tue–Sun 11:30am–9:30pm · Closed Mondays"
        loc.timezone = "America/Los_Angeles"
        loc.nap_status = "VERIFIED"

        # ---------------- owner contact
        owner = next((c for c in merchant.contacts if c.role == ContactRole.OWNER), None)
        if owner is None:
            owner = Contact(merchant_id=merchant.id, role=ContactRole.OWNER)
            db.add(owner)
        owner.name = "Maya Delgado"
        owner.email = "hello@sageandember.demo"
        owner.phone = "(626) 555-0148"
        owner.language = "en"

        # ---------------- brand profile (explicit query: a freshly created
        # merchant has no loaded relationship, and lazy-load is not allowed
        # inside an AsyncSession)
        brand = await db.scalar(select(BrandProfile).where(BrandProfile.merchant_id == merchant.id))
        if brand is None:
            brand = BrandProfile(merchant_id=merchant.id)
            db.add(brand)
        brand.brand_colors = "#2F5D50, #F4EDE4, #D98E3C"
        brand.brand_fonts = "Playfair Display / Inter"
        brand.tone_of_voice = "Warm, unfussy, a little playful"
        brand.signature_dishes = "Ember Roast Chicken, Coal-Roasted Short Rib, Sage Butternut Flatbread"
        brand.do_not_say = "\"cheap\", \"fast food\""

        # ---------------- subscription (first package in the catalog, if any)
        sub = await db.scalar(select(Subscription).where(Subscription.merchant_id == merchant.id))
        if sub is None:
            pkg = await db.scalar(select(Package).order_by(Package.code).limit(1))
            if pkg is not None:
                db.add(Subscription(
                    merchant_id=merchant.id, package_code=pkg.code, status=PackageStatus.ACTIVE,
                    start_date=now - timedelta(days=45), renewal_date=now + timedelta(days=320),
                    mrr=499, is_current=True,
                ))
        await db.commit()

        # ---------------- website: NOT linked (link it yourself in the app)
        site = await db.scalar(select(Website).where(Website.slug == SLUG))
        site_created = site is None
        if site is None:
            site = Website(slug=SLUG)
            db.add(site)
        site.values = WEBSITE_VALUES
        for col, v in summarise(WEBSITE_VALUES).items():
            setattr(site, col, v)
        site.status = "live"
        site.notes = "Demo website — unassigned; link it to Sage & Ember Kitchen (DEMO-001) to see the conflicts."
        site.merchant_id = None
        # A previous run linked them and set this URL — clear it.
        if merchant.website_url and SLUG in merchant.website_url:
            merchant.website_url = None
            merchant.website_platform = None
        await db.commit()
        await refresh_completion_cache(db, merchant.id)

    print(f"[seed:demo] merchant {'created' if created else 'updated'}: Sage & Ember Kitchen ({MERCHANT_CODE}, id={merchant.id})")
    print(f"[seed:demo] website  {'created' if site_created else 'updated'}: /{SLUG} (id={site.id}) — status live, NOT linked")
    print("[seed:demo] conflicts waiting when you link them: name, phone, email, hours")

if __name__ == "__main__":
    asyncio.run(remove() if "--remove" in sys.argv else main())
