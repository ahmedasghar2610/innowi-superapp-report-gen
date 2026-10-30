"""Scheduled work, driven from outside the API (serverless hosts).

On Vercel nothing runs between requests, so the daily syncs and the SLA alert
scan can't loop inside the API. Supabase pg_cron + pg_net calls

    POST /api/v1/jobs/{job}      X-Sync-Token: <JOBS_CRON_TOKEN or SALESFORCE_SYNC_TOKEN>

on a schedule instead (see api/sql/jobs_cron.sql). Each call does one job,
within the inline time budget (app/common/jobs.py):

    ops-sla   SLA at-risk / breached notices          (every few minutes)
    ops-digest Ops CRM daily digest to Teams           (hourly; posts once a day after OPS_DIGEST_HOUR)
    gbp       Google Business Profile daily sync      (hourly; runs when due)
    ads       Google Ads daily sync                   (hourly; runs when due)
    seo       SEO daily sync                          (hourly; runs when due)
    seo-blogs Blog Impact refresh                     (every 15 min; runs at the times saved on its tab)

"When due" is the module's own rule: once a day after its *_AUTO_SYNC_HOUR,
or straight away when the last run stopped at the time limit. The routes are
left out of the OpenAPI document (scheduler-only).
"""
from __future__ import annotations

import hmac
import logging
from typing import Optional

from fastapi import APIRouter, Header, HTTPException, status

from app.common import jobs
from app.config import get_settings

logger = logging.getLogger("Jobs")

router = APIRouter(prefix="/jobs", tags=["Jobs"], include_in_schema=False)

JOBS = ("ops-sla", "ops-digest", "gbp", "ads", "seo", "seo-blogs")


def _check_token(token: Optional[str]) -> None:
    s = get_settings()
    expected = s.JOBS_CRON_TOKEN or s.SALESFORCE_SYNC_TOKEN
    if not expected:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")
    if not token or not hmac.compare_digest(token.encode(), expected.encode()):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")


async def _ops_sla() -> dict:
    from app.db.session import SessionLocal
    from app.modules.ops import alerts

    if not alerts.enabled():
        return {"ran": False, "detail": "OPS_SLA_ALERTS is off."}
    async with SessionLocal() as db:
        sent = await alerts.scan_sla(db)
    return {"ran": True, "detail": f"{sent} notice(s) sent."}


async def _ops_digest() -> dict:
    from app.db.session import SessionLocal
    from app.modules.ops import digest

    async with SessionLocal() as db:
        return await digest.tick(db)


async def _daily(module: str) -> dict:
    if module == "seo-blogs":
        from app.modules.seo import blog_schedule as scheduler
    elif module == "gbp":
        from app.modules.gbp import scheduler
    elif module == "ads":
        from app.modules.ads import scheduler
    else:
        from app.modules.seo import scheduler
    out: dict = {"ran": False, "runId": None, "detail": "Not due (or not connected / switched off)."}

    async def work() -> None:
        run_id = await scheduler.tick()
        if run_id:
            out.update(ran=True, runId=run_id, detail="Sync ran.")

    await jobs.run(work, name=f"{module}-scheduled", wait=True)
    return out


@router.post("/{job}")
async def run_job(job: str, x_sync_token: Optional[str] = Header(None, alias="X-Sync-Token")):
    _check_token(x_sync_token)
    if job not in JOBS:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown job.")
    if job == "ops-sla":
        result = await _ops_sla()
    elif job == "ops-digest":
        result = await _ops_digest()
    else:
        result = await _daily(job)
    logger.info("Job %s: %s", job, result.get("detail"))
    return {"job": job, **result}
