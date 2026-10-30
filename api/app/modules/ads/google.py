"""Google Ads API client + parsers.

Everything that talks to Google lives here; the rest of the module only sees
plain dicts shaped for our tables (the `parse_*` functions). Each parser is a
pure function so it is unit-tested without the network
(tests/test_ads_google.py).

Same calls the n8n workflow made (REST `googleAds:searchStream`, developer
token + login-customer-id = the manager account), plus the extra reads the Ads
pages need. All read-only — nothing here changes a Google Ads account.

    customer_client      the client accounts under the manager account
    campaign             name, status, type, daily budget (+ start/end dates)
    campaign × date      daily spend, impressions, clicks and the location-asset
                         actions n8n reported (calls, directions, website, orders, menu)
    asset_group_asset    Performance Max assets (headlines, images, logos, videos…)
    campaign_asset /     sitelinks, promotions, callouts
      customer_asset
    getIdentityVerification   advertiser verification status

Docs: https://developers.google.com/google-ads/api/rest/overview
"""
from __future__ import annotations

import asyncio
import datetime as dt
import logging
from typing import Any, Optional
from urllib.parse import urlencode

import httpx

from app.modules.gbp.google import _json, _oauth_friendly  # noqa: F401 — shared OAuth error wording

logger = logging.getLogger("Ads.google")

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
SCOPES = ["https://www.googleapis.com/auth/adwords", "openid", "email"]
API_BASE = "https://googleads.googleapis.com"

# The five location-asset conversions the n8n workflow reported, in sheet order.
LOCATION_METRICS = {
    "calls": "all_conversions_from_location_asset_click_to_call",
    "directions": "all_conversions_from_location_asset_directions",
    "website": "all_conversions_from_location_asset_website",
    "orders": "all_conversions_from_location_asset_order",
    "menu": "all_conversions_from_location_asset_menu",
}


class GoogleAdsError(RuntimeError):
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
        "access_type": "offline",
        "prompt": "consent",
        "include_granted_scopes": "true",
        "state": state,
    }
    return f"{AUTH_URL}?{urlencode(params)}"


# ============================================================== queries ====
Q_CLIENTS = (
    "SELECT customer_client.id, customer_client.descriptive_name, customer_client.manager, customer_client.status, "
    "customer_client.level, customer_client.currency_code, customer_client.time_zone, customer_client.hidden "
    "FROM customer_client WHERE customer_client.level <= 1"
)
Q_CUSTOMER = "SELECT customer.id, customer.descriptive_name, customer.status, customer.currency_code, customer.time_zone FROM customer"
Q_CAMPAIGNS = (
    "SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign_budget.amount_micros "
    "FROM campaign WHERE campaign.status != 'REMOVED'"
)
# Google renamed start/end dates to *_date_time in a recent API version; the
# sync tries the new names first and falls back.
Q_CAMPAIGN_DATES_NEW = "SELECT campaign.id, campaign.start_date_time, campaign.end_date_time FROM campaign WHERE campaign.status != 'REMOVED'"
Q_CAMPAIGN_DATES_OLD = "SELECT campaign.id, campaign.start_date, campaign.end_date FROM campaign WHERE campaign.status != 'REMOVED'"


def q_daily(start: dt.date, end: dt.date) -> str:
    # Same metrics as the n8n query, plus clicks, split by day and campaign.
    loc = ", ".join(f"metrics.{m}" for m in LOCATION_METRICS.values())
    return (
        "SELECT campaign.id, campaign.name, campaign.status, segments.date, metrics.cost_micros, metrics.impressions, "
        f"metrics.clicks, {loc} FROM campaign WHERE segments.date BETWEEN '{start.isoformat()}' AND '{end.isoformat()}'"
    )


