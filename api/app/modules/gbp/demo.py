"""Sample Google Business Profile data (source = DEMO) so the GBP pages can be
used before Google approves API access. Loaded from the GBP page ("Load sample
data", managers) or `python -m scripts.seed_gbp_demo`; the first real sync
deletes it. Deterministic: every load gives the same 150 listings."""
from __future__ import annotations

import datetime as dt
import math
import random

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.models.auth import User
from app.models.common import cuid
from app.models.gbp import (
    GbpDailyMetric,
    GbpLocation,
    GbpNote,
    GbpPost,
    GbpReview,
    GbpSearchKeyword,
    utcnow,
)
from app.modules.gbp import profile
from app.modules.gbp.sync import complete_months  # noqa: E402

class DemoRefused(RuntimeError):
    pass


COUNT = 150
LAG_DAYS = 3  # Google publishes daily numbers a few days late
MAX_HISTORY = 540

CUISINES = {
    "South Asian": ["biryani near me", "indian restaurant near me", "halal restaurant near me", "best karahi near me",
                    "desi food near me", "tandoori chicken near me", "pakistani restaurant", "nihari near me",
                    "restaurant open now", "family restaurant near me", "chicken tikka masala", "naan near me"],
    "Mediterranean": ["mediterranean restaurant near me", "shawarma near me", "falafel near me", "halal restaurant near me",
                      "gyro near me", "hummus restaurant", "kebab near me", "mediterranean grill", "restaurant open now",
                      "healthy food near me", "chicken shawarma plate", "lamb kebab"],
    "Middle Eastern": ["shawarma near me", "halal restaurant near me", "arabic restaurant near me", "best kebab near me",
                       "mandi near me", "middle eastern food", "kabob house near me", "grill restaurant near me",
                       "restaurant open now", "late night food near me", "kunafa near me", "falafel wrap"],
    "Turkish": ["turkish restaurant near me", "doner kebab near me", "best kebab near me", "halal restaurant near me",
                "baklava near me", "turkish grill", "adana kebab near me", "kebab house", "restaurant open now",
                "mediterranean restaurant", "lahmacun near me", "turkish breakfast"],
}
CATEGORY = {"South Asian": "Indian restaurant", "Mediterranean": "Mediterranean restaurant",
            "Middle Eastern": "Middle Eastern restaurant", "Turkish": "Turkish restaurant"}
NAME_A = ["Cairo", "Royal", "Punjabi", "Urban", "Paradise", "Spice", "Bombay", "Lahori", "Desi", "Golden", "Sultan's",
          "Olive", "Saffron", "Karachi", "Istanbul", "Damascus", "Anatolia", "Zaad", "Marhaba", "Noor", "Crescent",
          "Silk Road", "Kabul", "Byblos", "Petra", "Aroma", "Casbah", "Levant", "Mint", "Zaytoon"]
NAME_B = ["Grill", "Kitchen", "Tandoor", "Biryani", "Grillhouse", "Garden", "House", "Dhaba", "Kabob", "Shawarma",
          "Charcoal", "Bistro", "Eatery", "Corner", "Express"]
EXTRA = ["Kabob Fusion", "Mediterranean Grillhouse", "Falafel House", "Curry Garden", "Tandoori Kitchen", "Shawarma Grill",
         "Urban Biryani", "Paradise Biryani", "Zaad Mediterranean", "Spice Garden"]
CITIES = [("San Jose", "95112"), ("Fremont", "94538"), ("Sunnyvale", "94086"), ("Milpitas", "95035"),
          ("Santa Clara", "95050"), ("Dublin", "94568"), ("Pleasanton", "94566"), ("Sacramento", "95815"),
          ("Fresno", "93721"), ("Tracy", "95376"), ("Hayward", "94541"), ("San Ramon", "94583"),
          ("Elk Grove", "95624"), ("Modesto", "95354"), ("Stockton", "95202"), ("Concord", "94520"),
          ("Livermore", "94550"), ("Union City", "94587"), ("Cupertino", "95014"), ("Newark", "94560")]
