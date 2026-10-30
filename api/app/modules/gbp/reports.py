"""GBP reports built from the local tables (never live Google calls).

Date ranges are inclusive. "Data through" is the latest day any listing has
metrics for — Google publishes daily numbers 2–5 days late, so presets end
there instead of today, and a "Last 7 days" never shows half-empty days.
A missing day for a listing (not synced yet) is excluded, never counted as 0.
"""
from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.gbp import GbpDailyMetric, GbpLocation, GbpPost, GbpReview, GbpSearchKeyword, METRIC_COLUMNS
from app.models.profiling import Merchant
from app.modules.gbp import profile

# Customer actions that make up "Total actions".
ACTIONS = ("website_clicks", "call_clicks", "direction_requests", "menu_clicks", "food_orders", "bookings")
VIEWS = ("impressions_desktop_maps", "impressions_desktop_search", "impressions_mobile_maps", "impressions_mobile_search")
MIN_REVIEWS_FOR_RATING = 10  # "Highest rating" needs at least this many reviews
LOW_PROFILE_PCT = 60
STALE_POST_DAYS = 30
NEW_LISTING_DAYS = 60
DELAY_DAYS = 3  # a listing this many days behind "data through" is flagged
UNANSWERED_FLAG_MIN = 3  # flag a listing once this many new reviews in the period have no reply
MAX_RANGE_DAYS = 550


@dataclass
class Range:
    start: dt.date
    end: dt.date

    @property
    def days(self) -> int:
        return (self.end - self.start).days + 1

    def previous(self) -> "Range":
        return Range(self.start - dt.timedelta(days=self.days), self.start - dt.timedelta(days=1))

    def dto(self) -> dict:
        return {"start": self.start.isoformat(), "end": self.end.isoformat(), "days": self.days}


@dataclass
class Agg:
    days: int = 0
    sums: dict[str, int] = field(default_factory=dict)

    @property
    def has_data(self) -> bool:
        return self.days > 0

    def get(self, col: str) -> Optional[int]:
        return self.sums.get(col, 0) if self.has_data else None

    @property
    def total(self) -> Optional[int]:
        return sum(self.sums.get(c, 0) for c in ACTIONS) if self.has_data else None

    @property
    def views(self) -> Optional[int]:
        return sum(self.sums.get(c, 0) for c in VIEWS) if self.has_data else None

    @property
    def search_views(self) -> Optional[int]:
        return (self.sums.get("impressions_desktop_search", 0) + self.sums.get("impressions_mobile_search", 0)) if self.has_data else None

    @property
    def maps_views(self) -> Optional[int]:
        return (self.sums.get("impressions_desktop_maps", 0) + self.sums.get("impressions_mobile_maps", 0)) if self.has_data else None

    @property
    def mobile_views(self) -> Optional[int]:
        return (self.sums.get("impressions_mobile_maps", 0) + self.sums.get("impressions_mobile_search", 0)) if self.has_data else None

    @property
    def desktop_views(self) -> Optional[int]:
        return (self.sums.get("impressions_desktop_maps", 0) + self.sums.get("impressions_desktop_search", 0)) if self.has_data else None


# --------------------------------------------------------------- basics ----
async def data_through(db: AsyncSession) -> Optional[dt.date]:
    return (await db.execute(select(func.max(GbpDailyMetric.date)))).scalar_one_or_none()


def parse_date(v: Optional[str]) -> Optional[dt.date]:
    if not v:
        return None
    try:
        return dt.date.fromisoformat(v)
    except ValueError:
        raise ValueError(f"'{v}' is not a date (YYYY-MM-DD)")


async def resolve_range(db: AsyncSession, start: Optional[str], end: Optional[str]) -> tuple[Range, Optional[dt.date]]:
    through = await data_through(db)
    e = parse_date(end) or through or (dt.date.today() - dt.timedelta(days=3))
    s = parse_date(start) or (e - dt.timedelta(days=29))
    if s > e:
        raise ValueError("The start date is after the end date.")
    if (e - s).days + 1 > MAX_RANGE_DAYS:
        raise ValueError(f"Pick a range of at most {MAX_RANGE_DAYS} days.")
    return Range(s, e), through


