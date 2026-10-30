"""Pull Google Ads data into our tables — what the n8n workflow did weekly and
monthly, done daily and per day.

One run:
  1. list the client accounts under the manager account (customer_client);
     new ones are added (they show up under "Unmapped" until linked to a
     merchant). The first run that finds real accounts deletes the DEMO data.
  2. for every account that isn't "ignored":
       campaigns (status, type, daily budget, start/end)       → ads_campaign
       daily metrics: first sync ADS_HISTORY_DAYS back, then
       from the last stored day minus ADS_REFRESH_DAYS          → ads_daily_metric
       Performance Max assets, sitelinks, promotions, callouts → ads_asset
       advertiser verification                                 → ads_account
A failing account records `sync_error` (→ "Sync Issue") and the run carries
on ("partial"). An expired token stops the run and marks the connection
"error" so the page asks for a reconnect.

Started by "Refresh" (POST /ads/sync?mode=quick: accounts, campaigns and
daily metrics only — seconds), "Full refresh" (POST /ads/sync?mode=full),
right after connecting, by the daily scheduler (modules/ads/scheduler.py, full)
or `python -m scripts.ads_sync` (full). Accounts are fetched from Google
ADS_SYNC_CONCURRENCY at a time.
"""
from __future__ import annotations

import asyncio
import datetime as dt
import logging
from typing import Callable, Optional

import httpx
from sqlalchemy import delete, func, select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.common import jobs
from app.config import get_settings
from app.models.ads import AdsAccount, AdsAsset, AdsCampaign, AdsDailyMetric, AdsSyncRun, METRIC_COLUMNS, utcnow
from app.models.common import cuid
from app.modules.ads import connection, google

logger = logging.getLogger("Ads.sync")

# Google Ads account statuses that can't be reported on.
CLOSED_STATUSES = ("CANCELED", "CLOSED", "SUSPENDED")
VERIFICATION_NOT_IN_API = (
    "Google only reports advertiser verification through the API for accounts billed by monthly invoice. "
    "Check it in Google Ads → Billing → Advertiser verification."
)

STALE_RUN = dt.timedelta(hours=2)
_tasks: set[asyncio.Task] = set()
_PROCESS_STARTED = utcnow()  # runs started before this are from a process that's gone


class SyncBusy(RuntimeError):
    pass


async def running(db: AsyncSession) -> Optional[AdsSyncRun]:
    run = (
        await db.execute(select(AdsSyncRun).where(AdsSyncRun.status == "running").order_by(AdsSyncRun.started_at.desc()).limit(1))
    ).scalar_one_or_none()
    if not run:
        return None
    # A run that began before this API process started can't be running in it — the process that
    # ran it is gone (restart / --reload / crash). Serverless: only the age check applies.
    orphaned = not jobs.inline() and run.started_at < _PROCESS_STARTED
    if orphaned or utcnow() - run.started_at > jobs.stale_after(STALE_RUN):
        run.status, run.finished_at, run.error = "failed", utcnow(), "Stopped (the API restarted during the sync). Click Refresh to run it again."
        await db.commit()
        return None
    return run


async def create_run(db: AsyncSession, trigger: str, user_id: Optional[str]) -> AdsSyncRun:
    await db.execute(text("SELECT pg_advisory_xact_lock(7244120)"))
    if await running(db):
        raise SyncBusy("A Google Ads sync is already running.")
    run = AdsSyncRun(trigger=trigger, status="running", started_by_id=user_id, started_at=utcnow())
    db.add(run)
    await db.commit()
    return run


async def start_background(run_id: str) -> None:
    """Run the sync: inline on a serverless host (inside this request, within
    the time budget), else as a background task (app/common/jobs.py)."""
    await jobs.run(lambda: run_in_new_session(run_id), name=f"ads-sync-{run_id}")


async def run_in_new_session(run_id: str, http: Optional[httpx.AsyncClient] = None) -> None:
    from app.db.session import SessionLocal

    async with SessionLocal() as db:
        await run_sync(db, run_id, http=http)