STREETS = ["Mission Blvd", "El Camino Real", "Stevens Creek Blvd", "Fremont Blvd", "Warm Springs Blvd", "Main St",
           "Washington Blvd", "Thornton Ave", "Blossom Hill Rd", "Capitol Expy", "Dublin Blvd", "Pacific Ave"]
POST_TITLES = ["Weekend Special", "New Menu Items", "Holiday Hours", "Fresh Daily Specials", "Now Serving Lunch Buffet",
               "Catering Available", "Family Platter Deal", "Ramadan Hours", "Grand Opening Update", "Chef's Special"]
OFFERS = ["10% Off Family Platters", "Free Drink with Lunch Combo", "Buy 1 Get 1 Wraps", "Weekend Buffet Deal",
          "Student Discount 15%", "Free Delivery over $30"]
REVIEWERS = ["Ayesha K.", "Daniel R.", "Priya S.", "Omar F.", "Jessica L.", "Hamza A.", "Maria G.", "Bilal T.",
             "Chris P.", "Fatima Z.", "Kevin N.", "Sana M.", "Luis H.", "Noor E.", "Emily W.", "Yusuf B."]
COMMENTS = {
    5: ["Amazing food and friendly staff. The biryani was perfect.", "Best kebabs in the area, will be back!",
        "Generous portions and fast service.", "Family loved everything we ordered."],
    4: ["Great food, a bit of a wait on Friday night.", "Tasty and fresh, parking is tight.", "Good value for the price."],
    3: ["Food was okay, service was slow.", "Decent but not as good as last time."],
    2: ["Order was missing an item and the food was cold.", "Too salty for us this time."],
    1: ["Waited 45 minutes and nobody checked on us.", "Very disappointed with the delivery order."],
}
DESCRIPTIONS = ["Family-owned restaurant serving authentic dishes made fresh every day. Dine in, take out, catering.",
                "Halal kitchen known for charcoal-grilled kebabs, fresh bread and generous family platters."]


def _names() -> list[str]:
    names = list(EXTRA)
    for a in NAME_A:
        for b in NAME_B:
            n = f"{a} {b}"
            if n not in names:
                names.append(n)
            if len(names) >= COUNT:
                return names
    return names[:COUNT]


