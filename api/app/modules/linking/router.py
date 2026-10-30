"""Settings → Integrations → Data setup: refresh every module, then link them all.

    GET  /settings/data-setup/status     each module's connection + latest refresh, last link run
    POST /settings/data-setup/refresh    start GBP, Google Ads and SEO refreshes (skips what isn't connected)
    GET  /settings/data-setup/plan       preview of "Link all": sure / review / create / unmatched
    POST /settings/data-setup/apply      apply sure matches + review choices + merchants to create
    POST /settings/data-setup/undo       undo the last link run
    GET  /settings/data-setup/coverage   one row per merchant: GBP · Ads · Website · SEO · Search Console · GA4

Admins (settings.manage). Linking never calls Google.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.common.deps import AuthenticatedUser, get_current_user, require_capability
from app.db.session import get_db
from app.models.ads import AdsAccount, AdsSyncRun
from app.models.gbp import GbpLocation, GbpSyncRun
from app.models.seo import SeoSite, SeoSyncRun
from app.modules.linking import engine
from app.modules.settings.router import _audit

router = APIRouter(prefix="/settings/data-setup", tags=["Settings"], dependencies=[Depends(require_capability("settings.manage"))])


def _iso(v) -> Optional[str]:
    return v.isoformat() if v else None


async def _module(db: AsyncSession, key: str) -> dict:
    if key == "gbp":
        from app.modules.gbp import connection, sync
        Run, model, label = GbpSyncRun, GbpLocation, "Google Business Profile"
    elif key == "ads":
        from app.modules.ads import connection, sync
        Run, model, label = AdsSyncRun, AdsAccount, "Google Ads"
    else:
        from app.modules.seo import connection, sync
        Run, model, label = SeoSyncRun, SeoSite, "Search Console & GA4"
    conn = await connection.current(db)
    run = (await db.execute(select(Run).order_by(Run.started_at.desc()).limit(1))).scalar_one_or_none()
    real = (await db.execute(select(func.count()).select_from(model).where(model.source != "DEMO"))).scalar_one()
    demo = (await db.execute(select(func.count()).select_from(model).where(model.source == "DEMO"))).scalar_one()
    missing = connection.missing_env()
    if not conn:
        state, note = "not_connected", ("Waiting for Google's API approval, then connect it in Google connections below." if key == "gbp" else "Not connected yet.")
    elif missing:
        state, note = "needs_keys", "Add " + ", ".join(missing) + " to the API's settings (environment variables) and redeploy it."
    else:
        state, note = "ready", None
    return {
        "key": key, "label": label, "state": state, "note": note, "records": real, "sampleRecords": demo,
        "lastRun": {"status": run.status, "startedAt": _iso(run.started_at), "finishedAt": _iso(run.finished_at), "error": run.error} if run else None,
        "_sync": sync, "_conn": conn,
    }


def _public(m: dict) -> dict:
    return {k: v for k, v in m.items() if not k.startswith("_")}


@router.get("/status")
async def status(db: AsyncSession = Depends(get_db)):
    mods = [await _module(db, k) for k in ("gbp", "ads", "seo")]
    last = await engine.last_run(db)
    return {
        "modules": [_public(m) for m in mods],
        "lastLink": {k: last[k] for k in ("id", "at", "summary", "undone")} if last else None,
    }


@router.post("/refresh")
async def refresh_all(request: Request, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    """Start each connected module's own refresh (the same as its Refresh button)."""
    out = []
    for key in ("gbp", "ads", "seo"):
        m = await _module(db, key)
        if m["state"] != "ready" and not (key == "seo" and m["state"] == "not_connected" and m["records"]):
            out.append({"key": key, "started": False, "reason": m["note"]})
            continue
        sync = m["_sync"]
        try:
            run = await sync.create_run(db, "manual", user.id)
        except sync.SyncBusy as exc:
            out.append({"key": key, "started": False, "reason": str(exc)})
            continue
        await sync.start_background(run.id)
        out.append({"key": key, "started": True, "reason": None})
    await _audit(db, request, user, "DataSetupRefresh", {}, {"started": [o["key"] for o in out if o["started"]]})
    await db.commit()
    return {"data": out}


@router.get("/plan")
async def plan(db: AsyncSession = Depends(get_db)):
    return await engine.build_plan(db)


class ApplyInput(BaseModel):
    model_config = {"extra": "forbid"}
    # {"gbp:<id>": "<merchantId>" | "create" | "skip", "ads:<id>": ..., "seo:<id>": ...}
    decisions: dict[str, str] = Field(default_factory=dict)
    # create:<key> groups to turn into merchants; omitted = all of them.
    create: Optional[list[str]] = None


@router.post("/apply")
async def apply(dto: ApplyInput, request: Request, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    run = await engine.apply(db, dto.decisions, dto.create, user.id)
    await _audit(db, request, user, "DataSetupLink", {}, {"run": run["id"], **run["summary"]})
    await db.commit()
    return {"id": run["id"], "summary": run["summary"], "changes": len(run["changes"])}


@router.post("/undo")
async def undo(request: Request, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    out = await engine.undo_last(db)
    await _audit(db, request, user, "DataSetupUndo", {}, out)
    await db.commit()
    return out


@router.get("/coverage")
async def coverage(db: AsyncSession = Depends(get_db)):
    return await engine.coverage(db)
