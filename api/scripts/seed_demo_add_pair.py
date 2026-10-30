"""
Add ONE more demo merchant + website pair for trying the Website <-> Merchant
link by hand. Nothing is ever deleted or overwritten.

Each run adds the next restaurant from RESTAURANTS below that isn't in the
database yet. When all five exist, it adds copies with a number on the end
(e.g. "Olive & Thyme 2", /olive-and-thyme-2, DEMO-A01-2), so you can run it as
often as you like.

The pair is NOT linked. The website disagrees with the merchant Profile on
name, phone, email and hours (address and city match), so linking them shows
the "which value wins" prompt.

Run from the API folder (the same .env the API uses):
    python -m scripts.seed_demo_add_pair            # add one pair
    python -m scripts.seed_demo_add_pair 3          # add three pairs
"""
from __future__ import annotations

import asyncio
import copy
import sys

from sqlalchemy import select, text

from app.db.session import SessionLocal
from app.models.enums import AccountHealth, ContactRole
from app.models.profiling import Contact, Location, Merchant
from app.models.website import Website
from app.modules.merchant_profiling.completeness_service import refresh_completion_cache
from app.modules.websites.service import summarise
from app.db.schemas import qualified

# Profile side vs website side. Address/city are the same on both.
RESTAURANTS = [
    {
        "code": "DEMO-A01", "slug": "olive-and-thyme", "cuisine": "Mediterranean",
        "address": "88 N Lake Ave", "city": "Pasadena", "state": "CA", "zip": "91101",
        "owner": "Elena Marchetti",
        "profile": {"name": "Olive & Thyme", "phone": "(626) 555-0210",
                    "email": "elena@oliveandthyme.demo", "hours": "Mon–Sat 11am–9pm · Closed Sundays"},
        "site": {"name": "Olive & Thyme Mediterranean Kitchen", "phone": "(626) 555-0222",
                 "email": "hello@oliveandthyme.demo", "hours": "Mon–Sun 11am–10pm"},
        "tagline": "Sun-soaked plates from the Mediterranean coast",
        "brand": ("#5B6B2F", "#F7F3E8", "#C0583A"),
        "dishes": [("Lamb Kofta Plate", "$21", "Tzatziki, herbed rice, charred tomato."),
                   ("Whipped Feta & Honey", "$12", "Pistachio, warm pita."),
                   ("Grilled Branzino", "$29", "Lemon, capers, fennel salad.")],
    },
    {
        "code": "DEMO-A02", "slug": "red-lantern-noodle", "cuisine": "Chinese · Noodles",
        "address": "1420 S Atlantic Blvd", "city": "Alhambra", "state": "CA", "zip": "91803",
        "owner": "Kevin Liu",
        "profile": {"name": "Red Lantern Noodle House", "phone": "(626) 555-0301",
                    "email": "kevin@redlantern.demo", "hours": "Tue–Sun 10:30am–9pm · Closed Mondays"},
        "site": {"name": "Red Lantern Noodle Bar", "phone": "(626) 555-0333",
                 "email": "orders@redlantern.demo", "hours": "Daily 10am–10pm"},
        "tagline": "Hand-pulled noodles, made fresh every morning",
        "brand": ("#B3261E", "#FFF8F0", "#E0A526"),
        "dishes": [("Beef Noodle Soup", "$15", "Braised shank, bok choy, chili oil."),
                   ("Dan Dan Noodles", "$13", "Pork, peanut, Sichuan pepper."),
                   ("Pork & Chive Dumplings", "$11", "Ten pieces, black vinegar.")],
    },
    {
        "code": "DEMO-A03", "slug": "casa-maiz", "cuisine": "Mexican",
        "address": "3021 E 1st St", "city": "Los Angeles", "state": "CA", "zip": "90063",
        "owner": "Rosa Jiménez",
        "profile": {"name": "Casa Maíz", "phone": "(323) 555-0412",
                    "email": "rosa@casamaiz.demo", "hours": "Mon–Sun 8am–8pm"},
        "site": {"name": "Casa Maíz Taquería", "phone": "(323) 555-0499",
                 "email": "info@casamaiz.demo", "hours": "Mon–Thu 8am–9pm · Fri–Sun 8am–11pm"},
        "tagline": "Heirloom corn tortillas pressed to order",
        "brand": ("#1D6A57", "#FFF6E5", "#E8772E"),
        "dishes": [("Al Pastor Tacos", "$12", "Pineapple, onion, cilantro, salsa roja."),
                   ("Mole Enchiladas", "$17", "Chicken, mole poblano, queso fresco."),
                   ("Elote", "$7", "Mayo, cotija, chile, lime.")],
    },
    {
        "code": "DEMO-A04", "slug": "copper-kettle-diner", "cuisine": "American · Diner",
        "address": "560 W Main St", "city": "Alhambra", "state": "CA", "zip": "91801",
        "owner": "Frank Doyle",
        "profile": {"name": "Copper Kettle Diner", "phone": "(626) 555-0520",
                    "email": "frank@copperkettle.demo", "hours": "Daily 6am–3pm"},
        "site": {"name": "The Copper Kettle", "phone": "(626) 555-0555",
                 "email": "hello@copperkettle.demo", "hours": "Mon–Fri 6am–2pm · Sat–Sun 7am–3pm"},
        "tagline": "All-day breakfast since 1987",
        "brand": ("#9C4A1A", "#FFF9F2", "#2E5E8C"),
        "dishes": [("Buttermilk Pancakes", "$11", "Whipped butter, maple syrup."),
                   ("Country Fried Steak", "$16", "Sausage gravy, two eggs, hash browns."),
                   ("Patty Melt", "$14", "Rye, Swiss, grilled onions.")],
    },
    {
        "code": "DEMO-A05", "slug": "sakura-sushi-bar", "cuisine": "Japanese · Sushi",
        "address": "2100 Sawtelle Blvd", "city": "Los Angeles", "state": "CA", "zip": "90025",
        "owner": "Hiro Tanaka",
        "profile": {"name": "Sakura Sushi", "phone": "(310) 555-0630",
                    "email": "hiro@sakurasushi.demo", "hours": "Tue–Sun 5pm–10pm · Closed Mondays"},
        "site": {"name": "Sakura Sushi Bar", "phone": "(310) 555-0666",
                 "email": "reservations@sakurasushi.demo", "hours": "Tue–Sun 12pm–2:30pm, 5pm–10:30pm"},
        "tagline": "Omakase and rolls on Sawtelle",
        "brand": ("#2B2D42", "#FDF6F6", "#E26D8C"),
        "dishes": [("Chef's Omakase", "$85", "Twelve pieces, seasonal fish."),
                   ("Spicy Tuna Crispy Rice", "$14", "Jalapeño, eel sauce."),
                   ("Salmon Aburi Roll", "$17", "Torched salmon, yuzu mayo.")],
    },
]


