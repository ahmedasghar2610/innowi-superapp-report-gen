"""Everything the SEO module reads from outside: Google OAuth (shared helpers
from modules/gbp/google.py), Search Console, Google Analytics 4, PageSpeed
Insights. Read-only calls only. The `parse_*` functions are pure
and unit-tested (tests/test_seo_logic.py).

    Search Console API    GET  webmasters/v3/sites
                          POST webmasters/v3/sites/{site}/searchAnalytics/query
                          POST searchconsole v1 urlInspection/index:inspect
    GA4 Admin API         GET  v1beta/accountSummaries · v1beta/{property}/dataStreams
    GA4 Data API          POST v1beta/{property}:runReport
    PageSpeed Insights    GET  pagespeedonline/v5/runPagespeed  (API key)
"""
from __future__ import annotations

import asyncio
import datetime as dt
import logging
from typing import Any, Optional
from urllib.parse import quote, urlencode

import httpx

from app.modules.gbp.google import (  # shared OAuth plumbing
    AUTH_URL,
    GoogleError,
    RateLimiter,
    _json,
    exchange_code,
    refresh_access_token,
    revoke,
    userinfo_email,
)
from app.modules.seo.crawl import host_of, normalize_domain

__all__ = [
    "GoogleError", "RateLimiter", "exchange_code", "refresh_access_token", "revoke", "userinfo_email",
    "SCOPES", "authorize_url", "SeoClient", "pagespeed",
]

logger = logging.getLogger("SEO.google")

SCOPES = [
    "https://www.googleapis.com/auth/webmasters.readonly",
    "https://www.googleapis.com/auth/analytics.readonly",
    # Client SEO reports are e-mailed from the connected Google account (Gmail API).
    "https://www.googleapis.com/auth/gmail.send",
    "openid",
    "email",
]
GSC_SCOPE = "webmasters.readonly"
GA4_SCOPE = "analytics.readonly"
GMAIL_SCOPE = "gmail.send"

GSC_API = "https://www.googleapis.com/webmasters/v3"
INSPECT_API = "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect"
GA4_ADMIN = "https://analyticsadmin.googleapis.com/v1beta"
GA4_DATA = "https://analyticsdata.googleapis.com/v1beta"
PSI_API = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed"

ORGANIC_CHANNELS = {"Organic Search"}


def authorize_url(client_id: str, redirect_uri: str, state: str) -> str:
    params = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": " ".join(SCOPES),
        "access_type": "offline",
        "prompt": "consent",
        "include_granted_scopes": "true",
        "state": state,
    }
    return f"{AUTH_URL}?{urlencode(params)}"


def api_friendly(status: int, body: dict, what: str) -> str:
    err = body.get("error") if isinstance(body.get("error"), dict) else {}
    msg = str(err.get("message") or "")
    low = msg.lower()
    if status == 429 or "quota" in low:
        return f"Google's {what} quota was hit; the next sync will continue."
    if status == 403 and ("has not been used" in low or "disabled" in low):
        return f"The {what} API isn't enabled in the Google Cloud project — turn it on in APIs & Services → Library."
    if status == 403 and "insufficient" in low and "scope" in low:
        return f"The Google sign-in didn't include {what} access. Reconnect and tick every box on Google's screen."
    if status == 403:
        return f"Google refused access (403): the connected account can't read this {what} property."
    if status == 401:
        return "Google access expired. Reconnect in SEO → Connections."
    if status == 404:
        return f"Google couldn't find this {what} property."
    return f"{what} returned an error ({status}){': ' + msg[:160] if msg else ''}."