async def aggregate(db: AsyncSession, r: Range, location_ids: Optional[list[str]] = None) -> dict[str, Agg]:
    cols = [func.coalesce(func.sum(getattr(GbpDailyMetric, c)), 0).label(c) for c in METRIC_COLUMNS]
    stmt = (
        select(GbpDailyMetric.location_id, func.count().label("days"), *cols)
        .where(GbpDailyMetric.date >= r.start, GbpDailyMetric.date <= r.end)
        .group_by(GbpDailyMetric.location_id)
    )
    if location_ids is not None:
        stmt = stmt.where(GbpDailyMetric.location_id.in_(location_ids))
    out: dict[str, Agg] = {}
    for row in (await db.execute(stmt)).mappings():
        out[row["location_id"]] = Agg(days=int(row["days"]), sums={c: int(row[c]) for c in METRIC_COLUMNS})
    return out


def pct_change(cur: Optional[float], prev: Optional[float]) -> dict:
    """{'kind': 'pct', 'value': 12} | {'kind': 'new'} | {'kind': 'flat'} | {'kind': 'na'}"""
    if cur is None or prev is None:
        return {"kind": "na"}
    if prev == 0 and cur == 0:
        return {"kind": "flat"}
    if prev == 0:
        return {"kind": "new"}
    return {"kind": "pct", "value": round((cur - prev) / prev * 100)}


def sync_state(loc: GbpLocation, through: Optional[dt.date]) -> str:
    if loc.sync_error:
        return "failed"
    if through and (loc.last_metrics_date is None or (through - loc.last_metrics_date).days >= DELAY_DAYS):
        return "delayed"
    return "ok"


def is_open(loc: GbpLocation) -> bool:
    return loc.open_status in ("OPEN", "UNKNOWN")


def loc_ref(loc: GbpLocation) -> dict:
    return {"id": loc.id, "title": loc.title, "city": loc.city, "storeCode": loc.store_code}