def website_values(r: dict, name: str) -> dict:
    s = r["site"]
    primary, secondary, accent = r["brand"]
    city_line = f"{r['city']}, {r['state']} {r['zip']}"
    domain = r["profile"]["email"].split("@", 1)[1]
    order = f"https://order.{domain}"
    return {
        "business": {
            "name": name, "tagline": r["tagline"], "email": s["email"], "phone": s["phone"],
            "address": r["address"], "city": city_line, "country": "United States", "hours": s["hours"],
        },
        "brand": {"primary": primary, "secondary": secondary, "accent": accent,
                  "textColor": "#1F2933", "headingFont": "Playfair Display", "bodyFont": "Inter"},
        "hero": {"headline": r["tagline"], "subtext": f"{r['cuisine']} in {r['city']}.",
                 "ctaLabel": "Order Online", "ctaLink": order},
        "about": {"eyebrow": "Our story", "heading": f"Welcome to {name}",
                  "story": f"{name} is a neighbourhood {r['cuisine'].lower()} spot in {r['city']}."},
        "offerings": {"heading": "Favourites", "intro": "A few of the dishes regulars order most.",
                      "ctaLink": order,
                      "items": [{"name": n, "price": p, "description": d} for n, p, d in r["dishes"]]},
        "orderUrl": order,
        "contact": {"heading": "Visit us", "mapAddress": f"{r['address']}, {city_line}"},
        "meta": {"title": f"{name} | {r['cuisine']} in {r['city']}, {r['state']}",
                 "description": r["tagline"]},
    }