Q_ASSET_GROUP_ASSETS = (
    "SELECT asset_group.campaign, asset_group_asset.field_type, asset_group_asset.status, asset.id, asset.name, asset.type, "
    "asset.text_asset.text, asset.image_asset.full_size.url, asset.image_asset.full_size.width_pixels, "
    "asset.image_asset.full_size.height_pixels, asset.youtube_video_asset.youtube_video_id, "
    "asset.youtube_video_asset.youtube_video_title "
    "FROM asset_group_asset WHERE asset_group_asset.status != 'REMOVED' AND campaign.status != 'REMOVED'"
)
_EXT_FIELDS = (
    "asset.id, asset.name, asset.type, asset.final_urls, asset.sitelink_asset.link_text, asset.sitelink_asset.description1, "
    "asset.sitelink_asset.description2, asset.promotion_asset.promotion_target, asset.promotion_asset.percent_off, "
    "asset.promotion_asset.money_amount_off.amount_micros, asset.promotion_asset.promotion_code, "
    "asset.promotion_asset.start_date, asset.promotion_asset.end_date, asset.promotion_asset.occasion, "
    "asset.callout_asset.callout_text"
)
Q_CAMPAIGN_ASSETS = (
    f"SELECT campaign.id, campaign.status, campaign_asset.field_type, campaign_asset.status, {_EXT_FIELDS} "
    "FROM campaign_asset WHERE campaign_asset.status != 'REMOVED' AND campaign.status != 'REMOVED' "
    "AND campaign_asset.field_type IN ('SITELINK', 'PROMOTION', 'CALLOUT')"
)
Q_CUSTOMER_ASSETS = (
    f"SELECT customer_asset.field_type, customer_asset.status, {_EXT_FIELDS} "
    "FROM customer_asset WHERE customer_asset.status != 'REMOVED' "
    "AND customer_asset.field_type IN ('SITELINK', 'PROMOTION', 'CALLOUT')"
)


# ============================================================== client ====
def api_friendly(status: int, body: Any) -> str:
    """Turn a Google Ads API error into one line for the UI."""
    err = body[0].get("error") if isinstance(body, list) and body and isinstance(body[0], dict) else (body.get("error") if isinstance(body, dict) else None)
    err = err if isinstance(err, dict) else {}
    msg = str(err.get("message") or "")
    detail = ""
    for d in err.get("details") or []:
        for e in (d or {}).get("errors") or []:
            code = e.get("errorCode") or {}
            detail = " ".join(f"{k}={v}" for k, v in code.items()) + (f" — {e.get('message')}" if e.get("message") else "")
            break
        if detail:
            break
    blob = f"{msg} {detail}"
    low = blob.lower()
    if "cloud_project_not_approved_for_production" in low or "only approved for use with test accounts" in low:
        return ("The Google Cloud project of the OAuth client has no Google Ads API access for real accounts yet. "
                "Google Cloud Console → Google Ads API Overview → Upgrade access level → Apply (Explorer or Basic).")
    if "cloud_project_not_under_organization" in low or "project_disabled" in low or "missing_tos" in low:
        return ("Google blocked the OAuth client's Google Cloud project (" + detail.split(" — ")[0] + "). "
                "Check the Google Ads API Overview page in Google Cloud Console.")
    if "developer_token_not_approved" in low or "developer token is only approved for use with test accounts" in low:
        return "The developer token only has test access. Apply for Basic access in the manager account's API Center."
    if "developer_token" in low and ("invalid" in low or "prohibited" in low or "not_whitelisted" in low):
        return "Google rejected the developer token. Check GOOGLE_ADS_DEVELOPER_TOKEN in the API's settings (environment variables)."
    if "has not been used" in low or "is disabled" in low or "service_disabled" in low:
        return "The Google Ads API isn't enabled in the Google Cloud project of the OAuth client."
    if "user_permission_denied" in low or "customer_not_enabled" in low:
        return "The connected Google user can't access this account through the manager account (check GOOGLE_ADS_LOGIN_CUSTOMER_ID and the user's access)."
    if status == 429 or "resource_exhausted" in low or "quota" in low:
        return "Google Ads API quota reached. The next sync will continue."
    if status == 401:
        return "Google access expired. Click Connect Google Ads again."
    if status == 403:
        return "Google refused access (403)" + (f": {msg[:120]}" if msg else "") + (f" [{detail[:160]}]" if detail else ".")
    return f"Google Ads returned an error ({status})" + (f": {(detail or msg)[:200]}" if (detail or msg) else ".")


