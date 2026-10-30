"""The plain numbers the scorecard and the rules work from.

`SiteFacts` is built from the database (modules/seo/data.py) for real and
sample sites alike, so scoring.py and rules.py are pure functions of it and are
unit-tested without a database (tests/test_seo_logic.py).
"""
from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class PageFacts:
    url: str
    path: str
    page_type: str = "other"
    status_code: Optional[int] = None
    crawl_error: Optional[str] = None
    checked: bool = False  # fetched at least once
    title: Optional[str] = None
    meta_description: Optional[str] = None
    h1_count: Optional[int] = None
    noindex: Optional[bool] = None
    canonical: Optional[str] = None
    canonical_offsite: bool = False
    word_count: Optional[int] = None
    img_total: Optional[int] = None
    img_with_alt: Optional[int] = None
    schema_types: list[str] = field(default_factory=list)
    index_verdict: Optional[str] = None
    coverage_state: Optional[str] = None
    psi_score: Optional[int] = None
    cwv: Optional[str] = None
    clicks: int = 0  # Search Console, latest complete month
    impressions: int = 0

    @property
    def broken(self) -> bool:
        return self.checked and (self.crawl_error is not None or (self.status_code or 0) >= 400)

    @property
    def not_indexed(self) -> bool:
        if self.index_verdict in ("FAIL",):
            return True
        cs = (self.coverage_state or "").lower()
        return "not indexed" in cs or "excluded" in cs


@dataclass
class KeywordFacts:
    keyword: str
    position: Optional[int]  # Search Console average position, last full month (rounded); None = no impressions
    previous: Optional[int]  # the month before; None = no impressions then
    has_previous: bool = False
    checked_at: Optional[dt.date] = None


@dataclass
class CrawlIssueFacts:
    """One row of a Screaming Frog Issues Overview (latest crawl)."""
    key: str
    name: str
    issue_type: str  # Issue | Warning | Opportunity
    priority: str  # High | Medium | Low
    urls: int
    description: Optional[str] = None
    how_to_fix: Optional[str] = None
    sample: list[str] = field(default_factory=list)  # example URLs


@dataclass
class CrawlPageFacts:
    url: str
    is_html: bool
    status_code: Optional[int]
    indexable: Optional[bool]
    issues: list[str] = field(default_factory=list)  # issue keys


@dataclass
class CrawlFacts:
    """The site's latest Screaming Frog crawl (imported with scripts/seo_import_sf.py)."""
    crawl_id: str
    crawled_on: dt.date
    totals: dict
    issues: list[CrawlIssueFacts] = field(default_factory=list)
    pages: list[CrawlPageFacts] = field(default_factory=list)

    def age_days(self, today: dt.date) -> int:
        return (today - self.crawled_on).days

    @property
    def scored_pages(self) -> list[CrawlPageFacts]:
        """HTML pages, plus any other URL that is broken (a broken image or file is still an error)."""
        return [p for p in self.pages if p.is_html or (p.status_code or 0) >= 400]


@dataclass
class LocalFacts:
    title: str
    profile_pct: int
    verification: str
    open_status: str
    rating: Optional[float]
    reviews: Optional[int]
    phone: Optional[str]
    website_url: Optional[str]
    hours_set: bool
    categories_set: bool
    website_matches: bool
    street: Optional[str] = None
    regular_hours: list = field(default_factory=list)


@dataclass
class PaidFacts:
    name: str
    state: str
    active_campaigns: int
    spend_30d: float
    verification: str
    sync_error: Optional[str]


@dataclass
class SiteFacts:
    domain: str
    name: str
    today: dt.date
    has_gsc: bool = False
    gsc_error: Optional[str] = None
    gsc_through: Optional[dt.date] = None
    clicks_28: int = 0
    clicks_prev_28: int = 0
    impr_28: int = 0
    impr_prev_28: int = 0
    position_28: Optional[float] = None
    pages_with_impr: int = 0
    queries: int = 0
    has_ga4: bool = False
    ga4_through: Optional[dt.date] = None
    sessions_28: int = 0
    sessions_prev_28: int = 0
    key_events_28: float = 0
    key_events_prev_28: float = 0
    # Days at the end of the GA4 series with zero sessions (tracking gap).
    ga4_zero_tail_days: int = 0
    clicks_during_zero_tail: int = 0
    pages: list[PageFacts] = field(default_factory=list)
    keywords: list[KeywordFacts] = field(default_factory=list)
    local: Optional[LocalFacts] = None
    paid: Optional[PaidFacts] = None
    psi_configured: bool = True
    crawl: Optional[CrawlFacts] = None  # latest Screaming Frog crawl, any age

    @property
    def fresh_crawl(self) -> Optional[CrawlFacts]:
        """The crawl, if it is recent enough to score and raise findings from."""
        from app.modules.seo.catalog import CRAWL_MAX_AGE_DAYS

        c = self.crawl
        return c if c and c.age_days(self.today) <= CRAWL_MAX_AGE_DAYS else None

    @property
    def home(self) -> Optional[PageFacts]:
        return next((p for p in self.pages if p.page_type == "home"), None)

    @property
    def checked_pages(self) -> list[PageFacts]:
        return [p for p in self.pages if p.checked]

    @property
    def clicks_change(self) -> Optional[float]:
        """Fractional change of the last 28 days vs the 28 before (None without a base)."""
        if self.clicks_prev_28 <= 0:
            return None
        return (self.clicks_28 - self.clicks_prev_28) / self.clicks_prev_28
