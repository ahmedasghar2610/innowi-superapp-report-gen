"""What the generator may read, and what must never reach a merchant payload.

Hard rule 13 and PRD A MFR07: no billing, internal notes, ticket comments,
account health, next action, blockers, credentials, partner / pipeline data or
customer personal data. Role checks cannot enforce that (every staff role can
read the Payments tab), so the generator enforces it itself in two places:

1. ALLOWED — every assembler declares the columns it reads (`READS`), and a
   test asserts each one is in this table. Assemblers select columns, never
   whole rows.
2. scan() — walks an assembled payload and lists every key that looks like a
   blocked field. The assembler refuses to store a payload that fails it, and
   a test checks a clean payload passes and a poisoned one does not.

Ops read (Ahmed, 2026-10-30): ticket title, type, status and dates only;
comments, description, credentials and notes stay blocked.
"""
from __future__ import annotations

import re
from typing import Iterable

ALLOWED: dict[str, frozenset[str]] = {
    # cover, package switch, recipients
    "profiling.merchant": frozenset({"id", "merchant_code", "restaurant_name_dba", "cuisine_category", "website_url",
                                     "online_ordering", "location_count", "go_live_date", "google_ads_budget", "status"}),
    "profiling.location": frozenset({"id", "merchant_id", "city", "state", "is_primary"}),
    "profiling.merchant_service": frozenset({"merchant_id", "service_id", "status", "activated_at"}),
    "catalog.service": frozenset({"id", "name", "category"}),
    "profiling.subscription": frozenset({"merchant_id", "package_code"}),
    # recipients only — never printed in the document
    "profiling.contact": frozenset({"merchant_id", "email", "role"}),
    "delivery.delivery_item": frozenset({"merchant_id", "service_id", "status", "last_delivered"}),
    # Google Ads
    "marketing.ads_account": frozenset({"id", "name", "merchant_id", "state", "source", "ticket_total_sales", "ticket_order_count",
                                        "ticket_updated_at", "last_synced_at", "last_metrics_date"}),
    "marketing.ads_campaign": frozenset({"id", "account_id", "name", "status", "channel_type", "daily_budget"}),
    "marketing.ads_daily_metric": frozenset({"campaign_id", "date", "cost", "impressions", "clicks", "calls", "directions", "website", "orders", "menu"}),
    # SEO and blogs
    "marketing.seo_site": frozenset({"id", "name", "domain", "home_url", "merchant_id", "gsc_property", "ga4_property", "source", "status",
                                     "last_gsc_date", "last_ga4_date"}),
    "marketing.seo_gsc_daily": frozenset({"site_id", "date", "clicks", "impressions", "position"}),
    "marketing.seo_gsc_query": frozenset({"site_id", "month", "query", "clicks", "impressions", "position"}),
    "marketing.seo_gsc_page": frozenset({"site_id", "month", "page", "clicks", "impressions", "position"}),
    "marketing.seo_gsc_split": frozenset({"site_id", "month", "dimension", "key", "clicks", "impressions", "position"}),
    "marketing.seo_ga4_daily": frozenset({"site_id", "date", "sessions", "users", "key_events", "organic_sessions", "organic_key_events", "engaged_sessions"}),
    "marketing.seo_finding": frozenset({"site_id", "severity", "title", "state", "outcome", "closed_at"}),
    "marketing.seo_blog_post": frozenset({"id", "site_id", "url", "title", "published_on", "live"}),
    "marketing.seo_blog_gsc_daily": frozenset({"post_id", "date", "scope", "clicks", "impressions", "position", "is_final"}),
    # Google Business Profile (Phase 1)
    "marketing.gbp_location": frozenset({"id", "title", "city", "merchant_id", "source", "rating_average", "review_count", "profile_fields", "last_metrics_date"}),
    "marketing.gbp_daily_metric": frozenset({"location_id", "date", "impressions_desktop_maps", "impressions_desktop_search", "impressions_mobile_maps",
                                             "impressions_mobile_search", "website_clicks", "call_clicks", "direction_requests", "menu_clicks",
                                             "food_orders", "bookings"}),
    "marketing.gbp_review": frozenset({"location_id", "star_rating", "create_time", "has_reply", "reply_time"}),
    # Ops & Delivery (Phase 3) — four columns, by decision
    "ops.ticket": frozenset({"id", "merchant_id", "title", "type", "status", "due_date", "created_at", "updated_at"}),
}

# Key names (case-insensitive, camel or snake) that must never appear in a
# merchant payload. `email` is allowed only inside the top-level `recipients`
# block, which the renderers never print.
BLOCKED_KEY_RE = re.compile(
    r"^(notes?|internal.*|account_?health|next_?action|open_?blockers?|mrr|arr|contract.*|charged.*|variance|commission.*|billed.*|"
    r"customer_?id|phone|reviewer.*|comments?|analysis|owner_?id|password|token|secret|credential.*|partner.*|quote.*|"
    r"pipeline.*|payout.*|description|ticket_?comment.*|salesforce.*|source_?detail)$",
    re.I,
)
EMAIL_KEY_RE = re.compile(r"^e-?mails?$", re.I)


def scan(payload: object, path: str = "") -> list[str]:
    """Every key path in `payload` that matches a blocked name. Empty = clean."""
    hits: list[str] = []
    if isinstance(payload, dict):
        for k, v in payload.items():
            p = f"{path}.{k}" if path else str(k)
            if BLOCKED_KEY_RE.match(str(k)):
                hits.append(p)
            elif EMAIL_KEY_RE.match(str(k)) and not p.startswith("recipients"):
                hits.append(p)
            hits.extend(scan(v, p))
    elif isinstance(payload, (list, tuple)):
        for i, v in enumerate(payload):
            hits.extend(scan(v, f"{path}[{i}]"))
    return hits


class WhitelistError(ValueError):
    pass


def assert_clean(payload: dict) -> None:
    hits = scan(payload)
    if hits:
        raise WhitelistError("Blocked field(s) in report payload: " + ", ".join(hits[:10]))


def check_reads(reads: dict[str, Iterable[str]]) -> list[str]:
    """Columns an assembler declares that the whitelist does not allow. Empty = ok."""
    bad: list[str] = []
    for table, cols in reads.items():
        allowed = ALLOWED.get(table)
        if allowed is None:
            bad.append(f"{table}.*")
            continue
        bad.extend(f"{table}.{c}" for c in cols if c not in allowed)
    return bad