class AdsClient:
    """Read-only Google Ads client bound to one access token."""

    def __init__(self, http: httpx.AsyncClient, access_token: str, developer_token: str, login_customer_id: Optional[str], version: str = "v24"):
        self.http = http
        self.token = access_token
        self.developer_token = developer_token
        self.login_customer_id = login_customer_id
        self.base = f"{API_BASE}/{version}"

    def _headers(self) -> dict:
        h = {"Authorization": f"Bearer {self.token}", "developer-token": self.developer_token, "Content-Type": "application/json"}
        if self.login_customer_id:
            h["login-customer-id"] = self.login_customer_id
        return h

    async def _request(self, method: str, url: str, json: Any = None) -> Any:
        for attempt in range(3):
            r = await self.http.request(method, url, json=json, headers=self._headers())
            if r.status_code in (429, 500, 502, 503, 504) and attempt < 2:
                await asyncio.sleep(3 * (attempt + 1))
                continue
            if r.status_code != 200:
                try:
                    body = r.json()
                except ValueError:
                    body = {}
                raise GoogleAdsError(
                    f"{method} {url} → {r.status_code}: {r.text[:400]}", r.status_code, api_friendly(r.status_code, body), auth=r.status_code == 401
                )
            try:
                return r.json()
            except ValueError:
                return {}
        raise GoogleAdsError(f"{method} {url} kept failing", None, "Google Ads kept failing; try again later.")

    async def search(self, customer_id: str, query: str) -> list[dict]:
        """googleAds:searchStream — every result row across the streamed chunks."""
        body = await self._request("POST", f"{self.base}/customers/{customer_id}/googleAds:searchStream", {"query": query})
        chunks = body if isinstance(body, list) else [body]
        rows: list[dict] = []
        for c in chunks:
            if isinstance(c, dict):
                rows.extend(c.get("results") or [])
        return rows

    async def identity_verification(self, customer_id: str) -> dict:
        return await self._request("GET", f"{self.base}/customers/{customer_id}/getIdentityVerification")


# ============================================================= parsers ====
def _g(d: Any, *path: str) -> Any:
    for p in path:
        if not isinstance(d, dict):
            return None
        d = d.get(p)
    return d


def _f(v: Any) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def _date(v: Any) -> Optional[dt.date]:
    if not v:
        return None
    try:
        return dt.date.fromisoformat(str(v)[:10])
    except ValueError:
        return None


def _id_from_resource(v: Any) -> Optional[str]:
    """"customers/1/campaigns/22" → "22"."""
    return str(v).rsplit("/", 1)[-1] if v else None


def parse_clients(rows: list[dict]) -> list[dict]:
    """Client (non-manager) accounts under the manager account."""
    out = []
    for r in rows:
        c = r.get("customerClient") or {}
        if not c.get("id") or c.get("manager") or c.get("hidden"):
            continue
        out.append(
            {
                "customer_id": str(c["id"]),
                "name": (c.get("descriptiveName") or f"Account {c['id']}").strip(),
                "google_status": c.get("status") or "UNKNOWN",
                "currency_code": c.get("currencyCode"),
                "time_zone": c.get("timeZone"),
            }
        )
    return out


def parse_customer(rows: list[dict]) -> Optional[dict]:
    c = (rows[0].get("customer") if rows else None) or {}
    if not c.get("id"):
        return None
    return {
        "customer_id": str(c["id"]),
        "name": (c.get("descriptiveName") or "").strip() or None,
        "google_status": c.get("status") or "UNKNOWN",
        "currency_code": c.get("currencyCode"),
        "time_zone": c.get("timeZone"),
    }


