"""Google OAuth + Business Profile API client.

Everything that talks to Google lives here; the rest of the module only sees
plain dicts shaped for our tables (the `parse_*` functions). Each parser is a
pure function so it is unit-tested without the network
(tests/test_gbp_google.py).

APIs used (all with the `business.manage` scope, read-only calls):

    Account Management   GET v1/accounts
    Business Information GET v1/{account}/locations?readMask=…
                         GET v1/{location}/attributes
    Verifications        GET v1/{location}/VoiceOfMerchantState
    Performance          GET v1/{location}:fetchMultiDailyMetricsTimeSeries
                         GET v1/{location}/searchkeywords/impressions/monthly
    My Business v4       GET v4/{account}/{location}/reviews | localPosts | media

Docs: https://developers.google.com/my-business
"""
from __future__ import annotations

import asyncio
import datetime as dt
import logging
import time
from typing import Any, Optional
from urllib.parse import urlencode

import httpx

logger = logging.getLogger("GBP.google")

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
REVOKE_URL = "https://oauth2.googleapis.com/revoke"
USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"
SCOPES = ["https://www.googleapis.com/auth/business.manage", "openid", "email"]

ACCOUNTS_API = "https://mybusinessaccountmanagement.googleapis.com/v1"
INFO_API = "https://mybusinessbusinessinformation.googleapis.com/v1"
VERIFY_API = "https://mybusinessverifications.googleapis.com/v1"
PERF_API = "https://businessprofileperformance.googleapis.com/v1"
V4_API = "https://mybusiness.googleapis.com/v4"

READ_MASK = ",".join(
    [
        "name",
        "title",
        "storeCode",
        "phoneNumbers",
        "categories",
        "storefrontAddress",
        "websiteUri",
        "regularHours",
        "profile",
        "openInfo",
        "metadata",
        "latlng",
    ]
)

# Business Profile Performance API DailyMetric → our gbp_daily_metric column.
DAILY_METRICS: dict[str, str] = {
    "BUSINESS_IMPRESSIONS_DESKTOP_MAPS": "impressions_desktop_maps",
    "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH": "impressions_desktop_search",
    "BUSINESS_IMPRESSIONS_MOBILE_MAPS": "impressions_mobile_maps",
    "BUSINESS_IMPRESSIONS_MOBILE_SEARCH": "impressions_mobile_search",
    "WEBSITE_CLICKS": "website_clicks",
    "CALL_CLICKS": "call_clicks",
    "BUSINESS_DIRECTION_REQUESTS": "direction_requests",
    "BUSINESS_FOOD_MENU_CLICKS": "menu_clicks",
    "BUSINESS_FOOD_ORDERS": "food_orders",
    "BUSINESS_BOOKINGS": "bookings",
    "BUSINESS_CONVERSATIONS": "conversations",
}

STARS = {"ONE": 1, "TWO": 2, "THREE": 3, "FOUR": 4, "FIVE": 5}
SOCIAL_HINTS = ("facebook", "instagram", "twitter", "youtube", "tiktok", "linkedin", "pinterest", "yelp")


class GoogleError(RuntimeError):
    """A Google call failed. `friendly` is safe to show in the UI."""

    def __init__(self, message: str, status: int | None = None, friendly: str | None = None, auth: bool = False):
        super().__init__(message)
        self.status = status
        self.friendly = friendly or message
        # True when the refresh token is no longer usable → reconnect needed.
        self.auth = auth


# ================================================================ OAuth ====
def authorize_url(client_id: str, redirect_uri: str, state: str) -> str:
    params = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": " ".join(SCOPES),
        # offline + consent → Google returns a refresh token every time.
        "access_type": "offline",
        "prompt": "consent",
        "include_granted_scopes": "true",
        "state": state,
    }
    return f"{AUTH_URL}?{urlencode(params)}"


async def exchange_code(http: httpx.AsyncClient, client_id: str, client_secret: str, redirect_uri: str, code: str) -> dict:
    r = await http.post(
        TOKEN_URL,
        data={
            "code": code,
            "client_id": client_id,
            "client_secret": client_secret,
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code",
        },
    )
    if r.status_code != 200:
        raise GoogleError(f"Token exchange failed: {r.status_code} {r.text[:300]}", r.status_code, _oauth_friendly(r))
    return r.json()


async def refresh_access_token(http: httpx.AsyncClient, client_id: str, client_secret: str, refresh_token: str) -> str:
    r = await http.post(
        TOKEN_URL,
        data={
            "client_id": client_id,
            "client_secret": client_secret,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
        },
    )
    if r.status_code != 200:
        body = _json(r)
        auth = body.get("error") in {"invalid_grant", "unauthorized_client", "invalid_client"}
        raise GoogleError(f"Token refresh failed: {r.status_code} {r.text[:300]}", r.status_code, _oauth_friendly(r), auth=auth)
    return r.json()["access_token"]


