"""
Typed application configuration, loaded once at process start.
Mirrors src/config/configuration.ts + src/config/env.validation.ts (Joi schema):
fails fast (pydantic-settings raises at import) on missing/invalid env vars.
"""
from __future__ import annotations

from functools import lru_cache
from typing import Literal, Optional
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Query params libpq/psycopg accept but asyncpg's connect() does not — asyncpg
# raises `TypeError: connect() got an unexpected keyword argument 'sslmode'`
# if any of these survive on the URL. Managed Postgres providers (Railway,
# Neon, Supabase, ...) commonly append sslmode (and sometimes channel_binding)
# to the connection string they hand out, so this has to be stripped
# regardless of who generated the URL.
_ASYNCPG_UNSUPPORTED_QUERY_PARAMS = {
    "sslmode",
    "channel_binding",
    "sslcert",
    "sslkey",
    "sslrootcert",
    "sslcrl",
    "options",
    "target_session_attrs",
}


def to_asyncpg_url(url: str) -> str:
    """Rewrite a `postgresql://`/`postgres://` URL for asyncpg: swap the
    driver scheme and drop any libpq-only query params asyncpg's connect()
    doesn't understand (see `_ASYNCPG_UNSUPPORTED_QUERY_PARAMS`)."""
    if url.startswith("postgresql://"):
        url = "postgresql+asyncpg://" + url[len("postgresql://") :]
    elif url.startswith("postgres://"):
        url = "postgresql+asyncpg://" + url[len("postgres://") :]
    else:
        return url

    parts = urlsplit(url)
    if not parts.query:
        return url
    kept = [
        (k, v)
        for k, v in parse_qsl(parts.query, keep_blank_values=True)
        if k.lower() not in _ASYNCPG_UNSUPPORTED_QUERY_PARAMS
    ]
    return urlunsplit(parts._replace(query=urlencode(kept)))


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=True)

    NODE_ENV: Literal["development", "test", "staging", "production"] = "development"
    PORT: int = 3000

    DATABASE_URL: str
    DIRECT_URL: str
    SHADOW_DATABASE_URL: Optional[str] = None

    JWT_ACCESS_SECRET: str = Field(min_length=32)
    JWT_REFRESH_SECRET: str = Field(min_length=32)
    JWT_ACCESS_TTL: str = "15m"
    JWT_REFRESH_TTL_DAYS: int = 30
    # A refresh token that was rotated this many seconds ago may be presented
    # again without being treated as theft: a page fires several requests at
    # once, each one sees the expired access token and refreshes with the same
    # cookie. Outside this window (or once the new session is signed out) reuse
    # still revokes every session. 0 turns the grace off.
    JWT_REFRESH_REUSE_GRACE_S: int = Field(default=30, ge=0, le=120)

    # Browser origins allowed to call this API directly. The Super App dev
    # server runs on 3001; 3000 is there for a plain `next dev`, 5050 for the
    # public site template. Accepts a JSON array or a comma-separated string.
    CORS_ORIGINS: str = (
        "http://localhost:3001,http://127.0.0.1:3001,"
        "http://localhost:3000,http://127.0.0.1:3000,"
        "http://localhost:5050,http://127.0.0.1:5050"
    )

    STORAGE_DIR: str = "./storage"
    # Supabase Storage for uploads (app/common/storage/supabase.py). When both are
    # set, new files go to this private bucket instead of STORAGE_DIR (which on
    # Vercel is /tmp and doesn't last). The service-role key stays server-side.
    SUPABASE_URL: Optional[str] = None
    SUPABASE_SERVICE_ROLE_KEY: Optional[str] = None
    SUPABASE_STORAGE_BUCKET: str = "superapp-files"
    MAX_UPLOAD_MB: int = Field(default=25, ge=1, le=500)

    SUPER_ADMIN_EMAIL: Optional[str] = None
    SUPER_ADMIN_PASSWORD: Optional[str] = None

    # Where the public site template (nextjs-site) is served. Used to write a
    # merchant's `website_url` when its managed site goes live.
    SITE_TEMPLATE_URL: str = "http://localhost:5050"

    # Public origin of THIS API, used to make uploaded website images absolute
    # inside visually edited pages. Defaults to the request's own base URL,
    # which is right when the site template reaches the API directly.
    API_PUBLIC_URL: Optional[str] = None

    # Fernet key for credentials stored on a merchant's behalf — see
    # app/common/security/crypto.py. Only required once something stores one.
    CREDENTIAL_ENCRYPTION_KEY: Optional[str] = None

    # Partner leads: after a lead is assigned here, this partner-portal endpoint
    # e-mails the new owner and posts to Teams (Supabase Edge Function
    # partner-lead-assigned). It only acts on a real assignment from the last
    # 15 minutes, once — so it needs no secret. The key is Supabase's public
    # (publishable) key, the same one partners.innowi.com ships to browsers.
    # Set the URL to "" to turn the notification off.
    PARTNER_LEADS_NOTIFY_URL: str = "https://bkwnugmcgypbochzyckx.supabase.co/functions/v1/partner-lead-assigned"
    PARTNER_LEADS_NOTIFY_APIKEY: str = "sb_publishable_pB5K3Q82sgRDOCEbqsgqnw_I2Jkxq5M"
    # The e-mails' one-click buttons (/lead-action page -> POST /public/partner-leads/action).
    # Same publishable key. Set to "" to turn the buttons off (the page then says so).
    PARTNER_LEADS_ACTION_URL: str = "https://bkwnugmcgypbochzyckx.supabase.co/functions/v1/partner-lead-action"

    # Invitations: where the Super App web runs (used in the invite link) and the
    # Supabase function that e-mails it (superapp-invite-email; it re-checks the
    # token, so it can't e-mail anyone else). "" turns invite e-mails off — the
    # link is still shown to the admin to copy.
    APP_WEB_URL: str = "https://superapp-web-test.vercel.app"
    INVITE_EMAIL_URL: str = "https://bkwnugmcgypbochzyckx.supabase.co/functions/v1/superapp-invite-email"

    # Quote builder notifications (app/modules/quotes/notify.py). Each channel is
    # optional: unset = skipped, and the request still shows in the Super App.
    #   QUOTES_TEAMS_WEBHOOK_URL  Teams Workflows "post when a webhook request is received" URL
    #   RESEND_API_KEY            e-mails the rep who sent the link (+ QUOTES_NOTIFY_EMAILS);
    #                             the From domain must be verified in Resend.
    QUOTES_TEAMS_WEBHOOK_URL: Optional[str] = None
    RESEND_API_KEY: Optional[str] = None
    QUOTES_EMAIL_FROM: str = "Innowi Quotes <quotes@myinnowi.com>"
    QUOTES_NOTIFY_EMAILS: str = ""

    # Requests (app/modules/requests/notify.py): e-mails go through the same
    # Resend account (RESEND_API_KEY) to each person who ticked e-mail for
    # "Requests" in Settings → Notifications. REQUESTS_TEAMS_WEBHOOK_URL is an
    # optional Teams Workflows webhook that gets every new request; unset = skipped.
    REQUESTS_EMAIL_FROM: str = "Innowi Super App <superapp@myinnowi.com>"
    REQUESTS_TEAMS_WEBHOOK_URL: Optional[str] = None

    # Ops CRM → Teams / Outlook (app/modules/ops/teams_flow.py): one Power
    # Automate flow ("Super App – Notify") that posts Teams cards to a person
    # or the Ops alerts channel and creates Teams meetings. URL = the flow's
    # "When an HTTP request is received" address; SECRET = the value its
    # Condition checks in the x-superapp-key header. Unset = skipped.
    OPS_TEAMS_FLOW_URL: Optional[str] = None
    OPS_TEAMS_FLOW_SECRET: Optional[str] = None
    OPS_TEAMS_TIMEZONE: str = "Asia/Karachi"  # must match the time zone in the flow's meeting step
    # Ops CRM e-mails (assigned, mentioned, SLA…) go through Resend (RESEND_API_KEY).
    OPS_EMAIL_FROM: Optional[str] = None  # unset: REQUESTS_EMAIL_FROM
    OPS_DIGEST_HOUR: int = 9  # daily digest to the Teams channel, first job run after this hour (SLA timezone)

    # --- Hosting on a shared Postgres (e.g. Supabase) ------------------------
    # Prefix applied at runtime to every app schema ("profiling" ->
    # "<prefix>profiling") via SQLAlchemy's schema_translate_map, so the API can
    # live beside other apps' schemas without renaming anything in the models
    # or migrations. Empty (the default) keeps the plain schema names used by
    # docker-compose. See app/db/schemas.py.
    DB_SCHEMA_PREFIX: str = ""
    # Schema that holds Alembic's alembic_version table.
    ALEMBIC_VERSION_SCHEMA: str = "public"
    # "queue" = normal connection pool (long-running server, e.g. Docker/Render).
    # "null"  = open/close per request (serverless, e.g. Vercel), so many
    # short-lived instances don't each hold a pool of idle connections.
    DB_POOL_MODE: Literal["queue", "null"] = "queue"

    # --- Salesforce (Sales module) ------------------------------------------
    # The SuperApp copies Salesforce records into its own `salesforce` schema
    # (see app/modules/salesforce/). It signs in with the OAuth 2.0 Client
    # Credentials flow of a dedicated External Client App whose "Run As" user
    # is a read-only integration user. All optional: with no client id set the
    # module stays installed but the sync reports "not configured".
    # My Domain URL, e.g. https://innowi33.my.salesforce.com (token endpoint host).
    SALESFORCE_LOGIN_URL: Optional[str] = None
    SALESFORCE_CLIENT_ID: Optional[str] = None
    SALESFORCE_CLIENT_SECRET: Optional[str] = None
    SALESFORCE_API_VERSION: str = "v62.0"
    # Shared secret a scheduler (Supabase pg_cron + pg_net, or any HTTP cron)
    # sends as `X-Sync-Token` to POST /api/v1/sales/sync/cron. Unset = only
    # signed-in admins can start a sync.
    SALESFORCE_SYNC_TOKEN: Optional[str] = None
    # Seconds one sync request may spend before it stops and lets the next run
    # continue (serverless functions have a hard time limit).
    SALESFORCE_SYNC_TIME_BUDGET_S: int = Field(default=50, ge=5, le=780)
    # Time zone that decides what "today" and "this week" mean on the Sales
    # screens (visit due dates are calendar dates). Innowi works in Pacific time.
    SALES_TIMEZONE: str = "America/Los_Angeles"

    # --- AI assistant (app/modules/assistant/) ------------------------------
    # The home-screen assistant answers questions from SuperApp data through
    # fixed, read-only, permission-checked lookups. Without a key it stays
    # installed and says it isn't set up yet.
    # ASSISTANT_PROVIDER picks the backend protocol. "messages-api" (a hosted,
    # streaming Messages-style API) is the only one today; a local model (e.g.
    # Ollama) is meant to plug in here later. Which service, which model and any
    # extra request headers it needs live in settings only, never in the code:
    #   ASSISTANT_API_URL      base URL of the service (".../v1/messages" is appended)
    #   ASSISTANT_API_KEY      sent as x-api-key
    #   ASSISTANT_MODEL        model id
    #   ASSISTANT_API_HEADERS  JSON object of extra headers, e.g. a version header
    # The assistant stays switched off until the URL, key and model are all set.
    ASSISTANT_PROVIDER: Literal["messages-api"] = "messages-api"
    ASSISTANT_API_URL: Optional[str] = None
    ASSISTANT_API_KEY: Optional[str] = None
    ASSISTANT_MODEL: Optional[str] = None
    ASSISTANT_API_HEADERS: dict[str, str] = Field(default_factory=dict)
    ASSISTANT_MAX_TOKENS: int = Field(default=4096, ge=256, le=32000)
    # Model calls per question (each lookup round is one call).
    ASSISTANT_MAX_ROUNDS: int = Field(default=8, ge=1, le=20)
    # Seconds one answer may take before it stops starting new lookup rounds (the
    # serverless function's own limit is 300 s by default on Vercel).
    ASSISTANT_TIME_BUDGET_S: int = Field(default=150, ge=10, le=780)
    # Questions one person may ask per day (0 = no limit).
    ASSISTANT_DAILY_LIMIT: int = Field(default=150, ge=0)

    # --- Background work: syncs, daily schedulers, SLA alerts (app/common/jobs.py)
    # "background" = asyncio tasks + in-process daily loops (a long-running
    # server). "inline" = run inside the request that asks for it, and drive
    # the schedulers from outside via POST /api/v1/jobs/{job} (serverless).
    # Unset: inline on Vercel (VERCEL is set there), background elsewhere.
    JOBS_MODE: Optional[Literal["inline", "background"]] = None
    # Seconds one inline job may run before it stops cleanly (the API's Vercel
    # function may run 800 s, see api/vercel.json). The next run continues.
    JOBS_TIME_BUDGET_S: int = Field(default=600, ge=30, le=780)
    # Inline, a "running" sync row older than this is treated as dead.
    JOBS_STALE_MINUTES: int = Field(default=15, ge=5, le=240)
    # Shared secret the scheduler (Supabase pg_cron + pg_net) sends as
    # X-Sync-Token to POST /api/v1/jobs/{job}. Unset = SALESFORCE_SYNC_TOKEN is
    # used, so the existing scheduler secret covers these jobs too.
    JOBS_CRON_TOKEN: Optional[str] = None
    # Fathom meeting notes (modules/ops/fathom.py). The API key pulls meetings
    # (Ops CRM → Meetings → Sync); the webhook secret (whsec_…) verifies the
    # "new meeting content ready" webhook. Either can be set without the other.
    FATHOM_API_KEY: Optional[str] = None
    FATHOM_WEBHOOK_SECRET: Optional[str] = None
    FATHOM_API_BASE: str = "https://api.fathom.ai/external/v1"

    # Microsoft 365 app registration (not used yet; Settings → Integrations
    # shows whether they are set).
    MS_TENANT_ID: Optional[str] = None
    MS_CLIENT_ID: Optional[str] = None
    MS_CLIENT_SECRET: Optional[str] = None

    # Google Business Profile (modules/gbp). The OAuth client comes from the
    # Google Cloud project that holds the approved Business Profile API access
    # (Credentials → OAuth client ID → Web application). The redirect URI must
    # be listed on that client exactly as written here. After the Google
    # sign-in the browser is sent back to <GBP_APP_URL>/web/gbp.
    # CREDENTIAL_ENCRYPTION_KEY is required too: the refresh token is stored
    # encrypted with it.
    GOOGLE_OAUTH_CLIENT_ID: Optional[str] = None
    GOOGLE_OAUTH_CLIENT_SECRET: Optional[str] = None
    GBP_OAUTH_REDIRECT_URI: Optional[str] = None  # unset: <API_PUBLIC_URL>/api/v1/integrations/gbp/callback
    GBP_APP_URL: Optional[str] = None  # unset: APP_WEB_URL
    # Days of daily history fetched on the first sync (Google keeps ~18 months).
    GBP_HISTORY_DAYS: int = Field(default=540, ge=30, le=550)
    # Requests per minute the sync allows itself (Google's default quota is 300).
    GBP_REQUESTS_PER_MINUTE: int = Field(default=240, ge=10, le=3000)
    # Daily automatic sync inside the API (modules/gbp/scheduler.py): at this
    # hour in GBP_TIMEZONE, or as soon as the API is up after it.
    GBP_AUTO_SYNC: bool = True
    GBP_AUTO_SYNC_HOUR: int = Field(default=6, ge=0, le=23)
    GBP_TIMEZONE: str = "Asia/Karachi"

    # Google Ads reporting (modules/ads) — replaces the n8n "Google Ads
    # Reporting" workflow. Uses the same Google OAuth client as GBP
    # (GOOGLE_OAUTH_CLIENT_ID/SECRET) with the `adwords` scope; the redirect URI
    # below must also be listed on that client. The developer token comes from
    # the manager account's API Center (Tools → Setup → API Center) and the
    # login customer id is that manager (MCC) account, digits only — every
    # client account is read through it.
    GOOGLE_ADS_DEVELOPER_TOKEN: Optional[str] = None
    GOOGLE_ADS_LOGIN_CUSTOMER_ID: Optional[str] = None
    GOOGLE_ADS_API_VERSION: str = "v24"
    ADS_OAUTH_REDIRECT_URI: Optional[str] = None  # unset: <API_PUBLIC_URL>/api/v1/integrations/google-ads/callback
    ADS_APP_URL: Optional[str] = None  # unset: APP_WEB_URL
    # Days of daily history fetched for an account's first sync.
    ADS_HISTORY_DAYS: int = Field(default=400, ge=7, le=1100)
    # Every sync re-reads this many recent days: Google keeps attributing
    # conversions (orders, calls…) to past days for a while.
    ADS_REFRESH_DAYS: int = Field(default=14, ge=1, le=90)
    # Google Ads accounts fetched at the same time during a sync (Google calls only;
    # the database writes stay one at a time).
    ADS_SYNC_CONCURRENCY: int = Field(default=6, ge=1, le=20)
    # Daily automatic sync inside the API (modules/ads/scheduler.py).
    ADS_AUTO_SYNC: bool = True
    ADS_AUTO_SYNC_HOUR: int = Field(default=7, ge=0, le=23)
    ADS_TIMEZONE: str = "Asia/Karachi"
    # Budget Mismatch alert: projected monthly spend off the approved budget by more than this %.
    ADS_BUDGET_TOLERANCE_PCT: float = Field(default=10.0, ge=0, le=100)
    # Sync Issue alert: an account not refreshed for this many hours.
    ADS_STALE_HOURS: int = Field(default=48, ge=6, le=720)

    # SEO (modules/seo) — Search Console + Google Analytics 4 through the same
    # Google OAuth client as GBP and Ads (GOOGLE_OAUTH_CLIENT_ID/SECRET), with
    # the `webmasters.readonly` and `analytics.readonly` scopes. The redirect
    # URI below must also be listed on that OAuth client.
    SEO_OAUTH_REDIRECT_URI: Optional[str] = None  # unset: <API_PUBLIC_URL>/api/v1/integrations/seo/callback
    SEO_APP_URL: Optional[str] = None  # unset: APP_WEB_URL
    # Days of daily history read on a site's first sync (Search Console keeps 16 months).
    SEO_HISTORY_DAYS: int = Field(default=480, ge=30, le=480)
    SEO_REQUESTS_PER_MINUTE: int = Field(default=600, ge=10, le=3000)
    # Daily automatic sync inside the API (modules/seo/scheduler.py).
    SEO_AUTO_SYNC: bool = True
    SEO_AUTO_SYNC_HOUR: int = Field(default=5, ge=0, le=23)
    SEO_TIMEZONE: str = "Asia/Karachi"
    # Pages fetched and checked per site per sync (title, meta, H1, noindex, schema…).
    SEO_PAGES_PER_SITE: int = Field(default=25, ge=1, le=200)
    # Search Console URL Inspection calls per site per sync (Google allows 2,000/day per site).
    SEO_INSPECT_PER_SITE: int = Field(default=10, ge=0, le=200)
    # PageSpeed Insights (Credentials → API key, restricted to the PageSpeed Insights API).
    PAGESPEED_API_KEY: Optional[str] = None
    SEO_PSI_PAGES_PER_SITE: int = Field(default=3, ge=0, le=20)
    SEO_PSI_REFRESH_DAYS: int = Field(default=7, ge=1, le=60)
    # Tracked keywords (positions come from Search Console): how many top
    # search terms each site starts tracking on its first sync.
    SEO_KEYWORDS_PER_SITE: int = Field(default=10, ge=0, le=100)
    # Client report e-mails go out through Gmail as the Google account connected
    # for SEO (Settings → Integrations; needs the gmail.send permission). This
    # is only the display name in the From line.
    SEO_REPORT_FROM_NAME: str = "Innowi"

    # Merchant Reports (modules/report_gen). Off by default: the routes answer 404
    # until the flag is on. Send mode: dry-run (record, send nothing) · sandbox
    # (only REPORT_GEN_SANDBOX_RECIPIENTS, comma-separated) · live.
    REPORT_GEN_ENABLED: bool = False
    REPORT_GEN_SEND_MODE: Literal["dry-run", "sandbox", "live"] = "dry-run"
    REPORT_GEN_SANDBOX_RECIPIENTS: Optional[str] = None

    # Send Strict-Transport-Security. Only correct when the API is reached over
    # HTTPS (a TLS-terminating proxy or platform), which production should be.
    ENABLE_HSTS: bool = False

    @model_validator(mode="after")
    def _fill_integration_urls(self) -> "Settings":
        """Google OAuth redirect URIs and "back to the app" URLs follow the
        deployment unless set explicitly: callbacks hit this API
        (API_PUBLIC_URL, or localhost:3000 in development) and the browser then
        returns to the web app (APP_WEB_URL). Each redirect URI must also be
        listed on the Google OAuth client."""
        api = (self.API_PUBLIC_URL or "http://localhost:3000").rstrip("/")
        callbacks = {"GBP": "gbp", "ADS": "google-ads", "SEO": "seo"}
        for key, path in callbacks.items():
            if not getattr(self, f"{key}_OAUTH_REDIRECT_URI"):
                setattr(self, f"{key}_OAUTH_REDIRECT_URI", f"{api}/api/v1/integrations/{path}/callback")
            if not getattr(self, f"{key}_APP_URL"):
                setattr(self, f"{key}_APP_URL", self.APP_WEB_URL.rstrip("/"))
        return self

    @field_validator("SHADOW_DATABASE_URL")
    @classmethod
    def _shadow_required_in_dev(cls, v, info):
        # Mirrors Joi's `.when('NODE_ENV', { is: 'development', then: required })`.
        node_env = info.data.get("NODE_ENV", "development")
        if node_env == "development" and not v:
            raise ValueError("SHADOW_DATABASE_URL is required when NODE_ENV=development")
        return v

    @property
    def is_production(self) -> bool:
        return self.NODE_ENV == "production"

    @property
    def cors_origins_list(self) -> list[str]:
        """CORS_ORIGINS as a list. Accepts `["a","b"]` or `a,b`.

        `["*"]` / `*` allows any origin — note that browsers reject a wildcard
        together with credentialed requests, so use it for local work only.
        """
        raw = (self.CORS_ORIGINS or "").strip()
        if not raw:
            return []
        if raw.startswith("["):
            import json

            try:
                return [str(o).strip() for o in json.loads(raw) if str(o).strip()]
            except ValueError:
                pass
        return [o.strip() for o in raw.split(",") if o.strip()]

    @property
    def database_url_async(self) -> str:
        """asyncpg driver URL for SQLAlchemy async engine."""
        return to_asyncpg_url(self.DATABASE_URL)


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]