async def run_sync(
    db: AsyncSession,
    run_id: str,
    http: Optional[httpx.AsyncClient] = None,
    today: Optional[dt.date] = None,
    progress: Optional[Callable[[str], None]] = None,
) -> AdsSyncRun:
    run = await db.get(AdsSyncRun, run_id)
    assert run is not None
    own_http = http is None
    http = http or httpx.AsyncClient(timeout=httpx.Timeout(60.0))
    today = today or dt.date.today()
    s = get_settings()
    try:
        conn = await connection.current(db)
        if not conn:
            raise connection.NotConfigured("Google Ads isn't connected.")
        missing = connection.missing_env()
        if missing:
            raise connection.NotConfigured("Add " + ", ".join(missing) + " to the API's settings (environment variables) and redeploy it.")
        token = await connection.access_token(db, http, conn)
        mcc = connection.login_customer_id()
        client = google.AdsClient(http, token, s.GOOGLE_ADS_DEVELOPER_TOKEN or "", mcc, s.GOOGLE_ADS_API_VERSION)

        # 1. accounts under the manager account
        found = google.parse_clients(await client.search(mcc, google.Q_CLIENTS))
        if found:
            await db.execute(delete(AdsAccount).where(AdsAccount.source == "DEMO"))
            await db.commit()
        existing = {a.customer_id: a for a in (await db.execute(select(AdsAccount))).scalars().all()}
        for f in found:
            acc = existing.get(f["customer_id"])
            if not acc:
                acc = AdsAccount(
                    customer_id=f["customer_id"], name=f["name"], manager_customer_id=mcc, source="GOOGLE", state="active", first_seen_at=utcnow()
                )
                db.add(acc)
                existing[acc.customer_id] = acc
                run.new_accounts += 1
            acc.source = "GOOGLE"
            acc.name = f["name"] or acc.name
            acc.manager_customer_id = mcc
            acc.google_status = f["google_status"]
            acc.currency_code = f["currency_code"]
            acc.time_zone = f["time_zone"]
        await db.commit()

        # 2. per account — Google calls run for several accounts at once (they only
        # wait on the network); results are written one account at a time, in
        # this task, because one database session can't be shared.
        quick = is_quick(run)
        found_ids = {f["customer_id"] for f in found}
        plans: list[dict] = []
        for a in sorted(existing.values(), key=lambda a: a.name.lower()):
            if a.state == "ignored" or a.source == "DEMO":
                continue
            plans.append(
                {
                    "id": a.id,
                    "name": a.name,
                    "cid": a.customer_id,
                    "gone": bool(found) and a.customer_id not in found_ids,
                    "closed": (a.google_status or "").upper() in CLOSED_STATUSES,
                    "start": (a.last_metrics_date - dt.timedelta(days=s.ADS_REFRESH_DAYS)) if a.last_metrics_date else today - dt.timedelta(days=s.ADS_HISTORY_DAYS),
                    "verification": not quick and a.verification_message != VERIFICATION_NOT_IN_API,
                }
            )
        sem = asyncio.Semaphore(max(1, s.ADS_SYNC_CONCURRENCY))

        async def fetch(p: dict):
            if p["gone"] or p["closed"]:
                return p, None
            async with sem:
                try:
                    return p, await fetch_account(client, p["cid"], p["start"], today, quick=quick, verification=p["verification"])
                except google.GoogleAdsError as exc:
                    return p, exc

        tasks = [asyncio.create_task(fetch(p)) for p in plans]
        done = 0
        time_limited: int | None = None  # accounts finished when the time budget ran out
        try:
            for fut in asyncio.as_completed(tasks):
                p, data = await fut
                if jobs.time_up():
                    time_limited = done
                    break
                done += 1
                if progress:
                    progress(f"[{done}/{len(plans)}] {p['name']}")
                acc = await db.get(AdsAccount, p["id"])
                if isinstance(data, google.GoogleAdsError) and data.auth:
                    raise data
                if p["gone"]:
                    acc.sync_error = "This account isn't under the manager account any more (or the connected user lost access)."
                    acc.last_synced_at = utcnow()
                    run.accounts_failed += 1
                elif p["closed"]:
                    # Google refuses every report call for cancelled / closed /
                    # suspended accounts (CUSTOMER_NOT_ENABLED). Keep the history,
                    # don't count it as a failure, and move never-used ones out of
                    # the active list.
                    acc.sync_error = None
                    acc.sync_warning = f"Google Ads account is {acc.google_status.lower()} — not refreshed; existing history is kept."
                    acc.last_synced_at = utcnow()
                    if acc.state == "active" and acc.last_metrics_date is None:
                        acc.state = "archived"
                elif isinstance(data, google.GoogleAdsError):
                    acc.sync_error = data.friendly
                    acc.last_synced_at = utcnow()
                    run.accounts_failed += 1
                else:
                    try:
                        run.metric_rows += await store_account(db, acc, data)
                    except Exception:
                        await db.rollback()  # expires every loaded row — load again
                        run = await db.get(AdsSyncRun, run_id)
                        acc = await db.get(AdsAccount, p["id"])
                        acc.sync_error = "Couldn't save this account's data; the next refresh tries again."
                        acc.last_synced_at = utcnow()
                        run.accounts_failed += 1
                        logger.exception("Saving Google Ads account %s failed", p["cid"])
                run.accounts += 1
                await db.commit()
        finally:
            for t in tasks:
                t.cancel()
        conn = await connection.current(db)
        conn.last_sync_at = utcnow()
        conn.status, conn.last_error = "connected", None
        run.status = "partial" if run.accounts_failed else "success"
        if time_limited is not None:
            run.status = "partial"
            run.error = f"Stopped at the time limit after {time_limited} of {len(plans)} accounts; the next sync carries on."
        if not found:
            run.error = "The manager account has no client accounts the connected Google user can see."
    except (google.GoogleAdsError, connection.NotConfigured) as exc:
        await db.rollback()
        run = await db.get(AdsSyncRun, run_id)
        run.status = "failed"
        run.error = getattr(exc, "friendly", None) or str(exc)
        logger.warning("Google Ads sync failed: %s", exc)
    except Exception as exc:  # never leave a run stuck in "running"
        logger.exception("Google Ads sync crashed")
        await db.rollback()
        run = await db.get(AdsSyncRun, run_id)
        run.status = "failed"
        run.error = f"Unexpected error: {exc.__class__.__name__}: {str(exc)[:200]}"
    finally:
        if own_http:
            await http.aclose()
    run.finished_at = utcnow()
    await db.commit()
    return run