async def userinfo_email(http: httpx.AsyncClient, access_token: str) -> Optional[str]:
    try:
        r = await http.get(USERINFO_URL, headers={"Authorization": f"Bearer {access_token}"})
        return r.json().get("email") if r.status_code == 200 else None
    except httpx.HTTPError:
        return None


async def revoke(http: httpx.AsyncClient, token: str) -> None:
    try:
        await http.post(REVOKE_URL, data={"token": token})
    except httpx.HTTPError:
        pass  # best effort — the row is deleted either way


def _json(r: httpx.Response) -> dict:
    try:
        v = r.json()
        return v if isinstance(v, dict) else {}
    except ValueError:
        return {}


def _oauth_friendly(r: httpx.Response) -> str:
    err = _json(r).get("error")
    if err == "invalid_grant":
        return "Google access was revoked or has expired. Click Connect again."
    if err in {"invalid_client", "unauthorized_client"}:
        return "Google rejected the OAuth client. Check GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET in the API's settings (environment variables)."
    if err == "redirect_uri_mismatch":
        return "The redirect URI isn't listed on the Google OAuth client. Add GBP_OAUTH_REDIRECT_URI to it exactly."
    return "Google sign-in failed. Try Connect again."


def api_friendly(status: int, body: dict) -> str:
    """Turn a Business Profile API error into one line for the UI."""
    err = body.get("error") if isinstance(body.get("error"), dict) else {}
    msg = str(err.get("message") or "")
    low = msg.lower()
    if status == 429 or "quota" in low:
        return (
            "Google's request quota was hit. If every sync stops here, the Business Profile API "
            "access request is still pending (quota 0 until Google approves it)."
        )
    if status == 403 and ("has not been used" in low or "disabled" in low):
        return "One of the Business Profile APIs isn't enabled in the Google Cloud project (" + msg[:160] + ")."
    if status == 403:
        return "Google refused access (403). The connected account may not manage this listing, or API access isn't approved yet."
    if status == 401:
        return "Google access expired. Click Connect again."
    if status == 404:
        return "Google couldn't find this listing (it may have been removed from the account)."
    return f"Google returned an error ({status}){': ' + msg[:160] if msg else ''}."


# ============================================================== client ====
class RateLimiter:
    """Simple shared pacing: at most `per_minute` calls, evenly spaced."""

    def __init__(self, per_minute: int):
        self.interval = 60.0 / max(1, per_minute)
        self._next = 0.0
        self._lock = asyncio.Lock()

    async def wait(self) -> None:
        async with self._lock:
            now = time.monotonic()
            delay = self._next - now
            self._next = max(now, self._next) + self.interval
        if delay > 0:
            await asyncio.sleep(delay)


