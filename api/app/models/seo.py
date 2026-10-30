"""marketing schema — SEO (Search Console, Google Analytics 4, PageSpeed, Screaming Frog crawls).

Like GBP and Ads, everything here is a local copy refreshed by the daily sync
(modules/seo/sync.py); the SEO pages read only these tables.

    seo_connection   the connected Google account (Search Console + GA4) + encrypted refresh token
    seo_site         one row per website we track (a Search Console property, or added by hand)
    seo_gsc_daily    Search Console clicks / impressions / position per site per day
    seo_gsc_query    Search Console search terms per site per month
    seo_gsc_page     Search Console landing pages per site per month
    seo_ga4_daily    GA4 sessions / users / key events per site per day (all + organic)
    seo_page         pages we fetched and checked (title, meta, H1, noindex, schema,
                     index status from URL Inspection, PageSpeed score)
    seo_keyword      tracked keywords per site (from Search Console or added by hand)
    seo_keyword_rank (no longer written — tracked keyword positions now come from seo_gsc_query)
    seo_finding      issues found by the rules (modules/seo/rules.py) and their workflow
    seo_report       client reports: generated → awaiting sign-off → signed → sent
    seo_kpi          KPI Studio registry (targets editable)
    seo_sync_run     one row per sync

`source` on a site is GOOGLE (found in Search Console), MANUAL (added by hand)
or DEMO (sample data, removed by the first real sync).
"""
from __future__ import annotations

import datetime as dt
from typing import Optional

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.common import id_column

SCHEMA = "marketing"


def utcnow() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def _created():
    return mapped_column("created_at", DateTime(timezone=True), default=utcnow, server_default=func.now(), nullable=False)


def _updated():
    return mapped_column(
        "updated_at", DateTime(timezone=True), default=utcnow, onupdate=utcnow, server_default=func.now(), nullable=False
    )


def _site_fk():
    return mapped_column(ForeignKey(f"{SCHEMA}.seo_site.id", ondelete="CASCADE"), primary_key=True)