def build(today: dt.date) -> list[dict]:
    through = today - dt.timedelta(days=LAG_DAYS)
    out = []
    for i, name in enumerate(_names()):
        r = random.Random(f"loc:{name}")
        cuisine = r.choice(list(CUISINES))
        city, zipc = CITIES[r.randrange(len(CITIES))]
        roll = r.random()
        tier = "high" if roll < 0.18 else "average" if roll < 0.62 else "low" if roll < 0.88 else "new"
        age = 10 + r.randrange(50) if tier == "new" else min(MAX_HISTORY, 120 + r.randrange(660))
        added = through - dt.timedelta(days=age)

        open_status = "OPEN"
        if tier != "new" and r.random() < 0.08:
            open_status = "CLOSED_TEMPORARILY"
        elif tier != "new" and r.random() < 0.03:
            open_status = "CLOSED_PERMANENTLY"

        sync = "ok"
        if i % 23 == 4:
            sync = "failed"
        elif i % 19 == 7:
            sync = "delayed"
        last_day = through - dt.timedelta(days=6 if sync == "failed" else 3 if sync == "delayed" else 0)

        v = r.random()
        verification = "pending" if tier == "new" and v < 0.5 else "verified" if v < 0.86 else "pending" if v < 0.94 else "required"

        base = {
            "high": dict(website=34, calls=18, directions=26, menu=22, search=320, maps=260),
            "average": dict(website=15, calls=8, directions=12, menu=9, search=150, maps=120),
            "low": dict(website=5, calls=2, directions=4, menu=3, search=55, maps=40),
            "new": dict(website=9, calls=4, directions=7, menu=5, search=90, maps=75),
        }[tier]
        skew = "search" if r.random() < 0.25 else "maps" if r.random() < 0.5 else "balanced"
        zero = "calls" if i % 31 == 9 else "website" if i % 37 == 11 else None
        mobile_share = 0.55 + r.random() * 0.28

        comp = r.random()
        completeness = 1.0 if comp < 0.3 else 0.8 if comp < 0.75 else 0.5
        has = lambda: r.random() < completeness  # noqa: E731
        slug = name.lower().replace("'", "").replace(" ", "")
        loc = dict(
            google_location_id=f"locations/demo{100000 + i}",
            google_account_id="accounts/demo",
            source="DEMO",
            store_code=f"{1000000000000000 + i * 7919:016d}",
            title=f"{name}",
            address_line=f"{100 + r.randrange(9800)} {r.choice(STREETS)}",
            city=city,
            state="CA",
            postal_code=zipc,
            country="US",
            phone=f"({r.choice(['408', '510', '650', '916', '559', '209'])}) 555-{1000 + i:04d}",
            website_url=f"https://www.{slug}.com" if r.random() < 0.97 else None,
            primary_category=CATEGORY[cuisine],
            additional_categories=["Halal restaurant", "Takeout restaurant"] if has() else [],
            regular_hours=[{"day": d, "open": "11:00", "close": "22:00", "closeDay": d}
                           for d in ("MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY")] if r.random() < 0.97 else [],
            description=r.choice(DESCRIPTIONS) if has() else None,
            attribute_count=6 + r.randrange(10) if has() else 0,
            menu_url=f"https://www.{slug}.com/menu" if has() else None,
            ordering_url=f"https://order.{slug}.com" if has() else None,
            social_links=[f"https://instagram.com/{slug}"] if has() else [],
            photo_count=r.randrange(8, 120) if r.random() < 0.95 else 0,
            has_logo=has(),
            has_cover=has(),
            maps_uri=f"https://maps.google.com/?cid={10**15 + i}",
            open_status=open_status,
            verification=verification,
            sync_error="Google returned an error (500). The next sync will retry." if sync == "failed" else None,
        )
        out.append(dict(loc=loc, tier=tier, added=added, last_day=last_day, base=base, skew=skew, zero=zero,
                        mobile_share=mobile_share, cuisine=cuisine, seed=i, name=name))
    return out


def daily_rows(spec: dict, loc_id: str) -> list[dict]:
    rows = []
    days = (spec["last_day"] - spec["added"]).days + 1
    closed = spec["loc"]["open_status"] != "OPEN"
    for k in range(days):
        d = spec["added"] + dt.timedelta(days=k)
        r = random.Random(f"d:{spec['name']}:{k}")
        dow = d.weekday()  # Mon=0
        weekday = 1.35 if dow in (4, 5) else 1.15 if dow == 6 else 0.92 + dow * 0.02
        ramp = min(1.0, k / 35) if spec["tier"] == "new" else 1.0
        activity = max(0.03, 0.3 - (k / days) * 0.3) if closed else 1.0
        trend = 1 + math.sin(k / 28) * 0.12 + (k / days * 0.15 if spec["tier"] == "high" else 0)

        def mk(b: float) -> int:
            return max(0, round(b * weekday * ramp * activity * trend * (0.55 + r.random() * 0.9)))

        b = spec["base"]
        search = mk(b["search"] * (1.5 if spec["skew"] == "search" else 0.7 if spec["skew"] == "maps" else 1))
        maps = mk(b["maps"] * (1.5 if spec["skew"] == "maps" else 0.7 if spec["skew"] == "search" else 1))
        ms = spec["mobile_share"]
        recent = k > days - 45
        rows.append({
            "location_id": loc_id,
            "date": d,
            "impressions_mobile_search": round(search * ms),
            "impressions_desktop_search": search - round(search * ms),
            "impressions_mobile_maps": round(maps * min(0.95, ms + 0.1)),
            "impressions_desktop_maps": maps - round(maps * min(0.95, ms + 0.1)),
            "website_clicks": 0 if spec["zero"] == "website" and recent else mk(b["website"]),
            "call_clicks": 0 if spec["zero"] == "calls" and recent else mk(b["calls"]),
            "direction_requests": mk(b["directions"]),
            "menu_clicks": mk(b["menu"]),
            "food_orders": mk(b["menu"] * 0.35),
            "bookings": 0,
            "conversations": 0,
        })
    return rows