async def _taken(db, code: str, slug: str) -> bool:
    m = await db.scalar(select(Merchant.id).where(Merchant.merchant_code == code))
    w = await db.scalar(select(Website.id).where(Website.slug == slug))
    return bool(m or w)


async def _next_free(db):
    """First restaurant (then numbered copies) whose code AND slug are both free."""
    n = 1
    while True:
        for r in RESTAURANTS:
            suffix = "" if n == 1 else f"-{n}"
            code, slug = r["code"] + suffix, r["slug"] + suffix
            if not await _taken(db, code, slug):
                return r, code, slug, ("" if n == 1 else f" {n}")
        n += 1


async def add_one() -> None:
    async with SessionLocal() as db:
        r, code, slug, label = await _next_free(db)
        p = r["profile"]

        merchant = Merchant(merchant_code=code, source="SAMPLE")
        merchant.restaurant_name = p["name"] + label
        merchant.cuisine_category = r["cuisine"]
        merchant.account_health = AccountHealth.GREEN
        merchant.location_count = 1
        merchant.notes = "Demo merchant (scripts.seed_demo_add_pair) — not linked; link it to its website to see conflicts."
        db.add(merchant)
        await db.flush()

        loc = Location(merchant_id=merchant.id, is_primary=True)
        loc.address = r["address"]
        loc.city, loc.state, loc.zip = r["city"], r["state"], r["zip"]
        loc.hours = p["hours"]
        loc.timezone = "America/Los_Angeles"
        db.add(loc)

        owner = Contact(merchant_id=merchant.id, role=ContactRole.OWNER)
        owner.name, owner.phone, owner.email, owner.language = r["owner"], p["phone"], p["email"], "en"
        db.add(owner)

        site_name = r["site"]["name"] + label
        values = copy.deepcopy(website_values(r, site_name))
        site = Website(slug=slug)
        site.values = values
        for col, v in summarise(values).items():
            setattr(site, col, v)
        site.status = "in_creation"
        site.merchant_id = None
        site.notes = f"Demo website (scripts.seed_demo_add_pair) — unassigned; link it to {merchant.restaurant_name} ({code})."
        db.add(site)

        await db.commit()
        await refresh_completion_cache(db, merchant.id)

    print(f"[seed:pair] merchant added: {merchant.restaurant_name} ({code})")
    print(f"[seed:pair] website  added: {site_name} (/{slug}) — In creation, NOT linked")
    print("[seed:pair]   conflicts when linked:")
    for field in ("name", "phone", "email", "hours"):
        prof = merchant.restaurant_name if field == "name" else p[field]
        web = site_name if field == "name" else r["site"][field]
        print(f"[seed:pair]     {field:<6} Profile: {prof:<42} Website: {web}")


async def main() -> None:
    count = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else 1
    async with SessionLocal() as db:
        has_col = await db.scalar(text(
            "select count(*) from information_schema.columns "
            f"where table_schema='{qualified('marketing')}' and table_name='website' and column_name='merchant_id'"
        ))
    if not has_col:
        sys.exit("[seed:pair] marketing.website.merchant_id is missing — run `alembic upgrade head` first.")
    for _ in range(max(1, count)):
        await add_one()
    print("[seed:pair] Link them in the Super App: Websites → 'Unassigned only' → link icon.")


if __name__ == "__main__":
    asyncio.run(main())
