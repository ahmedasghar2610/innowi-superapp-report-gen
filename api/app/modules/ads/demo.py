"""Sample Google Ads data (source = DEMO) so the Ads pages can be used before
Google Ads is connected. Loaded from the Ads page ("Load sample data",
managers) or `python -m scripts.seed_ads_demo`; the first real sync deletes
it. Deterministic: every load gives the same accounts.

Demo accounts aren't linked to real merchants (that would touch Profiling);
`demo_profile` stands in for the Profile values (approved budget, ads paid by,
address, phone) and `mapped` says whether the account behaves as linked.
"""
from __future__ import annotations

import datetime as dt
import random

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.models.ads import AdsAccount, AdsAsset, AdsCampaign, AdsComment, AdsDailyMetric, utcnow
from app.models.common import cuid


class DemoRefused(RuntimeError):
    pass


HISTORY_DAYS = 400

# name, city, cuisine, paid by, monthly budget, campaigns [(name, daily budget, status)], target ROAS
ACCOUNTS = [
    ("Harbor Point Seafood", "Boston, MA 02210", "seafood", "Merchant", 1860, [("Coastal PMax", 60, "ENABLED")], 6.8),
    ("Prairie Fire Grill", "Dallas, TX 75201", "grill", "Merchant", 1800, [("Steakhouse PMax", 58, "ENABLED")], 0.9),
    ("Brickfire Pizzeria", "Atlanta, GA 30303", "pizza", "Merchant", 1050, [("Pizza Delivery", 20, "ENABLED"), ("Lunch Slices", 14, "ENABLED"), ("Game Night", 10, "PAUSED")], 4.1),
    ("Smokehouse 61", "Memphis, TN 38103", "barbecue", "Merchant", 1350, [("BBQ Catering", 25, "ENABLED"), ("Family Packs", 20, "ENABLED")], 3.4),
    ("Saffron & Smoke", "Baltimore, MD 21202", "indian", "Merchant", 1200, [("Catering Leads", 22, "ENABLED"), ("Weeknight Orders", 18, "ENABLED")], 3.1),
    ("Bella Costa Trattoria", "San Diego, CA 92101", "italian", "Merchant", 1140, [("Trattoria PMax", 37, "ENABLED")], 4.9),
    ("Maple & Rye", "Nashville, TN 37203", "american", "Merchant", 990, [("Brunch PMax", 17, "ENABLED"), ("Dinner PMax", 15, "ENABLED")], 3.6),
    ("Cactus Rose Cantina", "Phoenix, AZ 85004", "mexican", "Merchant", 930, [("Taco Tuesday", 16, "ENABLED"), ("Cantina PMax", 15, "ENABLED")], 5.0),
    ("Copper Kettle Kitchen", "Pittsburgh, PA 15222", "comfort food", "Merchant", 900, [("Kitchen PMax", 30, "ENABLED")], 4.4),
    ("Pier 9 Fish Fry", "Baltimore, MD 21230", "seafood", "Merchant", 660, [("Fish Fry PMax", 30, "ENABLED")], 3.8),
    ("Sakura Ramen House", "Seattle, WA 98104", "ramen", "Innowi", 840, [("Ramen PMax", 27, "ENABLED")], 4.2),
    ("Golden Wok Express", "New Orleans, LA 70112", "chinese", "Merchant", 900, [("Wok PMax", 18, "ENABLED")], 4.8),
    ("Nonna's Table", "Providence, RI 02903", "italian", "Innowi", 300, [("Nonna PMax", 15, "ENABLED")], 4.1),
    ("The Rolling Pin Bakery", "Portland, OR 97204", "bakery", "Innowi", 450, [("Bakery PMax", 15, "PAUSED")], 3.3),
    ("Blue Lotus Thai", "Kansas City, MO 64108", "thai", "Innowi", 600, [("Awareness PMax", 20, "ENABLED")], 0.0),
    ("El Farolito Cantina", "San Francisco, CA 94110", "mexican", "Merchant", 750, [("Burrito PMax", 25, "ENABLED")], 5.0),
    ("Olive & Thyme", "Chicago, IL 60601", "mediterranean", "Merchant", 1200, [("Mezze PMax", 40, "ENABLED")], 2.9),
    ("Lahori Grillhouse", "Santa Clara, CA 95050", "pakistani", "Merchant", 1500, [("Karahi PMax", 30, "ENABLED"), ("Catering Search", 20, "ENABLED")], 5.6),
    ("Spice Route Biryani", "Fremont, CA 94538", "indian", "Innowi", 780, [("Biryani PMax", 26, "ENABLED")], 6.1),
    ("Kabul Kabob House", "Sunnyvale, CA 94086", "afghan", "Merchant", 690, [("Kabob PMax", 23, "ENABLED")], 2.2),
    ("Istanbul Doner", "Sacramento, CA 95815", "turkish", "Merchant", 540, [("Doner PMax", 18, "ENABLED")], 1.4),
    ("Zaytoon Mezze Bar", "Dublin, CA 94568", "mediterranean", "Innowi", 600, [("Mezze Bar PMax", 20, "ENABLED")], 3.9),
    ("Bombay Street Kitchen", "Milpitas, CA 95035", "indian", "Merchant", 960, [("Street Food PMax", 32, "ENABLED")], 7.4),
    ("Casa Miranda", "Miami, FL 33139", "cuban", "Innowi", 660, [("Casa PMax", 22, "PAUSED")], 0.0),
]
ARCHIVED = [("Old Mill Chophouse", "Pittsburgh, PA 15222", "steakhouse", "Merchant", 800, [("Chophouse PMax", 26, "PAUSED")], 3.0)]
UNMAPPED = [
    ("Riverside Grill - Downtown", [("Riverside PMax", 20, "ENABLED")], 2.4),
    ("Lakeside Bistro & Bar", [("Bistro PMax", 15, "ENABLED"), ("Bar Search", 16, "ENABLED")], 3.0),
    ("Urban Spice Co", [("Spice PMax", 9, "ENABLED")], 1.8),
    ("Sunset Poke Bar", [("Poke PMax", 14, "ENABLED")], 3.3),
    ("Test Account - Do Not Use", [], 0.0),
]
VERIFY = {"Smokehouse 61": ("failed", "Verification failed on Aug 09. The submitted business document did not match the advertiser name on the account. Resubmit with matching documentation."),
          "Saffron & Smoke": ("required", "Google requires business verification documents for this advertiser account. Submit proof of business registration to continue serving ads without restriction."),
          "Pier 9 Fish Fry": ("required", "Google requires advertiser verification. Start it in Google Ads (Billing → Advertiser verification)."),
          "Casa Miranda": ("required", "Google requires advertiser verification. Start it in Google Ads (Billing → Advertiser verification)."),
          "Kabul Kabob House": ("pending", "Documents submitted; Google is reviewing them.")}