def reviews(spec: dict, loc_id: str, today: dt.date) -> list[dict]:
    r = random.Random(f"rev:{spec['name']}")
    target = 3.5 + r.random() * 1.4
    per_week = {"high": 3 + r.random() * 3, "average": 1 + r.random() * 1.6, "new": 0.8 + r.random() * 1.2}.get(spec["tier"], 0.15 + r.random() * 0.6)
    dry = spec["seed"] % 29 == 6
    out = []
    t = dt.datetime.combine(spec["added"], dt.time(12), tzinfo=dt.timezone.utc) + dt.timedelta(days=r.random() * 5)
    end = dt.datetime.combine(today, dt.time(0), tzinfo=dt.timezone.utc)
    n = 0
    while t < end:
        if not (dry and t > end - dt.timedelta(days=75)):
            roll = r.random()
            p5 = min(0.85, max(0.1, (target - 3.2) / 1.8))
            stars = 5 if roll < p5 else 4 if roll < p5 + 0.22 else 3 if roll < p5 + 0.32 else 2 if roll < p5 + 0.38 else 1
            replied = r.random() < (0.85 if stars >= 4 else 0.55)
            out.append({
                "id": cuid(),
                "location_id": loc_id,
                "google_review_id": f"demo/{spec['loc']['google_location_id']}/r{n}",
                "star_rating": stars,
                "comment": r.choice(COMMENTS[stars]) if r.random() < 0.8 else None,
                "reviewer_name": r.choice(REVIEWERS),
                "create_time": t,
                "update_time": t,
                "has_reply": replied,
                "reply_time": t + dt.timedelta(hours=6 + r.random() * 60) if replied else None,
            })
            n += 1
        t += dt.timedelta(days=(7 / max(per_week, 0.05)) * (0.4 + r.random() * 1.3))
    return out


def posts(spec: dict, loc_id: str, today: dt.date) -> list[dict]:
    r = random.Random(f"post:{spec['name']}")
    tier = spec["tier"]
    count = 6 + r.randrange(7) if tier == "high" else 2 + r.randrange(5) if tier == "average" else r.randrange(3) if tier == "new" else r.randrange(2)
    stale = spec["seed"] % 27 == 13
    age = (today - spec["added"]).days
    out = []
    for p in range(count):
        ago = 45 + r.randrange(max(1, int(age * 0.6))) if stale else r.randrange(max(1, min(age, 180)))
        created = dt.datetime.combine(today - dt.timedelta(days=ago), dt.time(15), tzinfo=dt.timezone.utc)
        out.append({
            "id": cuid(), "location_id": loc_id, "google_post_id": f"demo/{spec['loc']['google_location_id']}/p{p}",
            "topic_type": "STANDARD", "title": r.choice(POST_TITLES), "summary": None,
            "state": "LIVE" if r.random() < 0.9 else "REJECTED", "create_time": created,
            "start_date": None, "end_date": None, "coupon_code": None, "search_url": None,
        })
    for p in range(r.randrange(4)):
        start = today - dt.timedelta(days=r.randrange(90) - 20)
        out.append({
            "id": cuid(), "location_id": loc_id, "google_post_id": f"demo/{spec['loc']['google_location_id']}/o{p}",
            "topic_type": "OFFER", "title": r.choice(OFFERS), "summary": "Limited-time offer available in-store and online.",
            "state": "LIVE", "create_time": dt.datetime.combine(start - dt.timedelta(days=2), dt.time(10), tzinfo=dt.timezone.utc),
            "start_date": start, "end_date": start + dt.timedelta(days=14 + r.randrange(30)),
            "coupon_code": "SAVE10" if r.random() < 0.4 else None, "search_url": None,
        })
    return out