# ------------------------------------------------------------- overview ----
async def overview(db: AsyncSession, start: Optional[str], end: Optional[str]) -> dict:
    r, through = await resolve_range(db, start, end)
    prev = r.previous()
    locs = list((await db.execute(select(GbpLocation).order_by(GbpLocation.title))).scalars().all())
    cur_agg = await aggregate(db, r)
    first_day = dict(
        (await db.execute(select(GbpDailyMetric.location_id, func.min(GbpDailyMetric.date)).group_by(GbpDailyMetric.location_id))).all()
    )
    merchants = dict(
        (
            await db.execute(
                select(Merchant.id, Merchant.restaurant_name).where(Merchant.id.in_(sorted({l.merchant_id for l in locs if l.merchant_id})))
            )
        ).all()
    ) if any(l.merchant_id for l in locs) else {}

    start_ts = dt.datetime.combine(r.start, dt.time.min, tzinfo=dt.timezone.utc)
    end_ts = dt.datetime.combine(r.end + dt.timedelta(days=1), dt.time.min, tzinfo=dt.timezone.utc)
    reviews_in = dict(
        (
            await db.execute(
                select(GbpReview.location_id, func.count())
                .where(GbpReview.create_time >= start_ts, GbpReview.create_time < end_ts)
                .group_by(GbpReview.location_id)
            )
        ).all()
    )
    unanswered_in = dict(
        (
            await db.execute(
                select(GbpReview.location_id, func.count())
                .where(GbpReview.create_time >= start_ts, GbpReview.create_time < end_ts, GbpReview.has_reply.is_(False))
                .group_by(GbpReview.location_id)
            )
        ).all()
    )
    review_stats = {
        lid: (n, avg)
        for lid, n, avg in (
            await db.execute(select(GbpReview.location_id, func.count(), func.avg(GbpReview.star_rating)).group_by(GbpReview.location_id))
        ).all()
    }
    last_post = dict(
        (
            await db.execute(
                select(GbpPost.location_id, func.max(GbpPost.create_time))
                .where(GbpPost.state.is_(None) | (GbpPost.state == "LIVE"))
                .group_by(GbpPost.location_id)
            )
        ).all()
    )

    today = dt.date.today()
    rows: list[dict] = []
    attention: list[dict] = []
    for loc in locs:
        a = cur_agg.get(loc.id, Agg())
        n_reviews, avg = review_stats.get(loc.id, (0, None))
        total_reviews = loc.review_count if loc.review_count is not None else n_reviews
        rating = loc.rating_average if loc.rating_average is not None else (float(avg) if avg is not None else None)
        pct = profile.pct(loc.profile_fields or [])
        state = sync_state(loc, through)
        fd = first_day.get(loc.id)
        is_new = bool(fd and (today - fd).days < NEW_LISTING_DAYS)
        row = {
            **loc_ref(loc),
            "merchant": {"id": loc.merchant_id, "name": merchants.get(loc.merchant_id, "—")} if loc.merchant_id else None,
            "openStatus": loc.open_status,
            "verification": loc.verification,
            "syncState": state,
            "isNew": is_new,
            "isDemo": loc.source == "DEMO",
            "hasData": a.has_data,
            "missingDays": max(0, r.days - a.days) if a.has_data else None,
            "total": a.total,
            "website": a.get("website_clicks"),
            "calls": a.get("call_clicks"),
            "directions": a.get("direction_requests"),
            "menu": a.get("menu_clicks"),
            "orders": a.get("food_orders"),
            "views": a.views,
            "newReviews": int(reviews_in.get(loc.id, 0)),
            "totalReviews": int(total_reviews or 0),
            "rating": round(rating, 2) if rating is not None else None,
            "profilePct": pct,
        }
        rows.append(row)

        flags = _flags(loc, a, row, state, through, int(unanswered_in.get(loc.id, 0)), last_post.get(loc.id), pct)
        if flags:
            attention.append({"location": {**loc_ref(loc), "openStatus": loc.open_status, "syncState": state}, "flags": flags})

    attention.sort(key=lambda x: (-len(x["flags"]), x["location"]["title"]))
    flag_counts: dict[str, int] = {}
    for item in attention:
        for f in item["flags"]:
            flag_counts[f["code"]] = flag_counts.get(f["code"], 0) + 1

    ver = {"verified": 0, "pending": 0, "required": 0, "unknown": 0}
    for l in locs:
        ver[l.verification if l.verification in ver else "unknown"] += 1
    summary = {
        "total": len(locs),
        "open": sum(1 for l in locs if is_open(l)),
        "temporarilyClosed": sum(1 for l in locs if l.open_status == "CLOSED_TEMPORARILY"),
        "permanentlyClosed": sum(1 for l in locs if l.open_status == "CLOSED_PERMANENTLY"),
        "verification": ver,
        "syncIssues": sum(1 for row in rows if row["syncState"] != "ok"),
        "unlinked": sum(1 for l in locs if not l.merchant_id),
        "demo": sum(1 for l in locs if l.source == "DEMO"),
    }

    # Network totals for the range vs previous.
    prev_agg = await aggregate(db, prev)
    totals = {}
    for key, getter in (
        ("total", lambda x: x.total),
        ("views", lambda x: x.views),
        ("website", lambda x: x.get("website_clicks")),
        ("calls", lambda x: x.get("call_clicks")),
        ("directions", lambda x: x.get("direction_requests")),
    ):
        c = sum((getter(v) or 0) for v in cur_agg.values()) if cur_agg else None
        p = sum((getter(v) or 0) for v in prev_agg.values()) if prev_agg else None
        totals[key] = {"current": c, "previous": p, "change": pct_change(c, p)}

    return {
        "range": r.dto(),
        "previous": prev.dto(),
        "dataThrough": through.isoformat() if through else None,
        "summary": summary,
        "totals": totals,
        "topPerformers": _top(rows),
        "attention": attention,
        "flagCounts": flag_counts,
        "rows": rows,
    }


FLAG_LABELS = {
    "sync_failed": "Sync failed",
    "data_delayed": "Data delayed",
    "verification_required": "Verification required",
    "verification_pending": "Verification pending",
    "temporarily_closed": "Marked temporarily closed",
    "zero_calls": "Zero calls",
    "zero_website": "Zero website clicks",
    "zero_directions": "Zero direction requests",
    "no_new_reviews": "No new reviews",
    "unanswered_reviews": "Reviews without a reply",
    "low_profile": "Low profile completion",
    "no_posts": "No published posts",
    "stale_posts": "No recent post",
}


