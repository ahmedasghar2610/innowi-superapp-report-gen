"""Sample SEO data (source = DEMO) so every SEO page can be used before
Search Console / GA4 are connected. Loaded from SEO → Connections ("Load sample
data", managers) or `python -m scripts.seed_seo_demo`; the first real sync
removes it. Deterministic: every load gives the same 60 sites.

When the GBP / Ads sample data is loaded too, sample sites are linked to those
sample listings and accounts so the Local SEO and Paid pillars fill in.

Scores, findings and reports are produced by the same code as for real sites
(data.recompute, client_reports) — only the raw numbers are made up.
"""
from __future__ import annotations

import datetime as dt
import math
import random
import re

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ads import AdsAccount
from app.models.auth import User
from app.models.enums import Role, UserStatus
from app.models.gbp import GbpLocation
from app.models.seo import SeoFinding, SeoGa4Daily, SeoGscDaily, SeoGscPage, SeoGscQuery, SeoGscSplit, SeoKeyword, SeoPage, SeoReport, SeoSite, utcnow
from app.modules.seo import client_reports, crawl, data


class DemoRefused(RuntimeError):
    pass


COUNT = 60
HISTORY = 480
LAG = 3  # Search Console publishes days late

NAME_A = ["Olive Grove", "Royal Biryani", "Sea Salt", "Nonna's", "Prairie", "Sizzle", "Bao House", "Blue Ocean", "Taco Loco", "Harvest",
          "Copper Kettle", "Pho Star", "Juniper", "Green Bowl", "Urban Spice", "Smoky Pit", "Habanero", "Sakura", "Kitchen 804", "Cocoa"]
NAME_B = ["Cantina", "Bistro", "BBQ", "Cafe", "Curry Co", "Shack", "Bakehouse", "Pizzeria", "Grill", "Eatery", "Kitchen", "Deli", "Creamery", "Taqueria"]
CITIES = ["Aurora", "Plano", "Riverside", "Tustin", "Weston", "Harborview", "Irving", "Glendale", "Kenmore", "Denton", "Kirkland",
          "Marion", "Bellview", "Concord", "Chandler", "Fremont"]
SEGMENTS = ["Restaurant"] * 7 + ["Cafe", "Bakery", "Food Truck", "Grocery Outlet"]
QUERY_BASE = ["restaurant near me", "food near me", "best {cuisine} near me", "{cuisine} restaurant {city}", "{cuisine} delivery",
              "takeout near me", "{city} restaurants", "catering {city}", "lunch specials near me", "family restaurant {city}",
              "best {dish} near me", "{dish} {city}", "open now restaurants", "late night food {city}", "halal food near me",
              "healthy food near me", "dinner near me", "{cuisine} food", "order {dish} online", "{cuisine} buffet near me"]
CUISINE = {"Cantina": ("mexican", "tacos"), "Taqueria": ("mexican", "burrito"), "Bistro": ("american", "burger"), "BBQ": ("bbq", "brisket"),
           "Cafe": ("cafe", "coffee"), "Curry Co": ("indian", "biryani"), "Shack": ("burger", "burger"), "Bakehouse": ("bakery", "croissant"),
           "Pizzeria": ("pizza", "pizza"), "Grill": ("grill", "kebab"), "Eatery": ("american", "sandwich"), "Kitchen": ("indian", "curry"),
           "Deli": ("deli", "sandwich"), "Creamery": ("ice cream", "ice cream")}
PAGES = [("/", "home"), ("/menu/", "hub"), ("/menu/signature-mains/", "category"), ("/menu/starters/", "category"),
         ("/menu/grill-and-tandoor/", "category"), ("/menu/bowls-and-salads/", "category"), ("/menu/house-special/", "dish"),
         ("/menu/char-platter/", "dish"), ("/menu/garden-bowl/", "dish"), ("/menu/smoked-wings/", "dish"), ("/menu/golden-wrap/", "dish"),
         ("/food-near-me/", "geo"), ("/downtown/", "geo"), ("/best-eats-in-downtown/", "combo"), ("/blog/neighborhood-food-guide/", "blog"),
         ("/catering/", "category")]