# Placeholder values shipped in .env.example — must never reach production.
_PLACEHOLDER_SECRETS = {
    "replace_with_a_random_64_char_hex_secret_______________________",
    "replace_with_a_different_random_64_char_hex_secret____________",
}
_PLACEHOLDER_ADMIN_PASSWORDS = {"ChangeMe123!", "admin123", "password", "changeme"}


def validate_environment(settings: Settings | None = None) -> list[str]:
    """Configuration problems pydantic can't express as a single-field rule.

    Ported from Final-MVP's `core/config.validate_environment()`. Returns a
    list of human-readable problems; `main.py` logs them in development and
    refuses to start in production so a misconfigured deploy fails loudly
    instead of running with a guessable secret.
    """
    s = settings or get_settings()
    problems: list[str] = []

    if s.JWT_ACCESS_SECRET in _PLACEHOLDER_SECRETS or s.JWT_REFRESH_SECRET in _PLACEHOLDER_SECRETS:
        problems.append("JWT_ACCESS_SECRET / JWT_REFRESH_SECRET still hold the .env.example placeholder values")
    if s.JWT_ACCESS_SECRET == s.JWT_REFRESH_SECRET:
        problems.append("JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different secrets")

    origins = s.cors_origins_list
    if s.is_production:
        if not origins or "*" in origins:
            problems.append("CORS_ORIGINS must be an explicit allowlist in production (no wildcard)")
        insecure = [o for o in origins if o.startswith("http://") and "localhost" not in o and "127.0.0.1" not in o]
        if insecure:
            problems.append(f"CORS_ORIGINS contains plain-http origins in production: {', '.join(insecure)}")
        if s.SUPER_ADMIN_PASSWORD and s.SUPER_ADMIN_PASSWORD in _PLACEHOLDER_ADMIN_PASSWORDS:
            problems.append("SUPER_ADMIN_PASSWORD is a well-known placeholder; set a real one")
        if not s.ENABLE_HSTS:
            problems.append("ENABLE_HSTS is off; turn it on once the API is served over HTTPS")

    if s.CREDENTIAL_ENCRYPTION_KEY:
        try:
            from cryptography.fernet import Fernet

            Fernet(s.CREDENTIAL_ENCRYPTION_KEY.encode())
        except Exception:  # noqa: BLE001
            problems.append("CREDENTIAL_ENCRYPTION_KEY is not a valid Fernet key")

    return problems