def _flags(
    loc: GbpLocation,
    a: Agg,
    row: dict,
    state: str,
    through: Optional[dt.date],
    unanswered: int,
    last_post: Optional[dt.datetime],
    pct: int,
) -> list[dict]:
    out: list[dict] = []

    def add(code: str, detail: str) -> None:
        out.append({"code": code, "label": FLAG_LABELS[code], "detail": detail})

    if state == "failed":
        add("sync_failed", loc.sync_error or "")
    elif state == "delayed":
        add("data_delayed", f"Latest data {_day(loc.last_metrics_date)}" if loc.last_metrics_date else "No data synced yet")
    if loc.verification == "required":
        add("verification_required", "Google asks for verification")
    elif loc.verification == "pending":
        add("verification_pending", "Waiting for Google")
    if loc.open_status == "CLOSED_PERMANENTLY":
        return out  # performance flags make no sense for a closed listing
    if loc.open_status == "CLOSED_TEMPORARILY":
        add("temporarily_closed", "Listing shows as temporarily closed")
        return out
    if a.has_data:
        if row["calls"] == 0:
            add("zero_calls", "0 calls")
        if row["website"] == 0:
            add("zero_website", "0 website clicks")
        if row["directions"] == 0:
            add("zero_directions", "0 direction requests")
        if row["newReviews"] == 0:
            add("no_new_reviews", "0 new reviews")
    if unanswered >= UNANSWERED_FLAG_MIN:
        add("unanswered_reviews", f"{unanswered} in this period")
    if pct < LOW_PROFILE_PCT:
        add("low_profile", f"{pct}% complete")
    if last_post is None:
        add("no_posts", "0 posts")
    else:
        age = (dt.datetime.now(dt.timezone.utc) - last_post).days
        if age > STALE_POST_DAYS:
            add("stale_posts", f"Last post {_day(last_post.date())}")
    return out


def _day(d: dt.date) -> str:
    return f"{d:%b} {d.day}, {d.year}"  # "Sep 30, 2026" (no %-d: not on Windows)


def _top(rows: list[dict]) -> list[dict]:
    live = [r for r in rows if r["hasData"] and r["openStatus"] in ("OPEN", "UNKNOWN")]
    out = []
    for key, label in (
        ("total", "Total actions"),
        ("website", "Website clicks"),
        ("calls", "Calls"),
        ("directions", "Directions"),
        ("menu", "Menu clicks"),
    ):
        best = max(live, key=lambda r: r[key] or -1, default=None)
        out.append(
            {"key": key, "label": label, "location": _ref(best) if best and (best[key] or 0) > 0 else None, "value": best[key] if best else None}
        )
    rated = [r for r in rows if r["rating"] is not None and r["totalReviews"] >= MIN_REVIEWS_FOR_RATING and r["openStatus"] in ("OPEN", "UNKNOWN")]
    best = max(rated, key=lambda r: (r["rating"], r["totalReviews"]), default=None)
    out.append(
        {
            "key": "rating",
            "label": f"Highest rating ({MIN_REVIEWS_FOR_RATING}+ reviews)",
            "location": _ref(best) if best else None,
            "value": best["rating"] if best else None,
        }
    )
    return out


def _ref(row: dict) -> dict:
    return {"id": row["id"], "title": row["title"], "city": row["city"], "storeCode": row["storeCode"]}