def parse_campaigns(rows: list[dict]) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for r in rows:
        c = r.get("campaign") or {}
        if not c.get("id"):
            continue
        micros = _g(r, "campaignBudget", "amountMicros")
        out[str(c["id"])] = {
            "name": c.get("name") or f"Campaign {c['id']}",
            "status": c.get("status") or "UNKNOWN",
            "channel_type": c.get("advertisingChannelType"),
            "daily_budget": round(_f(micros) / 1_000_000, 2) if micros is not None else None,
        }
    return out


NO_END = dt.date(2037, 12, 30)  # Google's "runs indefinitely" end date


def parse_campaign_dates(rows: list[dict]) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for r in rows:
        c = r.get("campaign") or {}
        if not c.get("id"):
            continue
        start = _date(c.get("startDateTime") or c.get("startDate"))
        end = _date(c.get("endDateTime") or c.get("endDate"))
        out[str(c["id"])] = {"start_date": start, "end_date": None if (end and end >= NO_END) else end}
    return out


def parse_daily(rows: list[dict]) -> list[dict]:
    """One dict per campaign per day. Cost micros → currency (2 dp, as n8n);
    conversions kept fractional (n8n truncated them with parseInt)."""
    out = []
    for r in rows:
        c, m, s = r.get("campaign") or {}, r.get("metrics") or {}, r.get("segments") or {}
        d = _date(s.get("date"))
        if not c.get("id") or not d:
            continue
        row = {
            "google_campaign_id": str(c["id"]),
            "name": c.get("name") or f"Campaign {c['id']}",
            "status": c.get("status") or "UNKNOWN",
            "date": d,
            "cost": round(_f(m.get("costMicros")) / 1_000_000, 2),
            "impressions": int(_f(m.get("impressions"))),
            "clicks": int(_f(m.get("clicks"))),
        }
        for col, field in LOCATION_METRICS.items():
            camel = "".join(w.capitalize() if i else w for i, w in enumerate(field.split("_")))
            row[col] = round(_f(m.get(camel)), 2)
        out.append(row)
    return out


IMAGE_FIELDS = {"MARKETING_IMAGE", "SQUARE_MARKETING_IMAGE", "PORTRAIT_MARKETING_IMAGE", "TALL_PORTRAIT_MARKETING_IMAGE"}
LOGO_FIELDS = {"LOGO", "LANDSCAPE_LOGO"}
TEXT_FIELDS = {"HEADLINE", "LONG_HEADLINE", "DESCRIPTION", "BUSINESS_NAME", "CALL_TO_ACTION_SELECTION"}


def _kind(field_type: str, asset_type: Optional[str]) -> str:
    if field_type in IMAGE_FIELDS:
        return "image"
    if field_type in LOGO_FIELDS:
        return "logo"
    if field_type == "YOUTUBE_VIDEO" or asset_type == "YOUTUBE_VIDEO":
        return "video"
    if field_type == "SITELINK":
        return "sitelink"
    if field_type == "PROMOTION":
        return "promotion"
    if field_type == "CALLOUT":
        return "callout"
    if field_type in TEXT_FIELDS or asset_type == "TEXT":
        return "text"
    return "other"


def parse_asset_group_assets(rows: list[dict]) -> list[dict]:
    out, seen = [], set()
    for r in rows:
        link, a = r.get("assetGroupAsset") or {}, r.get("asset") or {}
        ft = link.get("fieldType") or "UNKNOWN"
        cid = _id_from_resource(_g(r, "assetGroup", "campaign"))
        if not a.get("id"):
            continue
        key = (cid, str(a["id"]), ft)
        if key in seen:  # same asset in several asset groups of one campaign
            continue
        seen.add(key)
        img = _g(a, "imageAsset", "fullSize") or {}
        vid = a.get("youtubeVideoAsset") or {}
        out.append(
            {
                "google_campaign_id": cid,
                "google_asset_id": str(a["id"]),
                "field_type": ft,
                "kind": _kind(ft, a.get("type")),
                "status": link.get("status") or "ENABLED",
                "name": a.get("name") or vid.get("youtubeVideoTitle"),
                "text": _g(a, "textAsset", "text"),
                "image_url": img.get("url"),
                "width": int(img["widthPixels"]) if img.get("widthPixels") else None,
                "height": int(img["heightPixels"]) if img.get("heightPixels") else None,
                "details": {"youtubeId": vid.get("youtubeVideoId")} if vid.get("youtubeVideoId") else {},
            }
        )
    return out