PAGE_WEIGHT = [30, 12, 6, 5, 4, 4, 6, 5, 4, 4, 3, 6, 3, 2, 2, 4]


def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower())


def _names(locs: list[GbpLocation]) -> list[dict]:
    """Site identities: GBP sample listings first (linked), then made-up ones."""
    out, used = [], set()
    for loc in locs[:45]:
        dom = crawl.host_of(loc.website_url) if loc.website_url else f"{_slug(loc.title)}.com"
        if dom in used:
            continue
        used.add(dom)
        out.append({"name": loc.title, "domain": dom, "city": loc.city or "Fremont", "gbp": loc.id})
    i = 0
    while len(out) < COUNT:
        r = random.Random(f"seo-name:{i}")
        name = f"{r.choice(NAME_A)} {r.choice(NAME_B)} {r.choice(CITIES)}"
        dom = f"{_slug(name)}.com"
        i += 1
        if dom in used:
            continue
        used.add(dom)
        out.append({"name": name, "domain": dom, "city": name.split()[-1], "gbp": None})
    return out


def _cuisine(name: str) -> tuple[str, str]:
    for k, v in CUISINE.items():
        if k.lower() in name.lower():
            return v
    return ("restaurant", "chicken")


async def remove(db: AsyncSession) -> int:
    n = int((await db.execute(select(func.count()).select_from(SeoSite).where(SeoSite.source == "DEMO"))).scalar_one())
    await db.execute(delete(SeoSite).where(SeoSite.source == "DEMO"))
    await db.commit()
    return n