# ------------------------------------------------------- one location ----
async def location_report(db: AsyncSession, loc: GbpLocation, start: Optional[str], end: Optional[str], keyword_month: Optional[str]) -> dict:
    r, through = await resolve_range(db, start, end)
    prev = r.previous()
    cur = (await aggregate(db, r, [loc.id])).get(loc.id, Agg())
    before = (await aggregate(db, prev, [loc.id])).get(loc.id, Agg())

    def kpi(getter) -> dict:
        c, p = getter(cur), getter(before)
        return {"current": c, "previous": p, "change": pct_change(c, p)}

    kpis = {
        "total": kpi(lambda a: a.total),
        "website": kpi(lambda a: a.get("website_clicks")),
        "calls": kpi(lambda a: a.get("call_clicks")),
        "directions": kpi(lambda a: a.get("direction_requests")),
        "menu": kpi(lambda a: a.get("menu_clicks")),
        "orders": kpi(lambda a: a.get("food_orders")),
        "bookings": kpi(lambda a: a.get("bookings")),
    }
    visibility = {
        "search": kpi(lambda a: a.search_views),
        "maps": kpi(lambda a: a.maps_views),
        "mobile": cur.mobile_views,
        "desktop": cur.desktop_views,
    }

    series = await _series(db, loc, r)
    previous_series = await _series(db, loc, prev)

    reviews = await _reviews(db, loc, r, prev)
    posts = await _posts(db, loc, r)
    keywords = await _keywords(db, loc, keyword_month)
    fields = loc.profile_fields or profile.compute(loc)
    merchant = None
    if loc.merchant_id:
        m = await db.get(Merchant, loc.merchant_id)
        merchant = {"id": m.id, "name": m.restaurant_name} if m else None
    first = (await db.execute(select(func.min(GbpDailyMetric.date)).where(GbpDailyMetric.location_id == loc.id))).scalar_one_or_none()

    return {
        "location": {
            **loc_ref(loc),
            "address": ", ".join(x for x in [loc.address_line, loc.city, " ".join(y for y in [loc.state or "", loc.postal_code or ""] if y)] if x),
            "phone": loc.phone,
            "websiteUrl": loc.website_url,
            "menuUrl": loc.menu_url,
            "orderingUrl": loc.ordering_url,
            "mapsUri": loc.maps_uri,
            "primaryCategory": loc.primary_category,
            "openStatus": loc.open_status,
            "verification": loc.verification,
            "syncState": sync_state(loc, through),
            "syncError": loc.sync_error,
            "syncWarning": loc.sync_warning,
            "lastSyncedAt": loc.last_synced_at.isoformat() if loc.last_synced_at else None,
            "lastMetricsDate": loc.last_metrics_date.isoformat() if loc.last_metrics_date else None,
            "firstDataDate": first.isoformat() if first else None,
            "merchant": merchant,
            "isDemo": loc.source == "DEMO",
        },
        "range": r.dto(),
        "previous": prev.dto(),
        "dataThrough": through.isoformat() if through else None,
        "daysWithData": cur.days,
        "missingDays": r.days - cur.days,
        "kpis": kpis,
        "visibility": visibility,
        "series": series,
        "previousSeries": previous_series,
        "insights": _insights(loc, cur, before, reviews, through),
        "keywords": keywords,
        "reviews": reviews,
        "profile": {"pct": profile.pct(fields), "fields": fields},
        "posts": posts,
    }


async def _series(db: AsyncSession, loc: GbpLocation, r: Range) -> list[dict]:
    """One point per day; days without a row are null (not synced), not zero."""
    daily = {
        m.date: m
        for m in (
            await db.execute(
                select(GbpDailyMetric).where(
                    GbpDailyMetric.location_id == loc.id, GbpDailyMetric.date >= r.start, GbpDailyMetric.date <= r.end
                )
            )
        ).scalars()
    }
    out = []
    d = r.start
    while d <= r.end:
        m = daily.get(d)
        out.append(
            {
                "date": d.isoformat(),
                "total": sum(getattr(m, c) for c in ACTIONS) if m else None,
                "website": m.website_clicks if m else None,
                "calls": m.call_clicks if m else None,
                "directions": m.direction_requests if m else None,
                "menu": m.menu_clicks if m else None,
                "orders": m.food_orders if m else None,
                "views": sum(getattr(m, c) for c in VIEWS) if m else None,
            }
        )
        d += dt.timedelta(days=1)
    return out