def _discount(p: dict) -> Optional[str]:
    if p.get("percentOff"):
        pct = _f(p["percentOff"]) / 10_000  # 1,000,000 = 100 %
        return f"{pct:g}% off"
    amount = _g(p, "moneyAmountOff", "amountMicros")
    if amount:
        return f"${_f(amount) / 1_000_000:,.2f} off"
    return None


def parse_extension_assets(rows: list[dict], link_key: str) -> list[dict]:
    """campaign_asset (link_key="campaignAsset") or customer_asset ("customerAsset")
    rows → sitelinks, promotions and callouts."""
    out = []
    for r in rows:
        link, a = r.get(link_key) or {}, r.get("asset") or {}
        ft = link.get("fieldType") or "UNKNOWN"
        if not a.get("id"):
            continue
        cid = str(_g(r, "campaign", "id")) if _g(r, "campaign", "id") else None
        details: dict = {}
        text = None
        if ft == "SITELINK":
            s = a.get("sitelinkAsset") or {}
            urls = a.get("finalUrls") or []
            details = {"linkText": s.get("linkText"), "description1": s.get("description1"), "description2": s.get("description2"), "finalUrl": urls[0] if urls else None}
            text = s.get("linkText")
        elif ft == "PROMOTION":
            p = a.get("promotionAsset") or {}
            details = {
                "target": p.get("promotionTarget"),
                "discount": _discount(p),
                "code": p.get("promotionCode"),
                "startDate": p.get("startDate"),
                "endDate": p.get("endDate"),
                "occasion": p.get("occasion") if p.get("occasion") not in (None, "UNSPECIFIED", "UNKNOWN") else None,
            }
            text = " on ".join(x for x in (details["discount"], details["target"]) if x) or p.get("promotionTarget")
        elif ft == "CALLOUT":
            text = _g(a, "calloutAsset", "calloutText")
        out.append(
            {
                "google_campaign_id": cid,
                "google_asset_id": str(a["id"]),
                "field_type": ft,
                "kind": _kind(ft, a.get("type")),
                "status": link.get("status") or "ENABLED",
                "name": a.get("name"),
                "text": text,
                "image_url": None,
                "width": None,
                "height": None,
                "details": details,
            }
        )
    return out


def parse_verification(body: dict) -> tuple[str, Optional[str], Optional[dt.datetime]]:
    """getIdentityVerification → (verification, message, deadline).

    verified | required | failed | pending | not_required"""
    items = body.get("identityVerification") or []
    if not items:
        return "not_required", None, None
    v = items[0]
    status = _g(v, "verificationProgress", "programStatus") or "UNKNOWN"
    deadline_raw = _g(v, "identityVerificationRequirement", "verificationCompletionDeadlineTime")
    deadline = None
    if deadline_raw:
        try:
            deadline = dt.datetime.fromisoformat(str(deadline_raw).replace(" ", "T").replace("Z", "+00:00"))
            if deadline.tzinfo is None:
                deadline = deadline.replace(tzinfo=dt.timezone.utc)
        except ValueError:
            deadline = None
    when = f" by {deadline:%b %d, %Y}" if deadline else ""
    if status == "SUCCESS":
        return "verified", None, None
    if status == "FAILURE":
        return "failed", "Google could not verify the advertiser. Resubmit the documents in Google Ads (Billing → Advertiser verification).", deadline
    if status == "PENDING_REVIEW":
        return "pending", "Documents submitted; Google is reviewing them.", deadline
    if status == "PENDING_USER_ACTION":
        return "required", f"Google requires advertiser verification{when}. Start it in Google Ads (Billing → Advertiser verification).", deadline
    return "unknown", None, deadline
