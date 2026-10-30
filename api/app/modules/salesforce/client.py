"""A small, read-only Salesforce REST client for the sync.

It signs in with the OAuth 2.0 Client Credentials flow: the External Client
App's consumer key + secret are exchanged for an access token that acts as the
app's "Run As" user (a read-only integration user). No refresh token exists in
this flow; when a token expires the client simply asks for a new one.

Only two REST calls are used:
  * GET /services/data/<ver>/query?q=<SOQL>        (+ nextRecordsUrl pages)
  * GET /services/data/<ver>/sobjects/<obj>/deleted/?start=&end=

Every REST request is counted in `api_calls` (the number that counts against
the org's daily API limit); the token request is not, since Salesforce does
not count OAuth token requests as API calls.
"""
from __future__ import annotations

import datetime as dt
import logging
from dataclasses import dataclass
from typing import Any, AsyncIterator, Optional
from urllib.parse import quote

import httpx

from app.config import Settings, get_settings

logger = logging.getLogger("salesforce.client")


class SalesforceError(Exception):
    """A Salesforce call failed. `code` is Salesforce's errorCode when it sent one."""

    def __init__(self, message: str, *, code: Optional[str] = None, status: Optional[int] = None) -> None:
        super().__init__(message)
        self.code = code
        self.status = status


class SalesforceNotConfigured(SalesforceError):
    """SALESFORCE_LOGIN_URL / CLIENT_ID / CLIENT_SECRET are not all set."""


@dataclass(frozen=True)
class SalesforceConfig:
    login_url: str
    client_id: str
    client_secret: str
    api_version: str = "v62.0"

    @classmethod
    def from_settings(cls, settings: Optional[Settings] = None) -> "SalesforceConfig":
        s = settings or get_settings()
        if not (s.SALESFORCE_LOGIN_URL and s.SALESFORCE_CLIENT_ID and s.SALESFORCE_CLIENT_SECRET):
            raise SalesforceNotConfigured(
                "Salesforce is not connected yet: set SALESFORCE_LOGIN_URL, SALESFORCE_CLIENT_ID and "
                "SALESFORCE_CLIENT_SECRET on the API."
            )
        return cls(
            login_url=s.SALESFORCE_LOGIN_URL.rstrip("/"),
            client_id=s.SALESFORCE_CLIENT_ID,
            client_secret=s.SALESFORCE_CLIENT_SECRET,
            api_version=s.SALESFORCE_API_VERSION,
        )


def is_configured(settings: Optional[Settings] = None) -> bool:
    s = settings or get_settings()
    return bool(s.SALESFORCE_LOGIN_URL and s.SALESFORCE_CLIENT_ID and s.SALESFORCE_CLIENT_SECRET)


def soql_datetime(value: dt.datetime) -> str:
    """A datetime as a SOQL literal (UTC, no quotes): 2026-10-11T20:54:25Z."""
    if value.tzinfo is None:
        value = value.replace(tzinfo=dt.timezone.utc)
    return value.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def soql_quote(value: str) -> str:
    """A string as a quoted SOQL literal."""
    return "'" + value.replace("\\", "\\\\").replace("'", "\\'") + "'"


def _error_from(response: httpx.Response) -> SalesforceError:
    code = None
    message = response.text[:500]
    try:
        body = response.json()
        if isinstance(body, list) and body:
            code = body[0].get("errorCode")
            message = body[0].get("message") or message
        elif isinstance(body, dict):
            code = body.get("error") or body.get("errorCode")
            message = body.get("error_description") or body.get("message") or message
    except ValueError:
        pass
    return SalesforceError(f"Salesforce {response.status_code}: {message}", code=code, status=response.status_code)


class SalesforceClient:
    def __init__(self, config: SalesforceConfig, *, http: Optional[httpx.AsyncClient] = None, timeout: float = 30.0):
        self.config = config
        self._http = http or httpx.AsyncClient(timeout=timeout)
        self._owns_http = http is None
        self._token: Optional[str] = None
        self._instance_url: Optional[str] = None
        self.api_calls = 0

    async def __aenter__(self) -> "SalesforceClient":
        return self

    async def __aexit__(self, *exc) -> None:
        await self.close()

    async def close(self) -> None:
        if self._owns_http:
            await self._http.aclose()

    # ------------------------------------------------------------ auth ----
    async def authenticate(self) -> None:
        response = await self._http.post(
            f"{self.config.login_url}/services/oauth2/token",
            data={
                "grant_type": "client_credentials",
                "client_id": self.config.client_id,
                "client_secret": self.config.client_secret,
            },
            headers={"Accept": "application/json"},
        )
        if response.status_code != 200:
            raise _error_from(response)
        body = response.json()
        self._token = body["access_token"]
        self._instance_url = (body.get("instance_url") or self.config.login_url).rstrip("/")

    async def _get(self, path_or_url: str, *, retry_auth: bool = True) -> dict[str, Any]:
        if self._token is None:
            await self.authenticate()
        url = path_or_url if path_or_url.startswith("http") else f"{self._instance_url}{path_or_url}"
        response = await self._http.get(
            url, headers={"Authorization": f"Bearer {self._token}", "Accept": "application/json"}
        )
        self.api_calls += 1
        if response.status_code == 401 and retry_auth:
            # Expired token: client credentials has no refresh token, so ask again.
            await self.authenticate()
            return await self._get(path_or_url, retry_auth=False)
        if response.status_code != 200:
            raise _error_from(response)
        return response.json()

    # ------------------------------------------------------------ reads ----
    async def query_pages(self, soql: str) -> AsyncIterator[list[dict[str, Any]]]:
        """Yield the records of a SOQL query one page (up to 2,000 rows) at a time."""
        path = f"/services/data/{self.config.api_version}/query?q={quote(soql, safe='')}"
        body = await self._get(path)
        while True:
            yield body.get("records", [])
            next_url = body.get("nextRecordsUrl")
            if body.get("done", True) or not next_url:
                return
            body = await self._get(next_url)

    async def query_all(self, soql: str) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        async for page in self.query_pages(soql):
            rows.extend(page)
        return rows

    async def deleted_ids(self, sobject: str, start: dt.datetime, end: dt.datetime) -> list[str]:
        """Ids of `sobject` records deleted between start and end (Salesforce keeps ~30 days)."""
        path = (
            f"/services/data/{self.config.api_version}/sobjects/{sobject}/deleted/"
            f"?start={quote(_iso(start), safe='')}&end={quote(_iso(end), safe='')}"
        )
        body = await self._get(path)
        return [row["id"] for row in body.get("deletedRecords", []) if row.get("id")]


def _iso(value: dt.datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=dt.timezone.utc)
    return value.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S+00:00")