async def load(db: AsyncSession, today: dt.date) -> dict:
    real = int((await db.execute(select(func.count()).select_from(SeoSite).where(SeoSite.source != "DEMO"))).scalar_one())
    if real:
        raise DemoRefused(f"{real} real sites are already in the SEO module — sample data isn't loaded next to real data.")
    if (await db.execute(select(func.count()).select_from(SeoSite).where(SeoSite.source == "DEMO"))).scalar_one():
        raise DemoRefused("Sample sites are already loaded.")

    locs = list((await db.execute(select(GbpLocation).where(GbpLocation.source == "DEMO").order_by(GbpLocation.title))).scalars())
    ads = list((await db.execute(select(AdsAccount).where(AdsAccount.source == "DEMO", AdsAccount.state == "active").order_by(AdsAccount.name))).scalars())
    staff = list((await db.execute(select(User).where(User.role.in_((Role.ADMIN, Role.MARKETING_MANAGER, Role.MARKETING_EXECUTIVE)),
                                                     User.status == UserStatus.ACTIVE).order_by(User.created_at))).scalars())
    end = today - dt.timedelta(days=LAG)
    now = utcnow()
    totals = {"sites": 0, "gscDays": 0, "pages": 0, "keywords": 0}
    sites: list[SeoSite] = []

    for i, ident in enumerate(_names(locs)):
        r = random.Random(f"seo:{ident['domain']}")
        pkg = "299" if i % 4 == 0 else "199" if i % 4 in (1, 2) else "normal"
        has_gsc = i % 17 != 16
        has_ga4 = i % 11 != 10
        site = SeoSite(
            source="DEMO", name=ident["name"], domain=ident["domain"], home_url=f"https://{ident['domain']}/",
            gsc_property=f"sc-domain:{ident['domain']}" if has_gsc else None, gsc_permission="siteFullUser" if has_gsc else None,
            ga4_property=f"properties/{400000000 + i}" if has_ga4 else None, ga4_name=f"{ident['name']} — GA4" if has_ga4 else None,
            gbp_location_id=ident["gbp"], ads_account_id=ads[i // 3].id if ads and i % 3 == 0 and i // 3 < len(ads) else None,
            segment=SEGMENTS[i % len(SEGMENTS)], package=pkg,
            report_cadence={"299": "monthly", "199": "monthly", "normal": "quarterly"}[pkg],
            report_recipients=[f"owner@{ident['domain']}"] if i % 5 else [],
            owner_id=staff[i % len(staff)].id if staff else None,
            status="paused" if i % 29 == 28 else "active",
            last_synced_at=now - dt.timedelta(hours=2), last_crawl_at=now - dt.timedelta(hours=2),
            last_psi_at=now - dt.timedelta(days=2), last_rank_at=now - dt.timedelta(days=3),
        )
        db.add(site)
        await db.flush()
        sites.append(site)

        # ---------------- Search Console ----------------
        base = 4 + r.random() * 70 if pkg != "299" else 25 + r.random() * 90
        ctr = 0.015 + r.random() * 0.035
        pos = 6 + r.random() * 14
        trend = (r.random() - 0.35) * 0.0012  # per day
        drop = i % 13 == 5  # organic visibility drop in the last ~3 weeks
        gsc_rows: list[dict] = []
        cuisine, dish = _cuisine(ident["name"])
        if has_gsc:
            for d in range(HISTORY):
                day = end - dt.timedelta(days=HISTORY - 1 - d)
                season = 1 + 0.18 * math.sin(2 * math.pi * day.timetuple().tm_yday / 365) + (0.22 if day.weekday() >= 4 else 0)
                v = base * season * (1 + trend * (d - HISTORY))
                if drop and (end - day).days < 22:
                    v *= 0.45
                clicks = max(0, int(round(v * (0.75 + r.random() * 0.5))))
                impr = max(clicks, int(round(clicks / ctr * (0.85 + r.random() * 0.3))))
                gsc_rows.append({"site_id": site.id, "date": day, "clicks": clicks, "impressions": impr, "position": round(pos * (0.9 + r.random() * 0.2), 2)})
            for c in range(0, len(gsc_rows), 1000):
                await db.execute(pg_insert(SeoGscDaily).values(gsc_rows[c : c + 1000]))
            site.last_gsc_date = end
            totals["gscDays"] += len(gsc_rows)

            city = ident["city"]
            brand = [ident["name"].lower(), f"{ident['name'].lower()} menu", f"{ident['name'].lower()} hours"]
            qlist = list(dict.fromkeys(brand + [q.format(cuisine=cuisine, dish=dish, city=city.lower()) for q in QUERY_BASE]))
            m = data.month_start(end)
            for _ in range(4):
                mstart, mend = m, min(data.month_end(m), end)
                tot_c = sum(x["clicks"] for x in gsc_rows if mstart <= x["date"] <= mend)
                tot_i = sum(x["impressions"] for x in gsc_rows if mstart <= x["date"] <= mend)
                if tot_c or tot_i:
                    rq = random.Random(f"q:{ident['domain']}:{m}")
                    weights = [1 / (k + 1) ** 0.9 * (0.8 + rq.random() * 0.4) for k in range(len(qlist))]
                    sw = sum(weights)
                    await db.execute(pg_insert(SeoGscQuery).values([
                        {"site_id": site.id, "month": m, "query": q, "clicks": int(tot_c * 0.7 * w / sw), "impressions": int(tot_i * 0.6 * w / sw),
                         "position": round((1.2 if k < 3 else pos * (0.6 + rq.random() * 0.9)), 2)}
                        for k, (q, w) in enumerate(zip(qlist, weights))
                    ]))
                    pw = sum(PAGE_WEIGHT)
                    await db.execute(pg_insert(SeoGscPage).values([
                        {"site_id": site.id, "month": m, "page": f"https://{ident['domain']}{path}", "clicks": int(tot_c * w / pw * (0.85 + rq.random() * 0.3)),
                         "impressions": int(tot_i * w / pw * (0.85 + rq.random() * 0.3)), "position": round(pos * (0.7 + rq.random() * 0.6), 2)}
                        for (path, _t), w in zip(PAGES, PAGE_WEIGHT)
                    ]))
                    # Device and country split (client report): mostly mobile, mostly US.
                    mob = 0.78 + rq.random() * 0.12
                    split = [("device", "MOBILE", mob * 0.9, mob, pos * 1.05), ("device", "DESKTOP", (1 - mob) * 1.5, (1 - mob) * 0.9, pos * 0.8),
                             ("device", "TABLET", 0.01, 0.01, pos * 1.2), ("country", "USA", 0.97, 0.95, pos), ("country", "IND", 0.01, 0.02, pos * 1.4),
                             ("country", "CAN", 0.01, 0.01, pos * 1.3)]
                    await db.execute(pg_insert(SeoGscSplit).values([
                        {"site_id": site.id, "month": m, "dimension": dim, "key": key, "clicks": int(tot_c * cs), "impressions": int(tot_i * is_),
                         "position": round(ps, 2)} for dim, key, cs, is_, ps in split
                    ]))
                m = data.prev_month(m)

        # ---------------- GA4 ----------------
        if has_ga4:
            broken = i % 19 == 7  # tracking broke a few days ago
            ga_end = today - dt.timedelta(days=1)
            by_day = {x["date"]: x for x in gsc_rows}
            rows = []
            for d in range(HISTORY):
                day = ga_end - dt.timedelta(days=HISTORY - 1 - d)
                if broken and (ga_end - day).days < 5:
                    rows.append({"site_id": site.id, "date": day, "sessions": 0, "users": 0, "engaged_sessions": 0, "key_events": 0,
                                 "organic_sessions": 0, "organic_key_events": 0})
                    continue
                g = by_day.get(day)
                organic = int(round((g["clicks"] if g else base * 0.9) * (0.85 + r.random() * 0.2)))
                sessions = int(organic * (1.6 + r.random() * 0.8)) + 2
                rows.append({"site_id": site.id, "date": day, "sessions": sessions, "users": int(sessions * 0.82), "engaged_sessions": int(sessions * 0.58),
                             "key_events": round(sessions * (0.018 + r.random() * 0.02), 1), "organic_sessions": organic, "organic_key_events": round(organic * 0.025, 1)})
            for c in range(0, len(rows), 1000):
                await db.execute(pg_insert(SeoGa4Daily).values(rows[c : c + 1000]))
            site.last_ga4_date = ga_end

        # ---------------- pages ----------------
        for k, (path, ptype) in enumerate(PAGES):
            url = f"https://{ident['domain']}{path}"
            rp = random.Random(f"p:{url}")
            name = ident["name"]
            title = {"home": f"{name} | {ident['city']}", "hub": f"Menu | {name}", "blog": "Neighborhood food guide — where to eat downtown"}.get(
                ptype, f"{path.strip('/').split('/')[-1].replace('-', ' ').title()} | {name}")
            if rp.random() < 0.22:
                title = f"{title} — Fresh, Local and Made to Order Every Day in {ident['city']}"
            psi = (25 + rp.randrange(70)) if k < 3 else None
            p = SeoPage(
                site_id=site.id, url=url, page_type=ptype, status_code=404 if (i % 23 == 3 and path == "/menu/house-special/") else 200, final_url=url,
                title=title, meta_description=None if rp.random() < 0.18 else f"{title}. Order online for pickup or delivery from {name}.",
                h1_count=0 if rp.random() < 0.08 else 1, canonical=url, noindex=(i % 31 == 12 and path == "/downtown/"),
                word_count=90 + rp.randrange(900) if ptype != "home" else 400 + rp.randrange(400),
                img_total=rp.randrange(2, 14),
                schema_types=(["Restaurant", "BreadcrumbList"] if ptype == "home" and rp.random() < 0.7 else ["BreadcrumbList"] if ptype != "home" else []),
                last_crawl_at=now - dt.timedelta(hours=2),
                index_verdict="NEUTRAL" if (ptype in ("dish", "geo", "blog") and rp.random() < 0.03) else "PASS",
                psi_score=psi, psi_at=now - dt.timedelta(days=2) if psi is not None else None,
                lcp_ms=1200 + rp.randrange(4500) if psi is not None else None, cls=round(rp.random() * 0.3, 3) if psi is not None else None,
                cwv=(("pass" if psi >= 60 else "fail") if rp.random() < 0.7 else "none") if psi is not None else None,
                inspected_at=now - dt.timedelta(days=3),
            )
            p.coverage_state = "Submitted and indexed" if p.index_verdict == "PASS" else "Crawled - currently not indexed"
            p.img_with_alt = p.img_total if rp.random() < 0.7 else max(0, p.img_total - rp.randrange(2, 6))
            db.add(p)
            totals["pages"] += 1

        # ---------------- tracked keywords (positions come from the Search Console terms above) ----------------
        if has_gsc:
            for q in qlist[:6]:
                db.add(SeoKeyword(site_id=site.id, keyword=q, source="manual" if q == ident["name"].lower() else "gsc"))
                totals["keywords"] += 1
        totals["sites"] += 1

    await db.flush()
    for site in sites:
        for p in (await db.execute(select(SeoPage).where(SeoPage.site_id == site.id))).scalars():
            p.issues = crawl.page_issues(data.page_facts(p, site.domain))
        await data.recompute(db, site, today, psi_configured=True, now=now - dt.timedelta(hours=2))
    await db.flush()
    await _workflow_examples(db, staff, now)
    await db.commit()
    await client_reports.auto_assemble(db, today)
    await _report_examples(db, sites, staff, today, now)
    await db.commit()
    return totals


async def _workflow_examples(db: AsyncSession, staff: list[User], now: dt.datetime) -> None:
    """Spread some findings across the workflow so Intelligence shows every state."""
    fs = list((await db.execute(select(SeoFinding).join(SeoSite, SeoSite.id == SeoFinding.site_id).where(SeoSite.source == "DEMO").order_by(SeoFinding.fkey, SeoFinding.site_id))).scalars())
    for n, f in enumerate(fs):
        r = random.Random(f"wf:{f.site_id}:{f.fkey}")
        f.detected_at = now - dt.timedelta(hours=r.randrange(2, 24 * 9))
        roll = r.random()
        who = staff[n % len(staff)].id if staff else None
        if roll < 0.18:
            f.state, f.owner_id = "task_created", who
        elif roll < 0.30:
            f.state, f.owner_id = "in_progress", who
        elif roll < 0.36:
            f.state, f.owner_id = "awaiting_verification", who
        elif roll < 0.40:
            f.state, f.outcome, f.closed_at, f.owner_id = "closed", "fixed", now - dt.timedelta(days=r.randrange(1, 6)), who


async def _report_examples(db: AsyncSession, sites: list[SeoSite], staff: list[User], today: dt.date, now: dt.datetime) -> None:
    signer = staff[0].id if staff else None
    reps = list((await db.execute(select(SeoReport).where(SeoReport.site_id.in_([s.id for s in sites])).order_by(SeoReport.id))).scalars())
    for n, rep in enumerate(reps):
        roll = n % 10
        dom = (rep.snapshot or {}).get("site", {}).get("domain", "example.com")
        if roll < 4:
            rep.status, rep.signed_by_id, rep.signed_at = "sent", signer, now - dt.timedelta(days=2)
            rep.sent_at, rep.recipients = now - dt.timedelta(days=1, hours=n % 20), [f"owner@{dom}"]
        elif roll < 6:
            rep.status, rep.signed_by_id, rep.signed_at = "signed", signer, now - dt.timedelta(hours=5)
        elif roll == 6:
            rep.status, rep.signed_by_id, rep.signed_at = "failed", signer, now - dt.timedelta(days=1)
            rep.error = "The e-mail service refused it (422): recipient address bounced."
    pm = data.prev_month(data.prev_month(today))
    for s in sites[:24]:
        if s.status != "active":
            continue
        try:
            r = await client_reports.generate(db, s, pm, data.month_end(pm), None, "monthly")
        except client_reports.ReportError:
            continue
        r.status, r.signed_by_id, r.signed_at = "sent", signer, now - dt.timedelta(days=32)
        r.sent_at, r.recipients = now - dt.timedelta(days=31), [f"owner@{s.domain}"]