class GbpClient:
    """Read-only Business Profile client bound to one access token."""

    def __init__(self, http: httpx.AsyncClient, access_token: str, limiter: Optional[RateLimiter] = None):
        self.http = http
        self.token = access_token
        self.limiter = limiter

    async def _get(self, url: str, params: Any = None) -> dict:
        for attempt in range(3):
            if self.limiter:
                await self.limiter.wait()
            r = await self.http.get(url, params=params, headers={"Authorization": f"Bearer {self.token}"})
            if r.status_code == 429 and attempt < 2:
                await asyncio.sleep(5 * (attempt + 1))
                continue
            if r.status_code >= 500 and attempt < 2:
                await asyncio.sleep(2 * (attempt + 1))
                continue
            if r.status_code != 200:
                body = _json(r)
                raise GoogleError(
                    f"GET {url} → {r.status_code}: {r.text[:300]}", r.status_code, api_friendly(r.status_code, body), auth=r.status_code == 401
                )
            return _json(r)
        raise GoogleError(f"GET {url} kept failing", None, "Google kept failing; try again later.")

    async def _paged(self, url: str, key: str, params: Optional[dict] = None, max_pages: int = 50) -> list[dict]:
        out: list[dict] = []
        token = None
        for _ in range(max_pages):
            p = dict(params or {})
            if token:
                p["pageToken"] = token
            body = await self._get(url, p)
            out.extend(body.get(key) or [])
            token = body.get("nextPageToken")
            if not token:
                break
        return out

    # ---- accounts / locations ----
    async def accounts(self) -> list[dict]:
        return await self._paged(f"{ACCOUNTS_API}/accounts", "accounts", {"pageSize": 20})

    async def locations(self, account: str) -> list[dict]:
        return await self._paged(f"{INFO_API}/{account}/locations", "locations", {"readMask": READ_MASK, "pageSize": 100})

    async def attributes(self, location: str) -> list[dict]:
        body = await self._get(f"{INFO_API}/{location}/attributes")
        return body.get("attributes") or []

    async def voice_of_merchant(self, location: str) -> dict:
        return await self._get(f"{VERIFY_API}/{location}/VoiceOfMerchantState")

    # ---- performance ----
    async def daily_metrics(self, location: str, start: dt.date, end: dt.date) -> dict:
        params: list[tuple[str, Any]] = [("dailyMetrics", m) for m in DAILY_METRICS]
        params += [
            ("dailyRange.start_date.year", start.year),
            ("dailyRange.start_date.month", start.month),
            ("dailyRange.start_date.day", start.day),
            ("dailyRange.end_date.year", end.year),
            ("dailyRange.end_date.month", end.month),
            ("dailyRange.end_date.day", end.day),
        ]
        return await self._get(f"{PERF_API}/{location}:fetchMultiDailyMetricsTimeSeries", params)

    async def search_keywords(self, location: str, month: dt.date) -> list[dict]:
        params = {
            "monthlyRange.start_month.year": month.year,
            "monthlyRange.start_month.month": month.month,
            "monthlyRange.end_month.year": month.year,
            "monthlyRange.end_month.month": month.month,
            "pageSize": 100,
        }
        return await self._paged(f"{PERF_API}/{location}/searchkeywords/impressions/monthly", "searchKeywordsCounts", params, max_pages=3)

    # ---- v4: reviews / posts / media ----
    async def reviews_page(self, account: str, location: str, page_token: Optional[str] = None) -> dict:
        p: dict[str, Any] = {"pageSize": 50, "orderBy": "updateTime desc"}
        if page_token:
            p["pageToken"] = page_token
        return await self._get(f"{V4_API}/{account}/{location}/reviews", p)

    async def posts(self, account: str, location: str) -> list[dict]:
        return await self._paged(f"{V4_API}/{account}/{location}/localPosts", "localPosts", {"pageSize": 100}, max_pages=2)

    async def media(self, account: str, location: str) -> dict:
        return await self._get(f"{V4_API}/{account}/{location}/media", {"pageSize": 100})


# ============================================================= parsers ====
def _date(d: Optional[dict]) -> Optional[dt.date]:
    if not d or not d.get("year"):
        return None
    try:
        return dt.date(int(d["year"]), int(d.get("month") or 1), int(d.get("day") or 1))
    except (TypeError, ValueError):
        return None


def parse_ts(v: Any) -> Optional[dt.datetime]:
    if not v:
        return None
    try:
        return dt.datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    except ValueError:
        return None


def _hhmm(t: Optional[dict]) -> str:
    t = t or {}
    return f"{int(t.get('hours') or 0):02d}:{int(t.get('minutes') or 0):02d}"


def parse_location(raw: dict, account: str) -> dict:
    """Business Information `Location` → gbp_location columns."""
    addr = raw.get("storefrontAddress") or {}
    lines = [l for l in (addr.get("addressLines") or []) if l]
    cats = raw.get("categories") or {}
    primary = (cats.get("primaryCategory") or {}).get("displayName")
    extra = [c.get("displayName") for c in (cats.get("additionalCategories") or []) if c.get("displayName")]
    hours = []
    for p in (raw.get("regularHours") or {}).get("periods") or []:
        hours.append({"day": p.get("openDay"), "open": _hhmm(p.get("openTime")), "close": _hhmm(p.get("closeTime")), "closeDay": p.get("closeDay")})
    meta = raw.get("metadata") or {}
    latlng = raw.get("latlng") or {}
    open_status = (raw.get("openInfo") or {}).get("status") or "OPEN"
    if open_status == "OPEN_FOR_BUSINESS_UNSPECIFIED":
        open_status = "UNKNOWN"
    return {
        "google_location_id": raw["name"],
        "google_account_id": account,
        "title": raw.get("title") or raw["name"],
        "store_code": raw.get("storeCode"),
        "address_line": ", ".join(lines) or None,
        "city": addr.get("locality"),
        "state": addr.get("administrativeArea"),
        "postal_code": addr.get("postalCode"),
        "country": addr.get("regionCode"),
        "latitude": latlng.get("latitude"),
        "longitude": latlng.get("longitude"),
        "phone": (raw.get("phoneNumbers") or {}).get("primaryPhone"),
        "website_url": raw.get("websiteUri"),
        "primary_category": primary,
        "additional_categories": extra,
        "regular_hours": hours,
        "description": (raw.get("profile") or {}).get("description"),
        "maps_uri": meta.get("mapsUri"),
        "place_id": meta.get("placeId"),
        "open_status": open_status,
    }


