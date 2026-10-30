"""Write a read-only diagnostic report of the Google Ads data stored in the
database — for troubleshooting sync errors and missing fields.

    python -m scripts.ads_diagnose            # writes ../_diagnostics/ads_report_<time>.json + .md

Reads only; changes nothing. Never includes the Google refresh token or any
other secret. Covers: the connection, the last sync runs and their errors,
every account (status, errors, warnings, verification, merchant link, average
ticket inputs, data coverage), campaigns, daily metrics, assets, and how many
rows have each field empty.
"""
from __future__ import annotations

import asyncio
import datetime as dt
import decimal
import json
import pathlib
import sys

from sqlalchemy import text

from app.db.schemas import qualified
from app.db.session import SessionLocal

OUT_DIR = pathlib.Path(__file__).resolve().parents[2] / "_diagnostics"

ACCOUNT_FIELDS = [
    "name", "manager_customer_id", "google_status", "currency_code", "time_zone", "merchant_id",
    "ticket_total_sales", "ticket_order_count", "verification_message", "verification_deadline",
    "last_synced_at", "last_metrics_date", "sync_error", "sync_warning",
]
CAMPAIGN_FIELDS = ["channel_type", "start_date", "end_date", "daily_budget"]
ASSET_FIELDS = ["name", "text", "image_url", "width", "height"]


def _plain(v):
    if isinstance(v, (dt.datetime, dt.date)):
        return v.isoformat()
    if isinstance(v, decimal.Decimal):
        return float(v)
    return v


async def rows(db, sql: str, **params) -> list[dict]:
    # The SQL below names the plain schemas; map them to the deployed ones
    # (DB_SCHEMA_PREFIX, see app/db/schemas.py).
    for schema in ("marketing", "profiling"):
        sql = sql.replace(f"{schema}.", f"{qualified(schema)}.")
    res = await db.execute(text(sql), params)
    return [{k: _plain(v) for k, v in r._mapping.items()} for r in res]


async def empty_counts(db, table: str, fields: list[str], where: str = "") -> dict:
    parts = ", ".join(f"count(*) FILTER (WHERE {f} IS NULL) AS {f}" for f in fields)
    r = (await rows(db, f"SELECT count(*) AS total, {parts} FROM marketing.{table} {where}"))[0]
    return r