def is_quick(run: AdsSyncRun) -> bool:
    """A quick refresh (the "Refresh" button) only re-reads accounts, campaigns
    and daily metrics — the numbers on the pages. Full refreshes (the daily
    schedule, "Full refresh", the CLI) also re-read assets, sitelinks,
    promotions, campaign dates and advertiser verification."""
    return run.trigger == "quick"


async def fetch_account(
    client: google.AdsClient, cid: str, start: dt.date, today: dt.date, *, quick: bool = False, verification: bool = True
) -> dict:
    """Every Google call for one account, made at the same time. No database
    access, so several accounts can be fetched at once. Raises GoogleAdsError
    only when the report would be wrong (campaigns / metrics); optional parts
    come back as None plus a line in `problems`."""
    problems: list[str] = []

    async def optional(query: str, label: str):
        try:
            return await client.search(cid, query)
        except google.GoogleAdsError as exc:
            if exc.auth:
                raise
            problems.append(f"{label}: {exc.friendly}")
            return None

    async def campaign_dates():
        try:
            return await client.search(cid, google.Q_CAMPAIGN_DATES_NEW)
        except google.GoogleAdsError as exc:
            if exc.auth:
                raise
        # older API version: try the old field names before warning
        return await optional(google.Q_CAMPAIGN_DATES_OLD, "Campaign dates")

    async def verify():
        try:
            return ("ok", await client.identity_verification(cid))
        except google.GoogleAdsError as exc:
            if exc.auth:
                raise
            # Google only answers getIdentityVerification for accounts billed by monthly
            # invoice; for card-billed accounts it returns BILLING_NOT_ON_MONTHLY_INVOICING.
            # That isn't a sync problem: note it once and stop asking (saves quota).
            if "billing_not_on_monthly_invoicing" in f"{exc} {exc.friendly}".lower():
                return ("not_in_api", None)
            problems.append(f"Advertiser verification: {exc.friendly}")
            return None

    async def nothing():
        return None

    jobs_ = [
        client.search(cid, google.Q_CAMPAIGNS),
        client.search(cid, google.q_daily(start, today)),
        nothing() if quick else campaign_dates(),
        nothing() if quick else optional(google.Q_ASSET_GROUP_ASSETS, "Performance Max assets"),
        nothing() if quick else optional(google.Q_CAMPAIGN_ASSETS, "Sitelinks & promotions"),
        nothing() if quick else optional(google.Q_CUSTOMER_ASSETS, "Account-level sitelinks"),
        verify() if verification and not quick else nothing(),
    ]
    results = await asyncio.gather(*jobs_, return_exceptions=True)
    errors = [r for r in results if isinstance(r, BaseException)]
    if errors:
        auth = next((e for e in errors if isinstance(e, google.GoogleAdsError) and e.auth), None)
        raise auth or errors[0]
    camp_rows, day_rows, dates_rows, pmax, camp_ext, cust_ext, ver = results

    assets: Optional[list[dict]] = None
    if pmax is not None or camp_ext is not None:
        assets = []
        if pmax is not None:
            assets += google.parse_asset_group_assets(pmax)
        if camp_ext is not None:
            assets += google.parse_extension_assets(camp_ext, "campaignAsset")
        if cust_ext is not None:
            assets += google.parse_extension_assets(cust_ext, "customerAsset")
    return {
        "quick": quick,
        "campaigns": google.parse_campaigns(camp_rows),
        "dates": None if quick else google.parse_campaign_dates(dates_rows or []),
        "days": google.parse_daily(day_rows),
        "assets": assets,
        "verification": ver,
        "problems": problems,
    }