def keywords(spec: dict, loc_id: str, today: dt.date) -> list[dict]:
    out = []
    monthly_search = spec["base"]["search"] * 30
    for mi, month in enumerate(complete_months(today)):
        if month < spec["added"].replace(day=1):
            continue
        r = random.Random(f"kw:{spec['name']}:{month}")
        for qi, q in enumerate(CUISINES[spec["cuisine"]]):
            v = round(monthly_search / 14 * (1.6 - qi * 0.12) * (0.7 + r.random() * 0.7) * (0.9 + mi * 0.05) / 10)
            out.append({"location_id": loc_id, "month": month, "keyword": q,
                        "impressions": v if v >= 15 else None, "threshold": 15 if v < 15 else None})
    return out


async def remove(db) -> int:
    n = (await db.execute(select(func.count()).select_from(GbpLocation).where(GbpLocation.source == "DEMO"))).scalar_one()
    await db.execute(delete(GbpLocation).where(GbpLocation.source == "DEMO"))
    await db.commit()
    return n


async def load(db, today: dt.date) -> dict:
    real = (await db.execute(select(func.count()).select_from(GbpLocation).where(GbpLocation.source == "GOOGLE"))).scalar_one()
    if real:
        raise DemoRefused(f"{real} real listings are already synced from Google — sample data isn't loaded next to real data.")
    if (await db.execute(select(func.count()).select_from(GbpLocation).where(GbpLocation.source == "DEMO"))).scalar_one():
        raise DemoRefused("Sample listings are already loaded.")
    author = (await db.execute(select(User).order_by(User.created_at).limit(1))).scalar_one_or_none()
    totals = dict(listings=0, days=0, reviews=0, posts=0, keywords=0)
    now = utcnow()
    for spec in build(today):
        loc = GbpLocation(**spec["loc"], first_seen_at=now, last_synced_at=now - dt.timedelta(hours=3 if not spec["loc"]["sync_error"] else 100))
        db.add(loc)
        await db.flush()
        days = daily_rows(spec, loc.id)
        for c in range(0, len(days), 1000):
            await db.execute(pg_insert(GbpDailyMetric).values(days[c : c + 1000]))
        loc.last_metrics_date = spec["last_day"]
        revs = reviews(spec, loc.id, today)
        for c in range(0, len(revs), 1000):
            await db.execute(pg_insert(GbpReview).values(revs[c : c + 1000]))
        if revs:
            loc.review_count = len(revs)
            loc.rating_average = round(sum(x["star_rating"] for x in revs) / len(revs), 2)
        ps = posts(spec, loc.id, today)
        if ps:
            await db.execute(pg_insert(GbpPost).values(ps))
        kws = keywords(spec, loc.id, today)
        if kws:
            await db.execute(pg_insert(GbpSearchKeyword).values(kws))
        loc.profile_fields = profile.compute(loc)
        if author and spec["seed"] in (3, 8, 14, 21):
            body = {
                3: "Menu link updated mid-month — expect a dip in menu clicks.",
                8: "Profile was suspended by Google for 3 days, restored after appeal.",
                14: "Weekend staffing shortage affected calls and orders.",
                21: "Owner asked for a refreshed cover photo; waiting on the design team.",
            }[spec["seed"]]
            db.add(GbpNote(location_id=loc.id, author_id=author.id, body=body, created_at=now - dt.timedelta(days=spec["seed"] % 12 + 1)))
        await db.flush()
        totals["listings"] += 1
        totals["days"] += len(days)
        totals["reviews"] += len(revs)
        totals["posts"] += len(ps)
        totals["keywords"] += len(kws)
    # One commit: the pages never see a half-loaded sample set.
    await db.commit()
    return totals