class SeoClient:
    """Search Console + GA4, bound to one access token."""

    def __init__(self, http: httpx.AsyncClient, access_token: str, limiter: Optional[RateLimiter] = None):
        self.http = http
        self.token = access_token
        self.limiter = limiter

    async def _call(self, method: str, url: str, what: str, params: Any = None, body: Optional[dict] = None) -> dict:
        for attempt in range(3):
            if self.limiter:
                await self.limiter.wait()
            r = await self.http.request(method, url, params=params, json=body, headers={"Authorization": f"Bearer {self.token}"})
            if r.status_code in (429, 500, 502, 503) and attempt < 2:
                await asyncio.sleep(3 * (attempt + 1))
                continue
            if r.status_code != 200:
                raise GoogleError(f"{method} {url} → {r.status_code}: {r.text[:300]}", r.status_code, api_friendly(r.status_code, _json(r), what), auth=r.status_code == 401)
            return _json(r)
        raise GoogleError(f"{method} {url} kept failing", None, f"{what} kept failing; try again later.")

    # ---------------------------------------------------- Search Console ----
    async def gsc_sites(self) -> list[dict]:
        return (await self._call("GET", f"{GSC_API}/sites", "Search Console")).get("siteEntry") or []

    async def gsc_query(self, site_url: str, body: dict) -> list[dict]:
        url = f"{GSC_API}/sites/{quote(site_url, safe='')}/searchAnalytics/query"
        return (await self._call("POST", url, "Search Console", body=body)).get("rows") or []

    async def gsc_daily(self, site_url: str, start: dt.date, end: dt.date) -> list[dict]:
        return await self.gsc_query(site_url, {"startDate": start.isoformat(), "endDate": end.isoformat(), "dimensions": ["date"], "rowLimit": 25000})

    async def gsc_dimension(self, site_url: str, dim: str, start: dt.date, end: dt.date, limit: int) -> list[dict]:
        return await self.gsc_query(site_url, {"startDate": start.isoformat(), "endDate": end.isoformat(), "dimensions": [dim], "rowLimit": limit})

    async def gsc_exact_query(self, site_url: str, query: str, start: dt.date, end: dt.date) -> list[dict]:
        """One search term's clicks / impressions / average position (for tracked keywords outside the top terms)."""
        return await self.gsc_query(site_url, {
            "startDate": start.isoformat(), "endDate": end.isoformat(), "dimensions": ["query"], "rowLimit": 1,
            "dimensionFilterGroups": [{"filters": [{"dimension": "query", "operator": "equals", "expression": query}]}],
        })

    async def gsc_query_body(self, site_url: str, body: dict) -> dict:
        """The whole Search Analytics response: `rows` plus `metadata` (first_incomplete_date / _hour)."""
        url = f"{GSC_API}/sites/{quote(site_url, safe='')}/searchAnalytics/query"
        return await self._call("POST", url, "Search Console", body=body)

    async def gsc_rows_paged(self, site_url: str, body: dict, max_pages: int = 8) -> list[dict]:
        """All rows of a query, 25,000 at a time (Search Console's page size)."""
        out: list[dict] = []
        for page in range(max_pages):
            got = (await self.gsc_query_body(site_url, {**body, "rowLimit": 25000, "startRow": page * 25000})).get("rows") or []
            out.extend(got)
            if len(got) < 25000:
                break
        return out

    async def inspect(self, site_url: str, page_url: str) -> dict:
        return await self._call("POST", INSPECT_API, "URL Inspection", body={"inspectionUrl": page_url, "siteUrl": site_url})

    # ----------------------------------------------------------------- GA4 ----
    async def ga4_account_summaries(self) -> list[dict]:
        out: list[dict] = []
        token = None
        for _ in range(20):
            params: dict = {"pageSize": 200}
            if token:
                params["pageToken"] = token
            body = await self._call("GET", f"{GA4_ADMIN}/accountSummaries", "Google Analytics Admin", params=params)
            out.extend(body.get("accountSummaries") or [])
            token = body.get("nextPageToken")
            if not token:
                break
        return out

    async def ga4_streams(self, prop: str) -> list[dict]:
        return (await self._call("GET", f"{GA4_ADMIN}/{prop}/dataStreams", "Google Analytics Admin", params={"pageSize": 50})).get("dataStreams") or []

    async def ga4_daily(self, prop: str, start: dt.date, end: dt.date) -> dict:
        body = {
            "dateRanges": [{"startDate": start.isoformat(), "endDate": end.isoformat()}],
            "dimensions": [{"name": "date"}, {"name": "sessionDefaultChannelGroup"}],
            "metrics": [{"name": "sessions"}, {"name": "totalUsers"}, {"name": "engagedSessions"}, {"name": "keyEvents"}],
            "limit": 100000,
        }
        return await self._call("POST", f"{GA4_DATA}/{prop}:runReport", "Google Analytics Data", body=body)


    async def ga4_report(self, prop: str, body: dict) -> dict:
        return await self._call("POST", f"{GA4_DATA}/{prop}:runReport", "Google Analytics Data", body=body)

# ================================================================ parsers ====
PERMS_OK = {"siteOwner", "siteFullUser", "siteRestrictedUser"}


def parse_gsc_sites(entries: list[dict]) -> list[dict]:
    """One property per domain: a Domain property (sc-domain:) wins over URL-prefix ones;
    among URL-prefix ones, https wins. Unverified entries are skipped."""
    best: dict[str, dict] = {}

    def rank(url: str) -> int:
        return 3 if url.startswith("sc-domain:") else 2 if url.startswith("https://") else 1

    for e in entries:
        url, perm = e.get("siteUrl") or "", e.get("permissionLevel") or ""
        if not url or perm not in PERMS_OK:
            continue
        dom = normalize_domain(url)
        if not dom:
            continue
        cur = best.get(dom)
        if not cur or rank(url) > rank(cur["property"]):
            best[dom] = {"domain": dom, "property": url, "permission": perm}
    return sorted(best.values(), key=lambda x: x["domain"])


def home_url_for(prop: str, domain: str) -> str:
    if prop.startswith("http"):
        return prop if prop.endswith("/") else prop + "/"
    return f"https://{domain}/"