async def build() -> dict:
    async with SessionLocal() as db:
        rep: dict = {"generatedAt": dt.datetime.now(dt.timezone.utc).isoformat()}
        rep["connection"] = await rows(db, """
            SELECT google_email, status, last_error, scopes, connected_at, last_sync_at
            FROM marketing.ads_connection ORDER BY connected_at DESC""")
        rep["syncRuns"] = await rows(db, """
            SELECT trigger, status, started_at, finished_at, accounts, accounts_failed,
                   metric_rows, new_accounts, error
            FROM marketing.ads_sync_run ORDER BY started_at DESC LIMIT 15""")
        rep["accountsBySourceState"] = await rows(db, """
            SELECT source, state, count(*) AS n FROM marketing.ads_account GROUP BY 1, 2 ORDER BY 1, 2""")
        rep["accounts"] = await rows(db, """
            SELECT a.customer_id, a.name, a.source, a.state, a.google_status, a.currency_code, a.time_zone,
                   a.merchant_id IS NOT NULL AS linked_to_merchant, m.restaurant_name_dba AS merchant_name,
                   a.ticket_total_sales, a.ticket_order_count,
                   a.verification, a.verification_message, a.verification_deadline,
                   a.last_synced_at, a.last_metrics_date, a.sync_error, a.sync_warning,
                   (SELECT count(*) FROM marketing.ads_campaign c WHERE c.account_id = a.id) AS campaigns,
                   (SELECT count(*) FROM marketing.ads_campaign c WHERE c.account_id = a.id AND c.status = 'ENABLED') AS campaigns_enabled,
                   (SELECT min(d.date) FROM marketing.ads_daily_metric d JOIN marketing.ads_campaign c ON c.id = d.campaign_id WHERE c.account_id = a.id) AS first_metric_date,
                   (SELECT max(d.date) FROM marketing.ads_daily_metric d JOIN marketing.ads_campaign c ON c.id = d.campaign_id WHERE c.account_id = a.id) AS last_metric_date,
                   (SELECT count(*) FROM marketing.ads_daily_metric d JOIN marketing.ads_campaign c ON c.id = d.campaign_id WHERE c.account_id = a.id) AS metric_rows,
                   (SELECT round(coalesce(sum(d.cost), 0)::numeric, 2) FROM marketing.ads_daily_metric d JOIN marketing.ads_campaign c ON c.id = d.campaign_id
                     WHERE c.account_id = a.id AND d.date >= current_date - 30) AS spend_last_30d,
                   (SELECT count(*) FROM marketing.ads_asset s WHERE s.account_id = a.id) AS assets
            FROM marketing.ads_account a
            LEFT JOIN profiling.merchant m ON m.id = a.merchant_id
            ORDER BY a.state, a.name""")
        rep["syncErrors"] = await rows(db, """
            SELECT sync_error, count(*) AS accounts FROM marketing.ads_account
            WHERE sync_error IS NOT NULL GROUP BY 1 ORDER BY 2 DESC""")
        rep["syncWarnings"] = await rows(db, """
            SELECT sync_warning, count(*) AS accounts FROM marketing.ads_account
            WHERE sync_warning IS NOT NULL GROUP BY 1 ORDER BY 2 DESC""")
        rep["verification"] = await rows(db, """
            SELECT verification, count(*) AS accounts FROM marketing.ads_account GROUP BY 1 ORDER BY 2 DESC""")
        rep["campaignsByStatusType"] = await rows(db, """
            SELECT status, channel_type, count(*) AS n FROM marketing.ads_campaign GROUP BY 1, 2 ORDER BY 3 DESC""")
        rep["metrics"] = (await rows(db, """
            SELECT count(*) AS rows, min(date) AS first_date, max(date) AS last_date,
                   round(sum(cost)::numeric, 2) AS cost, sum(impressions) AS impressions, sum(clicks) AS clicks,
                   round(sum(calls)::numeric, 2) AS calls, round(sum(directions)::numeric, 2) AS directions,
                   round(sum(website)::numeric, 2) AS website, round(sum(orders)::numeric, 2) AS orders,
                   round(sum(menu)::numeric, 2) AS menu
            FROM marketing.ads_daily_metric"""))[0]
        rep["metricsByMonth"] = await rows(db, """
            SELECT to_char(date, 'YYYY-MM') AS month, count(*) AS rows, round(sum(cost)::numeric, 2) AS cost,
                   sum(impressions) AS impressions, round(sum(orders)::numeric, 2) AS orders,
                   round(sum(calls)::numeric, 2) AS calls
            FROM marketing.ads_daily_metric GROUP BY 1 ORDER BY 1""")
        rep["assetsByKind"] = await rows(db, """
            SELECT kind, field_type, status, count(*) AS n FROM marketing.ads_asset GROUP BY 1, 2, 3 ORDER BY 4 DESC""")
        rep["emptyFields"] = {
            "ads_account (not DEMO)": await empty_counts(db, "ads_account", ACCOUNT_FIELDS, "WHERE source <> 'DEMO'"),
            "ads_campaign": await empty_counts(db, "ads_campaign", CAMPAIGN_FIELDS),
            "ads_asset": await empty_counts(db, "ads_asset", ASSET_FIELDS),
        }
        rep["merchantsWithBudget"] = await rows(db, """
            SELECT count(*) FILTER (WHERE a.merchant_id IS NOT NULL) AS linked_accounts,
                   count(*) FILTER (WHERE a.merchant_id IS NULL AND a.state <> 'ignored') AS unlinked_accounts,
                   count(*) FILTER (WHERE a.ticket_total_sales IS NULL OR a.ticket_order_count IS NULL) AS without_avg_ticket
            FROM marketing.ads_account a WHERE a.source <> 'DEMO'""")
        return rep


def to_md(rep: dict) -> str:
    out = [f"# Google Ads data report\n\nGenerated {rep['generatedAt']}\n"]
    for key, val in rep.items():
        if key == "generatedAt":
            continue
        out.append(f"\n## {key}\n")
        if isinstance(val, list):
            if not val:
                out.append("_none_\n")
                continue
            cols = list(val[0].keys())
            out.append("| " + " | ".join(cols) + " |")
            out.append("|" + "---|" * len(cols))
            for r in val:
                out.append("| " + " | ".join(str(r.get(c, "")).replace("|", "/").replace("\n", " ") for c in cols) + " |")
        else:
            out.append("```json\n" + json.dumps(val, indent=2, default=str) + "\n```")
    return "\n".join(out) + "\n"


async def main() -> int:
    rep = await build()
    OUT_DIR.mkdir(exist_ok=True)
    stamp = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
    j = OUT_DIR / f"ads_report_{stamp}.json"
    m = OUT_DIR / f"ads_report_{stamp}.md"
    j.write_text(json.dumps(rep, indent=2, default=str), encoding="utf-8")
    m.write_text(to_md(rep), encoding="utf-8")
    print(f"Accounts: {len(rep['accounts'])} · metric rows: {rep['metrics']['rows']} · sync runs: {len(rep['syncRuns'])}")
    print(f"Report written to:\n  {j}\n  {m}")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