SYNC_ISSUE = {"El Farolito Cantina"}
STREETS = ["Dockside Way", "Main St", "Market St", "Grand Blvd", "Mission St", "Beale St", "Commerce St", "Pacific Ave", "Elm St", "Union Sq"]
PROMOS = [("Family meal", 20, "FAMILY20"), ("First online order", 15, "WELCOME15"), ("Lunch combo", 10, "LUNCH10")]


def _cid(i: int) -> str:
    return f"9{(i * 7919 + 1234567) % 1_000_000_000:09d}"


def _short(name: str) -> str:
    return name.split(" ")[0].replace("'", "")


async def load(db, today: dt.date) -> dict:
    real = (await db.execute(select(func.count()).select_from(AdsAccount).where(AdsAccount.source != "DEMO"))).scalar_one()
    if real:
        raise DemoRefused("Real Google Ads accounts are already loaded — sample data is only for trying the pages before the first sync.")
    await remove(db)
    through = today - dt.timedelta(days=1)
    start = through - dt.timedelta(days=HISTORY_DAYS - 1)
    totals = {"accounts": 0, "campaigns": 0, "days": 0}
    idx = 0
    specs = [(a, "active", True) for a in ACCOUNTS] + [(a, "archived", True) for a in ARCHIVED]
    specs += [((n, None, "restaurant", None, None, c, t), "active", False) for n, c, t in UNMAPPED]
    for (name, city, cuisine, paid_by, budget, camps, target), state, mapped in specs:
        idx += 1
        r = random.Random(f"ads:{name}")
        ticket = round(25 + r.random() * 50, 2)
        orders = 80 + r.randrange(600)
        verification, vmsg = VERIFY.get(name, ("verified", None))
        acc = AdsAccount(
            id=cuid(),
            customer_id=_cid(idx),
            name=name,
            manager_customer_id="9000000000",
            source="DEMO",
            state=state,
            google_status="ENABLED",
            currency_code="USD",
            time_zone="America/Los_Angeles",
            ticket_total_sales=round(ticket * orders, 2) if (mapped or r.random() < 0.5) and name != "Test Account - Do Not Use" else None,
            ticket_order_count=orders,
            ticket_updated_at=utcnow(),
            verification=verification if mapped else "unknown",
            verification_message=vmsg,
            demo_profile={
                "mapped": mapped,
                "approvedBudget": budget,
                "adsPaidBy": paid_by,
                "address": f"{10 + r.randrange(3000)} {r.choice(STREETS)}, {city}" if city else None,
                "city": city,
                "phone": f"({r.randrange(200, 989)}) 555-{r.randrange(100, 199):04d}" if city else None,
                "cuisine": cuisine,
            },
            first_seen_at=utcnow(),
            last_synced_at=utcnow() - dt.timedelta(hours=74 if name in SYNC_ISSUE else 2),
            last_metrics_date=through,
            sync_error="Data has not synced successfully from Google Ads recently." if name in SYNC_ISSUE else None,
        )
        db.add(acc)
        totals["accounts"] += 1
        await db.flush()
        rows = []
        for ci, (cname, daily, status) in enumerate(camps):
            c = AdsCampaign(
                id=cuid(), account_id=acc.id, google_campaign_id=str(20_000_000 + idx * 10 + ci), name=f"{_short(name)} — {cname}",
                status=status, channel_type="SEARCH" if "Search" in cname else "PERFORMANCE_MAX", daily_budget=daily,
                start_date=start - dt.timedelta(days=r.randrange(30, 200)), end_date=None,
            )
            db.add(c)
            await db.flush()  # no ORM relationship orders the inserts, so the campaign goes first
            totals["campaigns"] += 1
            paused_from = through - dt.timedelta(days=10 + r.randrange(60)) if status == "PAUSED" else None
            if state == "archived":
                paused_from = through - dt.timedelta(days=70)
            roas = target * (0.75 + r.random() * 0.5)
            d = start
            while d <= through:
                if paused_from and d >= paused_from:
                    d += dt.timedelta(days=1)
                    continue
                season = 1 + 0.15 * (1 if d.weekday() >= 4 else -0.3)
                spend = round(daily * (0.82 + r.random() * 0.22) * season, 2)
                imps = int(spend * (55 + r.random() * 25))
                clicks = int(imps * (0.03 + r.random() * 0.03))
                o = 0.0
                if ticket and roas:
                    exp = spend * roas / ticket
                    o = float(int(exp) + (1 if r.random() < exp - int(exp) else 0))
                rows.append({
                    "campaign_id": c.id, "date": d, "cost": spend, "impressions": imps, "clicks": clicks,
                    "calls": float(r.randrange(0, 4)), "directions": float(r.randrange(0, 7)), "website": float(r.randrange(2, 16)),
                    "orders": o, "menu": float(r.randrange(1, 9)),
                })
                d += dt.timedelta(days=1)
            await _assets(db, acc, c, name, r, ci == 0)
        await db.flush()
        for i in range(0, len(rows), 1000):
            await db.execute(pg_insert(AdsDailyMetric).values(rows[i : i + 1000]))
        totals["days"] += len(rows)
        if name == "Harbor Point Seafood":
            db.add(AdsComment(account_id=acc.id, body="Raised daily budget from $50 to $60 on Jun 1 after the owner approved $1,860/month.", created_at=utcnow(), updated_at=utcnow()))
    await db.commit()
    return totals