def parse_attributes(attrs: list[dict]) -> dict:
    """Menu / ordering / social links out of the location's attributes."""
    menu = ordering = None
    social: list[str] = []
    for a in attrs:
        name = str(a.get("name") or "").lower()
        uris = [u.get("uri") for u in (a.get("uriValues") or []) if u.get("uri")]
        if not uris:
            continue
        if "menu" in name and not menu:
            menu = uris[0]
        elif "order" in name and not ordering:
            ordering = uris[0]
        elif any(h in name for h in SOCIAL_HINTS):
            social.extend(uris)
    return {"menu_url": menu, "ordering_url": ordering, "social_links": social, "attribute_count": len(attrs)}


def parse_verification(vom: dict) -> str:
    if vom.get("hasVoiceOfMerchant"):
        return "verified"
    if "waitForVoiceOfMerchant" in vom:
        return "pending"
    if "verify" in vom or "resolveOwnershipConflict" in vom or "complyWithGuidelines" in vom:
        return "required"
    return "unknown"


def parse_media(body: dict) -> dict:
    items = body.get("mediaItems") or []
    cats = [((m.get("locationAssociation") or {}).get("category") or "") for m in items]
    total = body.get("totalMediaItemCount")
    return {
        "photo_count": int(total) if total is not None else len(items),
        "has_logo": "LOGO" in cats,
        "has_cover": "COVER" in cats,
    }


def parse_daily_metrics(body: dict) -> dict[dt.date, dict[str, int]]:
    """fetchMultiDailyMetricsTimeSeries → {date: {column: value}}.

    Google returns a dated entry for every day in the range, leaving `value`
    out when it is zero — and ALSO for the last few days it hasn't processed
    yet. Trailing days on which no metric has a value are therefore dropped
    (unknown, not zero); days before the last day with data are kept as zero.
    """
    days: dict[dt.date, dict[str, int]] = {}
    has_value: set[dt.date] = set()
    for multi in body.get("multiDailyMetricTimeSeries") or []:
        for series in multi.get("dailyMetricTimeSeries") or []:
            col = DAILY_METRICS.get(series.get("dailyMetric") or "")
            if not col:
                continue
            for dv in (series.get("timeSeries") or {}).get("datedValues") or []:
                d = _date(dv.get("date"))
                if not d:
                    continue
                row = days.setdefault(d, {})
                if "value" in dv:
                    row[col] = int(dv["value"])
                    has_value.add(d)
                else:
                    row.setdefault(col, 0)
    if not has_value:
        return {}
    last = max(has_value)
    return {d: {c: row.get(c, 0) for c in DAILY_METRICS.values()} for d, row in days.items() if d <= last}


def parse_keywords(rows: list[dict]) -> list[dict]:
    out = []
    for r in rows:
        kw = (r.get("searchKeyword") or "").strip()
        if not kw:
            continue
        iv = r.get("insightsValue") or {}
        value = int(iv["value"]) if "value" in iv else None
        threshold = int(iv["threshold"]) if "threshold" in iv else None
        out.append({"keyword": kw[:300], "impressions": value, "threshold": threshold})
    return out


def parse_review(raw: dict) -> Optional[dict]:
    rid = raw.get("name") or raw.get("reviewId")
    created = parse_ts(raw.get("createTime"))
    if not rid or not created:
        return None
    reply = raw.get("reviewReply") or {}
    return {
        "google_review_id": rid[:200],
        "star_rating": STARS.get(raw.get("starRating") or ""),
        "comment": raw.get("comment"),
        "reviewer_name": ((raw.get("reviewer") or {}).get("displayName") or None),
        "create_time": created,
        "update_time": parse_ts(raw.get("updateTime")),
        "has_reply": bool(reply.get("comment")),
        "reply_time": parse_ts(reply.get("updateTime")),
    }


def parse_post(raw: dict) -> Optional[dict]:
    pid = raw.get("name")
    created = parse_ts(raw.get("createTime"))
    if not pid or not created:
        return None
    event = raw.get("event") or {}
    sched = event.get("schedule") or {}
    offer = raw.get("offer") or {}
    summary = raw.get("summary") or ""
    title = event.get("title") or (summary.split("\n", 1)[0][:120] if summary else None)
    return {
        "google_post_id": pid[:200],
        "topic_type": raw.get("topicType") or "STANDARD",
        "title": title,
        "summary": summary or None,
        "state": raw.get("state"),
        "create_time": created,
        "start_date": _date(sched.get("startDate")),
        "end_date": _date(sched.get("endDate")),
        "coupon_code": offer.get("couponCode"),
        "search_url": raw.get("searchUrl"),
    }