async def store_account(db: AsyncSession, acc: AdsAccount, data: dict) -> int:
    """Write what fetch_account read. Returns the number of daily rows."""
    campaigns, dates, days = data["campaigns"], data["dates"] or {}, data["days"]
    rows_by_gid = {c.google_campaign_id: c for c in (await db.execute(select(AdsCampaign).where(AdsCampaign.account_id == acc.id))).scalars().all()}

    def campaign_row(gid: str, name: str, status: str) -> AdsCampaign:
        c = rows_by_gid.get(gid)
        if not c:
            c = AdsCampaign(account_id=acc.id, google_campaign_id=gid, name=name, status=status)
            db.add(c)
            rows_by_gid[gid] = c
        return c

    for gid, info in campaigns.items():
        c = campaign_row(gid, info["name"], info["status"])
        c.name, c.status, c.channel_type, c.daily_budget = info["name"], info["status"], info["channel_type"], info["daily_budget"]
        if gid in dates:
            c.start_date, c.end_date = dates[gid]["start_date"], dates[gid]["end_date"]
    for d in days:  # removed campaigns still have history
        if d["google_campaign_id"] not in campaigns:
            c = campaign_row(d["google_campaign_id"], d["name"], d["status"])
            c.name, c.status = d["name"], d["status"]
    await db.flush()

    if days:
        values = [{"campaign_id": rows_by_gid[d["google_campaign_id"]].id, "date": d["date"], **{m: d[m] for m in METRIC_COLUMNS}} for d in days]
        for chunk in range(0, len(values), 1000):
            stmt = pg_insert(AdsDailyMetric).values(values[chunk : chunk + 1000])
            stmt = stmt.on_conflict_do_update(index_elements=["campaign_id", "date"], set_={m: stmt.excluded[m] for m in METRIC_COLUMNS})
            await db.execute(stmt)
        newest = max(d["date"] for d in days)
        acc.last_metrics_date = max(newest, acc.last_metrics_date) if acc.last_metrics_date else newest

    if data["assets"] is not None:
        await db.execute(delete(AdsAsset).where(AdsAsset.account_id == acc.id))
        now = utcnow()
        for a in data["assets"]:
            a = dict(a)
            gid = a.pop("google_campaign_id")
            camp = rows_by_gid.get(gid) if gid else None
            db.add(AdsAsset(id=cuid(), account_id=acc.id, campaign_id=camp.id if camp else None, synced_at=now, **a))

    ver = data["verification"]
    if ver is not None:
        kind, body = ver
        if kind == "ok":
            acc.verification, acc.verification_message, acc.verification_deadline = google.parse_verification(body)
        else:
            acc.verification, acc.verification_message, acc.verification_deadline = "unknown", VERIFICATION_NOT_IN_API, None

    acc.last_synced_at = utcnow()
    acc.sync_error = None
    if not data["quick"]:  # a quick refresh doesn't re-check the optional parts, so it keeps their warnings
        acc.sync_warning = "; ".join(data["problems"])[:1000] if data["problems"] else None
    return len(days)


async def sync_account(
    db: AsyncSession, client: google.AdsClient, acc: AdsAccount, today: dt.date, history_days: int, refresh_days: int, *, quick: bool = False
) -> int:
    """Refresh one account (fetch + store)."""
    start = (acc.last_metrics_date - dt.timedelta(days=refresh_days)) if acc.last_metrics_date else today - dt.timedelta(days=history_days)
    data = await fetch_account(
        client, acc.customer_id, start, today, quick=quick, verification=not quick and acc.verification_message != VERIFICATION_NOT_IN_API
    )
    return await store_account(db, acc, data)


async def last_runs(db: AsyncSession, limit: int = 5) -> list[AdsSyncRun]:
    return list((await db.execute(select(AdsSyncRun).order_by(AdsSyncRun.started_at.desc()).limit(limit))).scalars().all())


async def counts(db: AsyncSession) -> dict[str, int]:
    rows = (await db.execute(select(AdsAccount.source, func.count()).group_by(AdsAccount.source))).all()
    return {src: n for src, n in rows}