async def _assets(db, acc: AdsAccount, c: AdsCampaign, name: str, r: random.Random, first: bool) -> None:
    short = _short(name)
    food = (acc.demo_profile or {}).get("cuisine") or "food"
    city = ((acc.demo_profile or {}).get("city") or "your area").split(",")[0]
    texts = {
        "BUSINESS_NAME": [name],
        "HEADLINE": [name, f"Order {food.title()} Online", f"Fresh {food.title()} Near You", "Order Online Today", "Fast Local Delivery",
                     "Pickup Or Delivery", f"Best {food.title()} In Town", "Order In Minutes", "Family Meals Available", "Fresh Daily"],
        "LONG_HEADLINE": [f"{name} — order {food} online for pickup or delivery", f"Fresh {food} made to order, delivered across {city}",
                          f"Skip the queue and order ahead from {name} today"],
        "DESCRIPTION": [f"Order {food} from {name} for fast local pickup or delivery. Fresh ingredients, prepared to order.",
                        f"Browse the full menu and order online in under two minutes. Serving {city} and surrounding areas.",
                        "Family meals, catering trays and daily specials available. Order online or call ahead.",
                        "Real food, made fresh daily. Pickup ready in 15 minutes."],
    }
    gid = int(c.google_campaign_id) * 100
    n = 0

    def add(**kw):
        nonlocal n
        n += 1
        db.add(AdsAsset(id=cuid(), account_id=acc.id, campaign_id=c.id, google_asset_id=str(gid + n), synced_at=utcnow(), **kw))

    for ft, items in texts.items():
        for t in items:
            add(field_type=ft, kind="text", status="ENABLED", text=t)
    for label, ft, w, h in [("Signature dish", "SQUARE_MARKETING_IMAGE", 1200, 1200), ("Storefront", "MARKETING_IMAGE", 1200, 628),
                            ("Interior", "MARKETING_IMAGE", 1200, 628), ("Fresh ingredients", "SQUARE_MARKETING_IMAGE", 1200, 1200),
                            ("Team", "MARKETING_IMAGE", 1200, 628)]:
        add(field_type=ft, kind="image", status="ENABLED", name=f"{short.lower()}-{label.lower().replace(' ', '-')}.jpg", width=w, height=h, details={"label": label})
    add(field_type="LOGO", kind="logo", status="ENABLED", name=f"{short.lower()}-logo.png", width=1200, height=1200, details={"label": "Square logo"})
    if first:
        add(field_type="YOUTUBE_VIDEO", kind="video", status="ENABLED", name=f"{name} — 15s spot", details={"youtubeId": None})
    slug = short.lower()
    for i, (title, desc, path) in enumerate([("Order Online", "Browse the menu and order in minutes", "order"), ("View Menu", "See our full menu and daily specials", "menu"),
                                              ("Catering", "Trays and party packs for any group size", "catering"), ("Contact Us", "Opening hours, phone and enquiries", "contact")]):
        add(field_type="SITELINK", kind="sitelink", status="PAUSED" if (i == 3 and r.random() < 0.5) else "ENABLED", text=title,
            details={"linkText": title, "description1": desc, "description2": None, "finalUrl": f"https://{slug}.example/{path}"})
    p = PROMOS[r.randrange(len(PROMOS))]
    add(field_type="PROMOTION", kind="promotion", status="ENABLED", text=f"{p[1]}% off on {p[0]}",
        details={"target": p[0], "discount": f"{p[1]}% off", "code": p[2], "startDate": "2026-07-01", "endDate": None, "occasion": None})


async def remove(db) -> int:
    n = (await db.execute(select(func.count()).select_from(AdsAccount).where(AdsAccount.source == "DEMO"))).scalar_one()
    await db.execute(delete(AdsAccount).where(AdsAccount.source == "DEMO"))
    await db.commit()
    return n
