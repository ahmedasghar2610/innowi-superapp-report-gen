"""Assembly: one adapter per report section, one payload per report.

Each adapter (`ads.py`, `seo.py`, `blogs.py`, `stub.py`) reads whitelisted
columns for ONE merchant and ONE calendar month and returns a section dict:

    {key, title, included, metrics: [metric…], tables: {name: rows}, missing: [{id, reason, text}],
     note, dataThrough, sources: [str]}

A metric is {id, label, value, prev, change, unit, tag, reason, reasonText}.
A missing figure keeps its id and carries a reason code — never zero, never
blank (PRD A MFR04). A section for a service the merchant has not taken is
returned with included = false and nothing else (MFR01).

`compose()` is pure: it takes the merchant, period and sections and writes
the headline cards, summary, recommendations, bottom line, sources footer and
the flat `missing` list. `build_payload()` is the only function that touches
the database.
"""
from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ads import AdsAccount
from app.models.catalog import Service
from app.models.enums import ContactRole, MerchantServiceStatus
from app.models.profiling import Contact, Location, Merchant, MerchantService
from app.models.seo import SeoSite
from app.modules.report_gen.periods import Period, change, previous_month

PAYLOAD_VERSION = 1

# PRD A MFR02 order. Cover, executive summary, snapshot, recommendations, bottom
# line and sources are not sections: compose() writes them around these.
SECTION_ORDER: tuple[tuple[str, str], ...] = (
    ("sales", "Sales performance"),
    ("search", "Search"),
    ("blogs", "Blogs"),
    ("website", "Website"),
    ("gbp", "Business Profile"),
    ("ads", "Ads"),
    ("email_sms", "Email & SMS"),
    ("rewards", "Rewards"),
    ("reviews", "Reviews"),
    ("ops", "What we did and next month"),
)
TITLES = dict(SECTION_ORDER)

# Reason codes printed next to "not supplied" (MFR04). Plain language, no jargon.
REASONS: dict[str, str] = {
    "sales_feed_not_connected": "The sales feed is not connected yet.",
    "ads_not_linked": "No Google Ads account is linked to this merchant.",
    "no_data_in_period": "No data was recorded for this month.",
    "ticket_not_set": "The average ticket for this account has not been entered.",
    "budget_not_set": "No monthly ad budget is recorded for this merchant.",
    "seo_not_linked": "No website is linked to this merchant for search data.",
    "gsc_not_connected": "Search Console is not connected for this website.",
    "no_queries_stored": "Search terms for this month have not been stored yet.",
    "no_blog_posts": "No blog posts were found on this website.",
    "blog_plan_not_recorded": "The number of planned posts is not recorded.",
    "website_analytics_not_connected": "Website analytics are not connected for this merchant.",
    "website_metric_not_collected": "Only website visits are collected today; this figure needs order and channel tracking on the site.",
    "gbp_pending_google": "Business Profile data arrives once Google approves API access.",
    "module_not_connected": "This module is not connected to the Super App yet.",
    "reviews_module_not_connected": "The reviews module is not connected to the Super App yet.",
    "ops_not_assembled": "Work completed is not assembled in this release.",
}

# Section → service names in catalog.service that mean "the merchant has taken it".
SERVICE_SWITCH: dict[str, tuple[str, ...]] = {
    "search": ("SEO",),
    "blogs": ("Blogs", "SEO"),
    "gbp": ("GMB", "Google Business Profile"),
    "email_sms": ("SMS/Email", "Email & SMS", "Customer List"),
    "rewards": ("Rewards", "Rewards Flyer"),
    "reviews": ("Review Management", "Google Review Badge"),
}


# ------------------------------------------------------------------ shapes ----
def metric(id: str, label: str, value: Optional[float], prev: Optional[float] = None, *, unit: str = "count",
           tag: Optional[str] = None, reason: Optional[str] = None) -> dict:
    """A figure with its change on the prior month, or a 'not supplied' with a reason."""
    if value is None and reason is None:
        reason = "no_data_in_period"
    return {
        "id": id, "label": label, "value": value, "prev": prev,
        "change": change(value, prev) if value is not None else None,
        "unit": unit, "tag": tag,
        "reason": reason if value is None else None,
        "reasonText": REASONS.get(reason, reason) if value is None and reason else None,
    }