async def _reviews(db: AsyncSession, loc: GbpLocation, r: Range, prev: Range) -> dict:
    def ts(d: dt.date) -> dt.datetime:
        return dt.datetime.combine(d, dt.time.min, tzinfo=dt.timezone.utc)

    async def count(where) -> int:
        return int((await db.execute(select(func.count()).select_from(GbpReview).where(GbpReview.location_id == loc.id, *where))).scalar_one())

    in_range = await count([GbpReview.create_time >= ts(r.start), GbpReview.create_time < ts(r.end + dt.timedelta(days=1))])
    in_prev = await count([GbpReview.create_time >= ts(prev.start), GbpReview.create_time < ts(prev.end + dt.timedelta(days=1))])
    unanswered = await count(
        [GbpReview.create_time >= ts(r.start), GbpReview.create_time < ts(r.end + dt.timedelta(days=1)), GbpReview.has_reply.is_(False)]
    )
    # Calendar month to date — independent of the picked range.
    this_month = await count([GbpReview.create_time >= ts(dt.date.today().replace(day=1))])
    dist_rows = dict(
        (
            await db.execute(
                select(GbpReview.star_rating, func.count()).where(GbpReview.location_id == loc.id).group_by(GbpReview.star_rating)
            )
        ).all()
    )
    stored = sum(dist_rows.values())
    avg_rows = (await db.execute(select(func.avg(GbpReview.star_rating)).where(GbpReview.location_id == loc.id))).scalar_one_or_none()
    rating_now = loc.rating_average if loc.rating_average is not None else (float(avg_rows) if avg_rows is not None else None)
    # Rating as it stood at the end of the previous period (from stored reviews).
    prev_avg = (
        await db.execute(
            select(func.avg(GbpReview.star_rating)).where(GbpReview.location_id == loc.id, GbpReview.create_time < ts(prev.end + dt.timedelta(days=1)))
        )
    ).scalar_one_or_none()
    end_avg = (
        await db.execute(
            select(func.avg(GbpReview.star_rating)).where(GbpReview.location_id == loc.id, GbpReview.create_time < ts(r.end + dt.timedelta(days=1)))
        )
    ).scalar_one_or_none()
    recent = (
        await db.execute(select(GbpReview).where(GbpReview.location_id == loc.id).order_by(GbpReview.create_time.desc()).limit(5))
    ).scalars().all()
    return {
        "total": loc.review_count if loc.review_count is not None else stored,
        "average": round(rating_now, 2) if rating_now is not None else None,
        "inRange": in_range,
        "previousRange": in_prev,
        "change": pct_change(in_range, in_prev),
        "unansweredInRange": unanswered,
        "thisMonth": this_month,
        "distribution": [{"stars": s, "count": int(dist_rows.get(s, 0))} for s in (5, 4, 3, 2, 1)],
        "ratingAtPreviousEnd": round(float(prev_avg), 2) if prev_avg is not None else None,
        "ratingAtEnd": round(float(end_avg), 2) if end_avg is not None else None,
        "recent": [
            {
                "rating": rv.star_rating,
                "comment": (rv.comment or "")[:400] or None,
                "reviewer": rv.reviewer_name,
                "date": rv.create_time.date().isoformat(),
                "hasReply": rv.has_reply,
            }
            for rv in recent
        ],
    }


async def _posts(db: AsyncSession, loc: GbpLocation, r: Range) -> dict:
    rows = (
        await db.execute(select(GbpPost).where(GbpPost.location_id == loc.id).order_by(GbpPost.create_time.desc()).limit(200))
    ).scalars().all()
    posts = [p for p in rows if p.topic_type != "OFFER"]
    live = [p for p in posts if (p.state or "LIVE") == "LIVE"]
    offers = [p for p in rows if p.topic_type == "OFFER"]
    today = dt.date.today()

    def offer_status(p: GbpPost) -> str:
        if p.start_date and p.start_date > today:
            return "Scheduled"
        if p.end_date and p.end_date < today:
            return "Expired"
        return "Active"

    def post_dto(p: GbpPost) -> dict:
        return {
            "id": p.id,
            "type": p.topic_type,
            "title": p.title or (p.summary or "")[:80] or "Untitled post",
            "date": p.create_time.date().isoformat(),
            "state": p.state or "LIVE",
            "url": p.search_url,
        }

    return {
        "total": len(posts),
        "inRange": sum(1 for p in posts if r.start <= p.create_time.date() <= r.end),
        "latest": live[0].create_time.date().isoformat() if live else None,
        "items": [post_dto(p) for p in posts[:8]],
        "offers": [
            {
                **post_dto(p),
                "summary": (p.summary or "")[:200] or None,
                "start": p.start_date.isoformat() if p.start_date else None,
                "end": p.end_date.isoformat() if p.end_date else None,
                "coupon": p.coupon_code,
                "status": offer_status(p),
            }
            for p in offers[:8]
        ],
    }