def parse_gsc_daily(rows: list[dict]) -> dict[dt.date, dict]:
    out: dict[dt.date, dict] = {}
    for r in rows:
        keys = r.get("keys") or []
        if not keys:
            continue
        try:
            d = dt.date.fromisoformat(keys[0])
        except ValueError:
            continue
        out[d] = {"clicks": int(r.get("clicks") or 0), "impressions": int(r.get("impressions") or 0),
                  "position": float(r["position"]) if r.get("position") is not None else None}
    return out


def parse_gsc_dimension(rows: list[dict], max_len: int) -> list[dict]:
    out = []
    for r in rows:
        keys = r.get("keys") or []
        if not keys or not keys[0]:
            continue
        out.append({"key": str(keys[0])[:max_len], "clicks": int(r.get("clicks") or 0), "impressions": int(r.get("impressions") or 0),
                    "position": float(r["position"]) if r.get("position") is not None else None})
    return out


def parse_inspection(body: dict) -> dict:
    r = ((body.get("inspectionResult") or {}).get("indexStatusResult")) or {}
    return {"index_verdict": (r.get("verdict") or None) and str(r["verdict"])[:24],
            "coverage_state": (r.get("coverageState") or None) and str(r["coverageState"])[:200]}


def parse_ga4_properties(summaries: list[dict]) -> list[dict]:
    out = []
    for a in summaries:
        for p in a.get("propertySummaries") or []:
            if p.get("property"):
                out.append({"property": p["property"], "name": p.get("displayName") or p["property"], "account": a.get("displayName") or a.get("account"), "hosts": []})
    return out


def parse_stream_hosts(streams: list[dict]) -> list[str]:
    hosts = []
    for s in streams:
        uri = ((s.get("webStreamData") or {}).get("defaultUri")) or ""
        h = host_of(uri) if uri else ""
        if h and h not in hosts:
            hosts.append(h)
    return hosts


def parse_ga4_daily(body: dict) -> dict[dt.date, dict]:
    """Rows are (date, channel) → summed per day; organic = 'Organic Search'."""
    out: dict[dt.date, dict] = {}
    for row in body.get("rows") or []:
        dims = [d.get("value") for d in row.get("dimensionValues") or []]
        mets = [m.get("value") for m in row.get("metricValues") or []]
        if len(dims) < 2 or len(mets) < 4:
            continue
        try:
            d = dt.datetime.strptime(dims[0], "%Y%m%d").date()
        except (TypeError, ValueError):
            continue
        sessions, users, engaged = (int(float(mets[i] or 0)) for i in range(3))
        key = float(mets[3] or 0)
        cur = out.setdefault(d, {"sessions": 0, "users": 0, "engaged_sessions": 0, "key_events": 0.0, "organic_sessions": 0, "organic_key_events": 0.0})
        cur["sessions"] += sessions
        cur["users"] += users
        cur["engaged_sessions"] += engaged
        cur["key_events"] += key
        if dims[1] in ORGANIC_CHANNELS:
            cur["organic_sessions"] += sessions
            cur["organic_key_events"] += key
    return out


# =========================================================== PageSpeed ====
async def pagespeed(http: httpx.AsyncClient, url: str, key: str) -> dict:
    params = {"url": url, "strategy": "mobile", "category": "performance", "key": key}
    try:
        r = await http.get(PSI_API, params=params, timeout=90.0)
    except httpx.HTTPError as exc:
        raise GoogleError(f"PageSpeed {url}: {exc}", None, "PageSpeed Insights didn't answer in time.")
    if r.status_code != 200:
        raise GoogleError(f"PageSpeed {url} → {r.status_code}: {r.text[:300]}", r.status_code, api_friendly(r.status_code, _json(r), "PageSpeed Insights"))
    return _json(r)


def parse_pagespeed(body: dict) -> dict:
    lh = body.get("lighthouseResult") or {}
    perf = ((lh.get("categories") or {}).get("performance") or {}).get("score")
    audits = lh.get("audits") or {}

    def num(k):
        v = (audits.get(k) or {}).get("numericValue")
        return float(v) if v is not None else None

    le = body.get("loadingExperience") or {}
    metrics = le.get("metrics") or {}
    overall = le.get("overall_category")
    inp = (metrics.get("INTERACTION_TO_NEXT_PAINT") or {}).get("percentile")
    lcp = num("largest-contentful-paint")
    cls = num("cumulative-layout-shift")
    return {
        "psi_score": round(float(perf) * 100) if perf is not None else None,
        "lcp_ms": round(lcp) if lcp is not None else None,
        "cls": round(cls, 3) if cls is not None else None,
        "inp_ms": int(inp) if inp is not None else None,
        "cwv": ("pass" if overall == "FAST" else "fail") if (metrics and overall in ("FAST", "AVERAGE", "SLOW")) else "none",
    }