def not_supplied(id: str, label: str, reason: str, unit: str = "count") -> dict:
    return metric(id, label, None, None, unit=unit, reason=reason)


def section(key: str, *, included: bool = True, metrics: Optional[list[dict]] = None, tables: Optional[dict] = None,
            note: Optional[str] = None, data_through: Optional[dt.date] = None, sources: Optional[list[str]] = None) -> dict:
    metrics = metrics or []
    missing = [{"id": m["id"], "reason": m["reason"], "text": m["reasonText"]} for m in metrics if m["value"] is None and m["reason"]]
    # The one-line caption under a section ("not supplied" reason, label footnote). Named
    # `caption`, not `note`: the payload scan blocks every *note* key as internal text.
    return {
        "key": key, "title": TITLES[key], "included": included, "metrics": metrics if included else [],
        "tables": (tables or {}) if included else {}, "missing": missing if included else [], "caption": note if included else None,
        "dataThrough": data_through.isoformat() if data_through else None, "sources": (sources or []) if included else [],
    }


def find_metric(sec: Optional[dict], id: str) -> Optional[dict]:
    for m in (sec or {}).get("metrics") or []:
        if m["id"] == id:
            return m
    return None


# ----------------------------------------------------------------- context ----
@dataclass
class Ctx:
    merchant: dict
    period: Period
    prev: Period
    services: list[str]
    ads_account_ids: list[str] = field(default_factory=list)
    seo_site_ids: list[str] = field(default_factory=list)
    recipients: list[str] = field(default_factory=list)
    today: dt.date = field(default_factory=dt.date.today)

    @property
    def merchant_id(self) -> str:
        return self.merchant["id"]


def package_switch(ctx: Ctx) -> dict[str, bool]:
    """Which sections the merchant's package includes (MFR01, DQ07).

    The service catalogue has no Google Ads, Sales or Website entry, so those use
    the data link instead: Ads = an active linked account; Sales and "What we
    did" = every merchant (ordering is the product); Website = a website URL."""
    svc = {s.lower() for s in ctx.services}

    def has(key: str) -> bool:
        return any(name.lower() in svc for name in SERVICE_SWITCH[key])

    return {
        "sales": True,
        "search": has("search") or bool(ctx.seo_site_ids),
        "blogs": has("blogs") or bool(ctx.seo_site_ids),
        "website": bool(ctx.merchant.get("website")),
        "gbp": has("gbp"),
        "ads": bool(ctx.ads_account_ids),
        "email_sms": has("email_sms"),
        "rewards": has("rewards"),
        "reviews": has("reviews"),
        "ops": True,
    }


async def load_ctx(db: AsyncSession, merchant_id: str, period: Period, today: Optional[dt.date] = None) -> Ctx:
    """Everything the adapters share. Column selects only (see whitelist.py)."""
    m = (await db.execute(select(
        Merchant.id, Merchant.restaurant_name, Merchant.cuisine_category, Merchant.website_url, Merchant.online_ordering,
        Merchant.location_count, Merchant.go_live_date, Merchant.google_ads_budget, Merchant.status,
    ).where(Merchant.id == merchant_id))).first()
    if m is None:
        raise LookupError("Merchant not found")
    loc = (await db.execute(select(Location.city, Location.state).where(Location.merchant_id == merchant_id)
                            .order_by(Location.is_primary.desc(), Location.created_at).limit(1))).first()
    services = list((await db.execute(select(Service.name).join(MerchantService, MerchantService.service_id == Service.id)
                                      .where(MerchantService.merchant_id == merchant_id, MerchantService.status == MerchantServiceStatus.ACTIVE)
                                      .order_by(Service.name))).scalars())
    ads_ids = list((await db.execute(select(AdsAccount.id).where(AdsAccount.merchant_id == merchant_id, AdsAccount.state == "active",
                                                                  AdsAccount.source != "DEMO"))).scalars())
    seo_ids = list((await db.execute(select(SeoSite.id).where(SeoSite.merchant_id == merchant_id, SeoSite.status == "active",
                                                               SeoSite.source != "DEMO"))).scalars())
    emails = list((await db.execute(select(Contact.email).where(Contact.merchant_id == merchant_id, Contact.role.in_((ContactRole.OWNER, ContactRole.MARKETING)),
                                                                 Contact.email.is_not(None)))).scalars())
    recipients: list[str] = []
    for e in emails:
        e = (e or "").strip().lower()
        if "@" in e and e not in recipients:
            recipients.append(e)
    merchant = {
        "id": m.id, "name": m.restaurant_name, "cuisine": m.cuisine_category, "website": m.website_url,
        "onlineOrdering": m.online_ordering, "locationCount": m.location_count,
        "goLiveDate": m.go_live_date.date().isoformat() if m.go_live_date else None,
        "googleAdsBudget": float(m.google_ads_budget) if m.google_ads_budget is not None else None,
        "city": loc.city if loc else None, "state": loc.state if loc else None,
    }
    return Ctx(merchant=merchant, period=period, prev=previous_month(period), services=services, ads_account_ids=ads_ids,
               seo_site_ids=seo_ids, recipients=recipients, today=today or dt.date.today())