class SeoConnection(Base):
    __tablename__ = "seo_connection"
    __table_args__ = {"schema": SCHEMA}

    id: Mapped[str] = id_column()
    google_email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    refresh_token_encrypted: Mapped[str] = mapped_column(Text, nullable=False)
    scopes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="connected", server_default="connected")
    last_error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # GA4 properties the account can read, refreshed each sync:
    # [{"property": "properties/123", "name": "…", "account": "…", "hosts": ["x.com"]}]
    ga4_properties: Mapped[list] = mapped_column(JSONB, nullable=False, default=list, server_default="[]")
    connected_by_id: Mapped[Optional[str]] = mapped_column(ForeignKey("auth.user.id", ondelete="SET NULL"), nullable=True)
    connected_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    last_sync_at: Mapped[Optional[dt.datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[dt.datetime] = _created()
    updated_at: Mapped[dt.datetime] = _updated()


class SeoSite(Base):
    __tablename__ = "seo_site"
    __table_args__ = (
        Index("ix_seo_site_merchant_id", "merchant_id"),
        {"schema": SCHEMA},
    )

    id: Mapped[str] = id_column()
    source: Mapped[str] = mapped_column(String(10), nullable=False, default="GOOGLE", server_default="GOOGLE")
    name: Mapped[str] = mapped_column(String(300), nullable=False)
    # Bare host, lower case, no "www." — the site's identity ("primocafe.com").
    domain: Mapped[str] = mapped_column(String(253), unique=True, nullable=False)
    home_url: Mapped[str] = mapped_column(String(500), nullable=False)

    # "sc-domain:x.com" or "https://www.x.com/"; null for a site added by hand without Search Console.
    gsc_property: Mapped[Optional[str]] = mapped_column(String(500), nullable=True, unique=True)
    gsc_permission: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    ga4_property: Mapped[Optional[str]] = mapped_column(String(60), nullable=True)  # "properties/123"
    ga4_name: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)

    merchant_id: Mapped[Optional[str]] = mapped_column(ForeignKey("profiling.merchant.id", ondelete="SET NULL"), nullable=True)
    gbp_location_id: Mapped[Optional[str]] = mapped_column(ForeignKey(f"{SCHEMA}.gbp_location.id", ondelete="SET NULL"), nullable=True)
    ads_account_id: Mapped[Optional[str]] = mapped_column(ForeignKey(f"{SCHEMA}.ads_account.id", ondelete="SET NULL"), nullable=True)

    segment: Mapped[str] = mapped_column(String(40), nullable=False, default="Restaurant", server_default="Restaurant")
    # normal | 199 | 299 | internal
    package: Mapped[str] = mapped_column(String(12), nullable=False, default="normal", server_default="normal")
    owner_id: Mapped[Optional[str]] = mapped_column(ForeignKey("auth.user.id", ondelete="SET NULL"), nullable=True)
    # biweekly | monthly | quarterly
    report_cadence: Mapped[str] = mapped_column(String(12), nullable=False, default="monthly", server_default="monthly")
    report_recipients: Mapped[list] = mapped_column(JSONB, nullable=False, default=list, server_default="[]")
    # active | paused
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="active", server_default="active")

    last_synced_at: Mapped[Optional[dt.datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    sync_error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    sync_warning: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    last_gsc_date: Mapped[Optional[dt.date]] = mapped_column(Date, nullable=True)
    last_ga4_date: Mapped[Optional[dt.date]] = mapped_column(Date, nullable=True)
    last_crawl_at: Mapped[Optional[dt.datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    last_psi_at: Mapped[Optional[dt.datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    last_rank_at: Mapped[Optional[dt.datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    # Cached scorecard (modules/seo/scoring.py), recomputed after every sync.
    health: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    pillars: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default="{}")
    scored_at: Mapped[Optional[dt.datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[dt.datetime] = _created()
    updated_at: Mapped[dt.datetime] = _updated()


class SeoGscDaily(Base):
    __tablename__ = "seo_gsc_daily"
    __table_args__ = (Index("ix_seo_gsc_daily_date", "date"), {"schema": SCHEMA})

    site_id: Mapped[str] = _site_fk()
    date: Mapped[dt.date] = mapped_column(Date, primary_key=True)
    clicks: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    impressions: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    position: Mapped[Optional[float]] = mapped_column(Float, nullable=True)  # impression-weighted average


class SeoGscQuery(Base):
    __tablename__ = "seo_gsc_query"
    __table_args__ = {"schema": SCHEMA}

    site_id: Mapped[str] = _site_fk()
    month: Mapped[dt.date] = mapped_column(Date, primary_key=True)  # first day of the month
    query: Mapped[str] = mapped_column(String(400), primary_key=True)
    clicks: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    impressions: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    position: Mapped[Optional[float]] = mapped_column(Float, nullable=True)


class SeoGscSplit(Base):
    """Search Console totals per month split by device (MOBILE / DESKTOP / TABLET) or country (ISO-3 code)."""

    __tablename__ = "seo_gsc_split"
    __table_args__ = {"schema": SCHEMA}

    site_id: Mapped[str] = _site_fk()
    month: Mapped[dt.date] = mapped_column(Date, primary_key=True)  # first day of the month
    dimension: Mapped[str] = mapped_column(String(12), primary_key=True)  # device | country
    key: Mapped[str] = mapped_column(String(60), primary_key=True)
    clicks: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    impressions: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    position: Mapped[Optional[float]] = mapped_column(Float, nullable=True)


class SeoGscPage(Base):
    __tablename__ = "seo_gsc_page"
    __table_args__ = {"schema": SCHEMA}

    site_id: Mapped[str] = _site_fk()
    month: Mapped[dt.date] = mapped_column(Date, primary_key=True)
    page: Mapped[str] = mapped_column(String(1000), primary_key=True)
    clicks: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    impressions: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    position: Mapped[Optional[float]] = mapped_column(Float, nullable=True)


class SeoGa4Daily(Base):
    __tablename__ = "seo_ga4_daily"
    __table_args__ = (Index("ix_seo_ga4_daily_date", "date"), {"schema": SCHEMA})

    site_id: Mapped[str] = _site_fk()
    date: Mapped[dt.date] = mapped_column(Date, primary_key=True)
    sessions: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    users: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    engaged_sessions: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    key_events: Mapped[float] = mapped_column(Float, nullable=False, default=0, server_default="0")
    organic_sessions: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    organic_key_events: Mapped[float] = mapped_column(Float, nullable=False, default=0, server_default="0")


class SeoPage(Base):
    __tablename__ = "seo_page"
    __table_args__ = (UniqueConstraint("site_id", "url", name="uq_seo_page_site_url"), {"schema": SCHEMA})

    id: Mapped[str] = id_column()
    site_id: Mapped[str] = mapped_column(ForeignKey(f"{SCHEMA}.seo_site.id", ondelete="CASCADE"), nullable=False)
    url: Mapped[str] = mapped_column(String(1000), nullable=False)
    # home | hub | category | dish | geo | combo | blog | other (from the URL)
    page_type: Mapped[str] = mapped_column(String(12), nullable=False, default="other", server_default="other")

    status_code: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    final_url: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)
    title: Mapped[Optional[str]] = mapped_column(String(600), nullable=True)
    meta_description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    h1_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    canonical: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)
    noindex: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    word_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    img_total: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    img_with_alt: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    schema_types: Mapped[list] = mapped_column(JSONB, nullable=False, default=list, server_default="[]")
    last_crawl_at: Mapped[Optional[dt.datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    crawl_error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Search Console URL Inspection: PASS | NEUTRAL | FAIL | … and Google's own sentence.
    index_verdict: Mapped[Optional[str]] = mapped_column(String(24), nullable=True)
    coverage_state: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    inspected_at: Mapped[Optional[dt.datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    # PageSpeed Insights (mobile).
    psi_score: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    lcp_ms: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    cls: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    inp_ms: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    # pass | fail | none (field data from real Chrome users; "none" = too little traffic)
    cwv: Mapped[Optional[str]] = mapped_column(String(8), nullable=True)
    psi_at: Mapped[Optional[dt.datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    # [{"code": "title_long", "severity": "S3", "label": "…"}] — modules/seo/crawl.py
    issues: Mapped[list] = mapped_column(JSONB, nullable=False, default=list, server_default="[]")
    created_at: Mapped[dt.datetime] = _created()
    updated_at: Mapped[dt.datetime] = _updated()


class SeoKeyword(Base):
    __tablename__ = "seo_keyword"
    __table_args__ = (UniqueConstraint("site_id", "keyword", name="uq_seo_keyword_site_keyword"), {"schema": SCHEMA})

    id: Mapped[str] = id_column()
    site_id: Mapped[str] = mapped_column(ForeignKey(f"{SCHEMA}.seo_site.id", ondelete="CASCADE"), nullable=False)
    keyword: Mapped[str] = mapped_column(String(300), nullable=False)
    source: Mapped[str] = mapped_column(String(10), nullable=False, default="manual", server_default="manual")  # gsc | manual
    location: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)  # e.g. "Fremont, California, United States"
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    created_at: Mapped[dt.datetime] = _created()


class SeoKeywordRank(Base):
    __tablename__ = "seo_keyword_rank"
    __table_args__ = {"schema": SCHEMA}

    keyword_id: Mapped[str] = mapped_column(ForeignKey(f"{SCHEMA}.seo_keyword.id", ondelete="CASCADE"), primary_key=True)
    date: Mapped[dt.date] = mapped_column(Date, primary_key=True)
    position: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)  # null = not in the top 100
    url: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)
    local_pack: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)


class SeoFinding(Base):
    __tablename__ = "seo_finding"
    __table_args__ = (
        UniqueConstraint("site_id", "fkey", name="uq_seo_finding_site_fkey"),
        Index("ix_seo_finding_state", "state"),
        {"schema": SCHEMA},
    )

    id: Mapped[str] = id_column()
    site_id: Mapped[str] = mapped_column(ForeignKey(f"{SCHEMA}.seo_site.id", ondelete="CASCADE"), nullable=False)
    # Rule code + optional page ("title_long", "page_error:https://x.com/menu/").
    fkey: Mapped[str] = mapped_column(String(1100), nullable=False)
    code: Mapped[str] = mapped_column(String(40), nullable=False)
    severity: Mapped[str] = mapped_column(String(2), nullable=False)  # S1 | S2 | S3
    team: Mapped[str] = mapped_column(String(30), nullable=False)  # SEO | Web Development | Analytics
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    detail: Mapped[str] = mapped_column(Text, nullable=False)
    recommendation: Mapped[str] = mapped_column(Text, nullable=False)
    confidence: Mapped[str] = mapped_column(String(8), nullable=False, default="High")
    impact: Mapped[str] = mapped_column(String(8), nullable=False, default="Medium")
    effort: Mapped[str] = mapped_column(String(8), nullable=False, default="Medium")
    page_url: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)
    evidence: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default="{}")
    # detected → recommended → task_created → in_progress → awaiting_verification → closed
    state: Mapped[str] = mapped_column(String(24), nullable=False, default="detected", server_default="detected")
    owner_id: Mapped[Optional[str]] = mapped_column(ForeignKey("auth.user.id", ondelete="SET NULL"), nullable=True)
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # How a closed finding ended: fixed (verified) | resolved (cleared by itself) | dismissed
    outcome: Mapped[Optional[str]] = mapped_column(String(12), nullable=True)
    detected_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    last_seen_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    closed_at: Mapped[Optional[dt.datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[dt.datetime] = _created()
    updated_at: Mapped[dt.datetime] = _updated()


class SeoReport(Base):
    __tablename__ = "seo_report"
    __table_args__ = (
        UniqueConstraint("site_id", "period_start", "period_end", name="uq_seo_report_site_period"),
        Index("ix_seo_report_status", "status"),
        {"schema": SCHEMA},
    )

    id: Mapped[str] = id_column()
    site_id: Mapped[str] = mapped_column(ForeignKey(f"{SCHEMA}.seo_site.id", ondelete="CASCADE"), nullable=False)
    period_start: Mapped[dt.date] = mapped_column(Date, nullable=False)
    period_end: Mapped[dt.date] = mapped_column(Date, nullable=False)
    cadence: Mapped[str] = mapped_column(String(12), nullable=False, default="monthly")
    # awaiting_signoff | signed | sent | failed
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="awaiting_signoff")
    snapshot: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default="{}")
    generated_by_id: Mapped[Optional[str]] = mapped_column(ForeignKey("auth.user.id", ondelete="SET NULL"), nullable=True)
    generated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    signed_by_id: Mapped[Optional[str]] = mapped_column(ForeignKey("auth.user.id", ondelete="SET NULL"), nullable=True)
    signed_at: Mapped[Optional[dt.datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    sent_at: Mapped[Optional[dt.datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    recipients: Mapped[list] = mapped_column(JSONB, nullable=False, default=list, server_default="[]")
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[dt.datetime] = _created()
    updated_at: Mapped[dt.datetime] = _updated()


class SeoKpi(Base):
    __tablename__ = "seo_kpi"
    __table_args__ = {"schema": SCHEMA}

    key: Mapped[str] = mapped_column(String(20), primary_key=True)
    set_no: Mapped[int] = mapped_column("set", Integer, nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    grader: Mapped[str] = mapped_column(String(12), nullable=False)  # score | band | sla | gate | trend
    target: Mapped[str] = mapped_column(String(120), nullable=False)
    source: Mapped[str] = mapped_column(String(80), nullable=False)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="proposed")  # proposed | active | retired
    sort: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    custom: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    updated_by_id: Mapped[Optional[str]] = mapped_column(ForeignKey("auth.user.id", ondelete="SET NULL"), nullable=True)
    updated_at: Mapped[dt.datetime] = _updated()


class SeoSyncRun(Base):
    __tablename__ = "seo_sync_run"
    __table_args__ = (Index("ix_seo_sync_run_started_at", "started_at"), {"schema": SCHEMA})

    id: Mapped[str] = id_column()
    trigger: Mapped[str] = mapped_column(String(12), nullable=False)  # manual | schedule | connect
    status: Mapped[str] = mapped_column(String(12), nullable=False, default="running")  # running | success | partial | failed
    started_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    finished_at: Mapped[Optional[dt.datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    started_by_id: Mapped[Optional[str]] = mapped_column(ForeignKey("auth.user.id", ondelete="SET NULL"), nullable=True)
    sites: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    sites_failed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    gsc_days: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    pages_checked: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    rank_checks: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)


# --------------------------------------------------------------------------- #
# Full-site crawls imported from Screaming Frog (scripts/seo_import_sf.py).
# Kept in their own tables: an import never changes the synced data above, and
# `--remove` deletes it without a trace.
# --------------------------------------------------------------------------- #


class SeoCrawl(Base):
    """One imported crawl of one site (newest one is shown)."""

    __tablename__ = "seo_crawl"
    __table_args__ = (Index("ix_seo_crawl_site_crawled", "site_id", "crawled_at"), {"schema": SCHEMA})

    id: Mapped[str] = id_column()
    site_id: Mapped[str] = mapped_column(ForeignKey(f"{SCHEMA}.seo_site.id", ondelete="CASCADE"), nullable=False)
    source: Mapped[str] = mapped_column(String(24), nullable=False, default="screaming_frog")
    crawled_at: Mapped[Optional[dt.datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    imported_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    folder: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    # {"urls", "html", "indexable", "nonIndexable", "statuses": {"200": n}, "avgWords", "avgResponse",
    #  "depth": {"0": n, ...}, "issues": {"High": n, "Medium": n, "Low": n}, "orphans", "redirects", ...}
    totals: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default="{}")
    created_at: Mapped[dt.datetime] = _created()


class SeoCrawlerKey(Base):
    """A key a crawler helper (helper.py on a PC with a licensed Screaming Frog) uses to ask for crawl jobs.
    Only a SHA-256 hash is kept; the key itself is shown once when it is created."""

    __tablename__ = "seo_crawler_key"
    __table_args__ = {"schema": SCHEMA}

    id: Mapped[str] = id_column()
    name: Mapped[str] = mapped_column(String(80), nullable=False)  # "Usama laptop"
    key_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    key_hint: Mapped[str] = mapped_column(String(8), nullable=False)  # last 4 characters, to tell keys apart
    created_by_id: Mapped[Optional[str]] = mapped_column(ForeignKey("auth.user.id", ondelete="SET NULL"), nullable=True)
    revoked_at: Mapped[Optional[dt.datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    last_seen_at: Mapped[Optional[dt.datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    helper_name: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)  # what the helper calls itself
    helper_version: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    created_at: Mapped[dt.datetime] = _created()


class SeoCrawlJob(Base):
    """One "crawl this site" request, done by whichever helper asks first.
    status: queued → running → done | failed (or cancelled while queued)."""

    __tablename__ = "seo_crawl_job"
    __table_args__ = (
        Index("ix_seo_crawl_job_status", "status", "requested_at"),
        Index("ix_seo_crawl_job_site", "site_id", "requested_at"),
        {"schema": SCHEMA},
    )

    id: Mapped[str] = id_column()
    site_id: Mapped[str] = mapped_column(ForeignKey(f"{SCHEMA}.seo_site.id", ondelete="CASCADE"), nullable=False)
    url: Mapped[str] = mapped_column(String(500), nullable=False)
    status: Mapped[str] = mapped_column(String(12), nullable=False, default="queued")
    requested_by_id: Mapped[Optional[str]] = mapped_column(ForeignKey("auth.user.id", ondelete="SET NULL"), nullable=True)
    requested_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    key_id: Mapped[Optional[str]] = mapped_column(ForeignKey(f"{SCHEMA}.seo_crawler_key.id", ondelete="SET NULL"), nullable=True)
    helper_name: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    claimed_at: Mapped[Optional[dt.datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[Optional[dt.datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    crawl_id: Mapped[Optional[str]] = mapped_column(ForeignKey(f"{SCHEMA}.seo_crawl.id", ondelete="SET NULL"), nullable=True)
    urls: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    duration_sec: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

class SeoCrawlIssue(Base):
    """One row of Screaming Frog's Issues Overview, plus sample URLs from its bulk export."""

    __tablename__ = "seo_crawl_issue"
    __table_args__ = (Index("ix_seo_crawl_issue_crawl", "crawl_id"), {"schema": SCHEMA})

    id: Mapped[str] = id_column()
    crawl_id: Mapped[str] = mapped_column(ForeignKey(f"{SCHEMA}.seo_crawl.id", ondelete="CASCADE"), nullable=False)
    key: Mapped[str] = mapped_column(String(120), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    issue_type: Mapped[str] = mapped_column(String(20), nullable=False)  # Issue | Warning | Opportunity
    priority: Mapped[str] = mapped_column(String(10), nullable=False)  # High | Medium | Low
    urls: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    pct: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    how_to_fix: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    help_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    # Up to 50 example rows from the issue's export ({"url", ...extra columns}) and its *_inlinks export.
    sample: Mapped[list] = mapped_column(JSONB, nullable=False, default=list, server_default="[]")
    links_sample: Mapped[list] = mapped_column(JSONB, nullable=False, default=list, server_default="[]")


class SeoCrawlPage(Base):
    """One crawled URL (Screaming Frog's Internal → All), with the issues it appears in."""

    __tablename__ = "seo_crawl_page"
    __table_args__ = (Index("ix_seo_crawl_page_crawl", "crawl_id"), {"schema": SCHEMA})

    id: Mapped[str] = id_column()
    crawl_id: Mapped[str] = mapped_column(ForeignKey(f"{SCHEMA}.seo_crawl.id", ondelete="CASCADE"), nullable=False)
    url: Mapped[str] = mapped_column(String(2000), nullable=False)
    path: Mapped[str] = mapped_column(String(2000), nullable=False)
    content_type: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    status_code: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    indexable: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    indexability_status: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    title: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    title_length: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    title_px: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    meta_description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    meta_length: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    h1: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    h2: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    canonical: Mapped[Optional[str]] = mapped_column(String(2000), nullable=True)
    meta_robots: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    word_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    readability: Mapped[Optional[float]] = mapped_column(Float, nullable=True)  # Flesch reading ease
    crawl_depth: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    inlinks: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    unique_inlinks: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    outlinks: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    external_outlinks: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    link_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    near_duplicates: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    response_ms: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    size_bytes: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    redirect_url: Mapped[Optional[str]] = mapped_column(String(2000), nullable=True)
    # Issue keys (seo_crawl_issue.key) this URL is listed under.
    issues: Mapped[list] = mapped_column(JSONB, nullable=False, default=list, server_default="[]")


# --------------------------------------------------------------------------- #
# Blog Impact (modules/seo/blogs.py): the blog posts on each site and how they
# do in Search Console and GA4. Filled by its own job (times set on the Blog
# Impact tab), separate from the daily sync and from the blog-writing
# workflow: posts are found on the live site (WordPress feed, sitemap,
# crawled pages), never from the workflow's files.
# --------------------------------------------------------------------------- #


class SeoBlogPost(Base):
    """One blog post found on a site."""

    __tablename__ = "seo_blog_post"
    __table_args__ = (UniqueConstraint("site_id", "url", name="uq_seo_blog_post_site_url"), {"schema": SCHEMA})

    id: Mapped[str] = id_column()
    site_id: Mapped[str] = mapped_column(ForeignKey(f"{SCHEMA}.seo_site.id", ondelete="CASCADE"), nullable=False)
    url: Mapped[str] = mapped_column(String(1000), nullable=False)
    title: Mapped[Optional[str]] = mapped_column(String(600), nullable=True)
    published_on: Mapped[Optional[dt.date]] = mapped_column(Date, nullable=True)
    source: Mapped[str] = mapped_column(String(12), nullable=False, default="wordpress")  # wordpress | sitemap | crawler
    live: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    first_seen_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    last_seen_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    # URL Inspection (only while not indexed, or weekly)
    index_verdict: Mapped[Optional[str]] = mapped_column(String(24), nullable=True)
    coverage_state: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    google_last_crawl_at: Mapped[Optional[dt.datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    inspected_at: Mapped[Optional[dt.datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    indexed_on: Mapped[Optional[dt.date]] = mapped_column(Date, nullable=True)  # first day seen indexed (or with impressions)
    # How far this post's data is stored: final Search Console days, GA4 days.
    gsc_final_through: Mapped[Optional[dt.date]] = mapped_column(Date, nullable=True)
    ga4_through: Mapped[Optional[dt.date]] = mapped_column(Date, nullable=True)
    # The same for the US-only numbers (fetched separately, so they backfill on their own).
    us_gsc_final_through: Mapped[Optional[dt.date]] = mapped_column(Date, nullable=True)
    us_ga4_through: Mapped[Optional[dt.date]] = mapped_column(Date, nullable=True)
    created_at: Mapped[dt.datetime] = _created()
    updated_at: Mapped[dt.datetime] = _updated()


def _post_fk():
    return mapped_column(ForeignKey(f"{SCHEMA}.seo_blog_post.id", ondelete="CASCADE"), primary_key=True)


class SeoBlogGscDaily(Base):
    """Search Console per post per day. `is_final` false = Google's fresh (provisional) numbers, overwritten once final."""

    __tablename__ = "seo_blog_gsc_daily"
    __table_args__ = {"schema": SCHEMA}

    post_id: Mapped[str] = _post_fk()
    date: Mapped[dt.date] = mapped_column(Date, primary_key=True)
    # "all" = every country; "us" = searches / visits from the United States only (the Blog Impact toggle).
    scope: Mapped[str] = mapped_column(String(3), primary_key=True, default="all", server_default="all")
    clicks: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    impressions: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    position: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    is_final: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class SeoBlogGscHourly(Base):
    """Search Console per post per hour, only for posts published in the last 10 days (early signals)."""

    __tablename__ = "seo_blog_gsc_hourly"
    __table_args__ = {"schema": SCHEMA}

    post_id: Mapped[str] = _post_fk()
    hour: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), primary_key=True)
    # "all" = every country; "us" = searches / visits from the United States only (the Blog Impact toggle).
    scope: Mapped[str] = mapped_column(String(3), primary_key=True, default="all", server_default="all")
    clicks: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    impressions: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    position: Mapped[Optional[float]] = mapped_column(Float, nullable=True)


class SeoBlogQuery(Base):
    """Search terms each post shows up for, per month."""

    __tablename__ = "seo_blog_query"
    __table_args__ = {"schema": SCHEMA}

    post_id: Mapped[str] = _post_fk()
    month: Mapped[dt.date] = mapped_column(Date, primary_key=True)
    query: Mapped[str] = mapped_column(String(400), primary_key=True)
    # "all" = every country; "us" = searches / visits from the United States only (the Blog Impact toggle).
    scope: Mapped[str] = mapped_column(String(3), primary_key=True, default="all", server_default="all")
    clicks: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    impressions: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    position: Mapped[Optional[float]] = mapped_column(Float, nullable=True)


class SeoBlogGa4Daily(Base):
    """GA4 per post (as landing page) per day; order_clicks = clicks to the Innowi ordering site from that page."""

    __tablename__ = "seo_blog_ga4_daily"
    __table_args__ = {"schema": SCHEMA}

    post_id: Mapped[str] = _post_fk()
    date: Mapped[dt.date] = mapped_column(Date, primary_key=True)
    # "all" = every country; "us" = searches / visits from the United States only (the Blog Impact toggle).
    scope: Mapped[str] = mapped_column(String(3), primary_key=True, default="all", server_default="all")
    sessions: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    organic_sessions: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    engaged_sessions: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    order_clicks: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class SeoBlogSiteDaily(Base):
    """Site-wide Search Console clicks/impressions from non-brand searches (before vs after blogging), final days only.
    With scope "us" also the site's US clicks / impressions / GA4 organic sessions per day."""

    __tablename__ = "seo_blog_site_daily"
    __table_args__ = {"schema": SCHEMA}

    site_id: Mapped[str] = _site_fk()
    date: Mapped[dt.date] = mapped_column(Date, primary_key=True)
    # "all" = every country; "us" = searches / visits from the United States only (the Blog Impact toggle).
    scope: Mapped[str] = mapped_column(String(3), primary_key=True, default="all", server_default="all")
    nonbrand_clicks: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    nonbrand_impressions: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Scope "us" only: the site's US totals, since seo_gsc_daily / seo_ga4_daily cover every country.
    clicks: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    impressions: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    organic_sessions: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)


class SeoBlogState(Base):
    """Per site: Google's data freshness as last seen, and what the blog job has done."""

    __tablename__ = "seo_blog_state"
    __table_args__ = {"schema": SCHEMA}

    site_id: Mapped[str] = _site_fk()
    # From Search Console's response metadata: the first day / hour that is not final yet.
    gsc_first_incomplete_date: Mapped[Optional[dt.date]] = mapped_column(Date, nullable=True)
    gsc_first_incomplete_hour: Mapped[Optional[dt.datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    gsc_final_through: Mapped[Optional[dt.date]] = mapped_column(Date, nullable=True)
    checked_at: Mapped[Optional[dt.datetime]] = mapped_column(DateTime(timezone=True), nullable=True)  # last asked Google
    changed_at: Mapped[Optional[dt.datetime]] = mapped_column(DateTime(timezone=True), nullable=True)  # last time Google had new data
    discovered_on: Mapped[Optional[dt.date]] = mapped_column(Date, nullable=True)  # last blog discovery (once a day)
    queries_on: Mapped[Optional[dt.date]] = mapped_column(Date, nullable=True)  # last search-term refresh (once a day)
    nonbrand_through: Mapped[Optional[dt.date]] = mapped_column(Date, nullable=True)
    us_nonbrand_through: Mapped[Optional[dt.date]] = mapped_column(Date, nullable=True)
    us_site_through: Mapped[Optional[dt.date]] = mapped_column(Date, nullable=True)  # site US clicks / impressions
    us_ga4_site_through: Mapped[Optional[dt.date]] = mapped_column(Date, nullable=True)  # site US organic sessions
    brand_terms: Mapped[list] = mapped_column(JSONB, nullable=False, default=list, server_default="[]")
    last_error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    last_warning: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    updated_at: Mapped[dt.datetime] = _updated()


class SeoBlogSchedule(Base):
    """When the blog job runs (edited on the Blog Impact tab). One row, key 'default'."""

    __tablename__ = "seo_blog_schedule"
    __table_args__ = {"schema": SCHEMA}

    key: Mapped[str] = mapped_column(String(20), primary_key=True, default="default")
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    times: Mapped[list] = mapped_column(JSONB, nullable=False, default=list, server_default='["06:00", "13:00", "20:00"]')  # "HH:MM"
    timezone: Mapped[str] = mapped_column(String(40), nullable=False, default="Asia/Karachi", server_default="Asia/Karachi")
    updated_by_id: Mapped[Optional[str]] = mapped_column(ForeignKey("auth.user.id", ondelete="SET NULL"), nullable=True)
    updated_at: Mapped[dt.datetime] = _updated()


class SeoBlogRun(Base):
    """One run of the blog job."""

    __tablename__ = "seo_blog_run"
    __table_args__ = (Index("ix_seo_blog_run_started_at", "started_at"), {"schema": SCHEMA})

    id: Mapped[str] = id_column()
    trigger: Mapped[str] = mapped_column(String(12), nullable=False)  # schedule | manual
    status: Mapped[str] = mapped_column(String(12), nullable=False, default="running")  # running | success | partial | failed
    started_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    finished_at: Mapped[Optional[dt.datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    started_by_id: Mapped[Optional[str]] = mapped_column(ForeignKey("auth.user.id", ondelete="SET NULL"), nullable=True)
    sites: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    sites_unchanged: Mapped[int] = mapped_column(Integer, nullable=False, default=0)  # Google had nothing new: skipped
    sites_failed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    rows: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