async def _keywords(db: AsyncSession, loc: GbpLocation, month: Optional[str]) -> dict:
    months = [
        m
        for m in (
            await db.execute(
                select(GbpSearchKeyword.month).where(GbpSearchKeyword.location_id == loc.id).distinct().order_by(GbpSearchKeyword.month.desc())
            )
        ).scalars()
    ]
    if not months:
        return {"months": [], "month": None, "previousMonth": None, "rows": [], "total": 0}
    chosen = months[0]
    if month:
        try:
            want = dt.date.fromisoformat(month + "-01" if len(month) == 7 else month).replace(day=1)
            if want in months:
                chosen = want
        except ValueError:
            pass
    prev_month = (chosen - dt.timedelta(days=1)).replace(day=1)

    async def load(m: dt.date) -> list[GbpSearchKeyword]:
        return list(
            (await db.execute(select(GbpSearchKeyword).where(GbpSearchKeyword.location_id == loc.id, GbpSearchKeyword.month == m))).scalars()
        )

    cur = await load(chosen)
    before = {k.keyword: k for k in await load(prev_month)} if prev_month in months else {}
    cur.sort(key=lambda k: (k.impressions is None, -(k.impressions or 0), -(k.threshold or 0), k.keyword))
    rows = []
    for k in cur[:10]:
        p = before.get(k.keyword)
        rows.append(
            {
                "keyword": k.keyword,
                "impressions": k.impressions,
                "threshold": k.threshold,
                "previous": p.impressions if p else None,
                "previousThreshold": p.threshold if p else None,
                "change": pct_change(k.impressions, p.impressions) if p and k.impressions is not None and p.impressions is not None else {"kind": "na"},
            }
        )
    return {
        "months": [m.strftime("%Y-%m") for m in months],
        "month": chosen.strftime("%Y-%m"),
        "previousMonth": prev_month.strftime("%Y-%m") if prev_month in months else None,
        "rows": rows,
        "total": len(cur),
    }


def _insights(loc: GbpLocation, cur: Agg, before: Agg, reviews: dict, through: Optional[dt.date]) -> list[str]:
    out: list[str] = []
    if cur.has_data and before.has_data:
        for label, col in (
            ("Calls", "call_clicks"),
            ("Website clicks", "website_clicks"),
            ("Direction requests", "direction_requests"),
            ("Menu clicks", "menu_clicks"),
            ("Online orders", "food_orders"),
        ):
            ch = pct_change(cur.get(col), before.get(col))
            if ch["kind"] == "pct" and abs(ch["value"]) >= 5:
                out.append(f"{label} {'increased' if ch['value'] > 0 else 'decreased'} {abs(ch['value'])}% compared with the previous period.")
            elif ch["kind"] == "new":
                out.append(f"{label} picked up after a previous period with none.")
        ch = pct_change(cur.views, before.views)
        if ch["kind"] == "pct" and abs(ch["value"]) >= 10:
            out.append(f"Profile views {'rose' if ch['value'] > 0 else 'fell'} {abs(ch['value'])}% (Search and Maps combined).")
    n = reviews["inRange"]
    if n:
        out.append(f"{n} new review{'s were' if n != 1 else ' was'} received in this period.")
    if reviews["unansweredInRange"]:
        u = reviews["unansweredInRange"]
        out.append(f"{u} of them {'have' if u != 1 else 'has'} no reply yet.")
    a, b = reviews["ratingAtPreviousEnd"], reviews["ratingAtEnd"]
    if a is not None and b is not None and abs(a - b) >= 0.05:
        out.append(f"Average rating moved from {a:.1f} to {b:.1f}.")
    state = sync_state(loc, through)
    if state == "failed":
        out.append("The last sync for this listing failed, so the newest days are missing.")
    elif state == "delayed":
        out.append("This listing's data is a few days behind the others; it fills in after the next sync.")
    if not cur.has_data:
        out.append("No performance data for this period.")
    if not out:
        out.append("Performance is broadly in line with the previous period.")
    return out