# ----------------------------------------------------------------- compose ----
def compose(ctx: Ctx, sections: dict[str, dict], *, template: str = "monthly", generated_at: Optional[dt.datetime] = None) -> dict:
    """The whole report payload from the merchant, the period and the sections. Pure."""
    from app.modules.report_gen import narrative

    ordered = {key: sections[key] for key, _ in SECTION_ORDER if key in sections}
    missing = [{"section": key, **m} for key, s in ordered.items() if s["included"] for m in s["missing"]]
    data_through = {key: s["dataThrough"] for key, s in ordered.items() if s.get("dataThrough")}
    sources: list[str] = []
    for s in ordered.values():
        for src in s.get("sources") or []:
            if src not in sources:
                sources.append(src)
    payload = {
        "payloadVersion": PAYLOAD_VERSION,
        "template": template,
        "merchant": dict(ctx.merchant),
        "period": ctx.period.dto(),
        "previous": ctx.prev.dto(),
        "services": list(ctx.services),
        "sectionOrder": [key for key, _ in SECTION_ORDER],
        "sections": ordered,
        "headline": narrative.headline(ordered),
        "summary": narrative.summary(ctx.merchant, ctx.period, ctx.prev, ordered),
        "sectionNotes": {},
        "recommendations": narrative.recommendations(ordered),
        "bottomLine": narrative.bottom_line(ctx.period, ordered),
        "sources": sources,
        "dataThrough": data_through,
        "missing": missing,
        "generatedAt": (generated_at or dt.datetime.now(dt.timezone.utc)).isoformat(),
        # Addressing only. The preview, the document and the e-mail body never print this block.
        "recipients": list(ctx.recipients),
    }
    return payload


async def build_payload(db: AsyncSession, merchant_id: str, period: Period, *, template: str = "monthly",
                        today: Optional[dt.date] = None) -> dict:
    from app.modules.report_gen.assemble import ads, blogs, seo, stub, website

    ctx = await load_ctx(db, merchant_id, period, today)
    included = package_switch(ctx)
    sections: dict[str, dict] = {}
    sections["sales"] = stub.build("sales", "sales_feed_not_connected", included=included["sales"])
    sections["search"] = await seo.build(db, ctx) if included["search"] else section("search", included=False)
    sections["blogs"] = await blogs.build(db, ctx) if included["blogs"] else section("blogs", included=False)
    sections["website"] = await website.build(db, ctx) if included["website"] else section("website", included=False)
    sections["gbp"] = stub.build("gbp", "gbp_pending_google", included=included["gbp"])
    sections["ads"] = await ads.build(db, ctx) if included["ads"] else section("ads", included=False)
    sections["email_sms"] = stub.build("email_sms", "module_not_connected", included=included["email_sms"])
    sections["rewards"] = stub.build("rewards", "module_not_connected", included=included["rewards"])
    sections["reviews"] = stub.build("reviews", "reviews_module_not_connected", included=included["reviews"])
    sections["ops"] = stub.build("ops", "ops_not_assembled", included=included["ops"])
    return compose(ctx, sections, template=template)


def primary_location_text(merchant: dict) -> Optional[str]:
    parts = [p for p in (merchant.get("city"), merchant.get("state")) if p]
    return ", ".join(parts) or None


__all__ = ["Ctx", "SECTION_ORDER", "TITLES", "REASONS", "metric", "not_supplied", "section", "find_metric", "package_switch",
           "load_ctx", "compose", "build_payload"]
