"""Background work on a serverless host (app/common/jobs.py, modules/jobs)
and the file-storage routing (app/common/storage)."""
from __future__ import annotations

import asyncio
import datetime as dt

import pytest
from fastapi.testclient import TestClient

from app.common import jobs
from app.config import get_settings


@pytest.fixture()
def settings(monkeypatch):
    s = get_settings()
    for k in ("VERCEL", "VERCEL_ENV", "LAMBDA_TASK_ROOT"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setattr(s, "JOBS_MODE", None)
    return s


def test_mode_follows_vercel_unless_set(settings, monkeypatch):
    monkeypatch.delenv("VERCEL_ENV", raising=False)
    monkeypatch.delenv("LAMBDA_TASK_ROOT", raising=False)
    assert jobs.inline() is False
    monkeypatch.setenv("LAMBDA_TASK_ROOT", "/var/task")  # the function runtime itself
    assert jobs.inline() is True
    monkeypatch.delenv("LAMBDA_TASK_ROOT")
    monkeypatch.setenv("VERCEL", "1")
    assert jobs.inline() is True
    monkeypatch.setattr(settings, "JOBS_MODE", "background")
    assert jobs.inline() is False
    monkeypatch.delenv("VERCEL")
    monkeypatch.setattr(settings, "JOBS_MODE", "inline")
    assert jobs.inline() is True


def test_inline_runs_now_and_background_spawns(settings, monkeypatch):
    done: list[str] = []

    async def work():
        await asyncio.sleep(0)
        done.append("x")

    async def go():
        monkeypatch.setattr(settings, "JOBS_MODE", "inline")
        await jobs.run(work, name="t1")
        assert done == ["x"]  # finished before run() returned
        monkeypatch.setattr(settings, "JOBS_MODE", "background")
        await jobs.run(work, name="t2")
        assert done == ["x"]  # not yet: it's a task
        await asyncio.sleep(0.01)
        assert done == ["x", "x"]

    asyncio.run(go())


def test_inline_failure_is_contained(settings, monkeypatch):
    monkeypatch.setattr(settings, "JOBS_MODE", "inline")

    async def boom():
        raise RuntimeError("nope")

    asyncio.run(jobs.run(boom, name="boom"))  # logged, not raised


def test_time_budget_is_shared_by_one_request(settings, monkeypatch):
    monkeypatch.setattr(settings, "JOBS_MODE", "inline")
    monkeypatch.setattr(settings, "JOBS_TIME_BUDGET_S", 30)
    seen: list[bool] = []

    async def check():
        seen.append(jobs.time_up())

    async def go():
        assert jobs.time_up() is False  # no job running: never "up"
        await jobs.run(check, name="a")
        # The budget set by the first job is still in force for the second.
        import time

        jobs._deadline.set(time.monotonic() - 1)
        await jobs.run(check, name="b")

    asyncio.run(go())
    assert seen == [False, True]


def test_stale_window_is_short_inline(settings, monkeypatch):
    default = dt.timedelta(hours=2)
    assert jobs.stale_after(default) == default
    monkeypatch.setattr(settings, "JOBS_MODE", "inline")
    assert jobs.stale_after(default) == dt.timedelta(minutes=settings.JOBS_STALE_MINUTES)


def test_schedulers_do_not_loop_inline(settings, monkeypatch):
    from app.modules.ads import scheduler as ads
    from app.modules.gbp import scheduler as gbp
    from app.modules.ops import alerts
    from app.modules.seo import scheduler as seo

    monkeypatch.setattr(settings, "JOBS_MODE", "inline")
    for mod in (gbp, ads, seo, alerts):
        assert mod.start() is None


def test_time_limited_runs_continue_on_the_next_tick():
    from app.modules.gbp.scheduler import continues

    assert continues("Stopped at the time limit after 12 of 40 listings; the next sync carries on.")
    assert not continues(None)
    assert not continues("Google said no")


def _client():
    from app.main import app

    return TestClient(app)


def test_jobs_endpoint_needs_the_scheduler_token(settings, monkeypatch):
    monkeypatch.setattr(settings, "JOBS_CRON_TOKEN", None)
    monkeypatch.setattr(settings, "SALESFORCE_SYNC_TOKEN", None)
    c = _client()
    assert c.post("/api/v1/jobs/gbp").status_code == 404  # no token configured: hidden
    monkeypatch.setattr(settings, "SALESFORCE_SYNC_TOKEN", "sf-token")
    assert c.post("/api/v1/jobs/gbp").status_code == 401
    assert c.post("/api/v1/jobs/gbp", headers={"X-Sync-Token": "wrong"}).status_code == 401
    monkeypatch.setattr(settings, "JOBS_CRON_TOKEN", "jobs-token")
    assert c.post("/api/v1/jobs/gbp", headers={"X-Sync-Token": "sf-token"}).status_code == 401  # own token wins
    assert c.post("/api/v1/jobs/nope", headers={"X-Sync-Token": "jobs-token"}).status_code == 404


def test_jobs_endpoint_runs_the_daily_tick(settings, monkeypatch):
    from app.modules.gbp import scheduler

    monkeypatch.setattr(settings, "SALESFORCE_SYNC_TOKEN", "sf-token")
    monkeypatch.setattr(settings, "JOBS_CRON_TOKEN", None)
    calls: list[str] = []

    async def fake_tick(now=None):
        calls.append("tick")
        return "run123"

    monkeypatch.setattr(scheduler, "tick", fake_tick)
    r = _client().post("/api/v1/jobs/gbp", headers={"X-Sync-Token": "sf-token"})
    assert r.status_code == 200
    assert r.json() == {"job": "gbp", "ran": True, "runId": "run123", "detail": "Sync ran."}
    assert calls == ["tick"]


def test_jobs_routes_are_not_in_openapi():
    paths = _client().get("/api/openapi.json").json()["paths"]
    assert not [p for p in paths if p.startswith("/api/v1/jobs")]


# ── file storage routing ──────────────────────────────────────────────────


def test_storage_stays_local_until_supabase_is_configured(settings, monkeypatch, tmp_path):
    from app.common.storage import local_disk
    from app.common.storage.port import PutFileInput

    monkeypatch.setattr(settings, "STORAGE_DIR", str(tmp_path))
    monkeypatch.setattr(settings, "SUPABASE_URL", None)
    monkeypatch.setattr(settings, "SUPABASE_SERVICE_ROLE_KEY", None)
    monkeypatch.setattr(local_disk, "_storage_singleton", None)
    storage = local_disk.get_storage()
    assert storage.remote is None
    stored = asyncio.run(storage.put(PutFileInput(buffer=b"hi", original_name="a.txt", scope="tickets/x")))
    assert stored.key.startswith("local/") and storage.is_managed(stored.key)
    f = asyncio.run(storage.open(stored.key))
    assert f is not None and f.stream.read() == b"hi"
    f.stream.close()
    assert storage.is_managed("sb/tickets/x/a.txt") is False  # no remote backend
    monkeypatch.setattr(local_disk, "_storage_singleton", None)


def test_storage_sends_new_files_to_supabase(settings, monkeypatch):
    import httpx

    from app.common.storage import local_disk, supabase
    from app.common.storage.port import PutFileInput

    monkeypatch.setattr(settings, "SUPABASE_URL", "https://proj.supabase.co")
    monkeypatch.setattr(settings, "SUPABASE_SERVICE_ROLE_KEY", "service-key")
    monkeypatch.setattr(local_disk, "_storage_singleton", None)
    sent: list[httpx.Request] = []
    stored_objects: dict[str, bytes] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        sent.append(request)
        path = request.url.path
        if request.method == "POST" and "/storage/v1/object/superapp-files/" in path:
            stored_objects[path.split("/superapp-files/", 1)[1]] = request.content
            return httpx.Response(200, json={"Key": "ok"})
        if request.method == "GET" and "/object/authenticated/superapp-files/" in path:
            body = stored_objects.get(path.split("/superapp-files/", 1)[1])
            return httpx.Response(200, content=body, headers={"content-type": "text/plain"}) if body else httpx.Response(404)
        if request.method == "DELETE":
            return httpx.Response(200, json=[])
        return httpx.Response(500)

    real_client = httpx.AsyncClient
    monkeypatch.setattr(supabase.httpx, "AsyncClient", lambda **kw: real_client(transport=httpx.MockTransport(handler)))
    storage = local_disk.get_storage()
    stored = asyncio.run(storage.put(PutFileInput(buffer=b"secret plan", original_name="../../plan.txt", mime_type="text/plain", scope="tickets/t1")))
    assert stored.key.startswith("sb/t1/") and stored.key.endswith("-plan.txt")  # same key layout as local disk
    assert sent[0].headers["apikey"] == "service-key"  # a new-style key goes in apikey only
    assert "authorization" not in sent[0].headers
    f = asyncio.run(storage.open(stored.key))
    assert f.stream.read() == b"secret plan" and f.mime_type == "text/plain"
    assert asyncio.run(storage.open("sb/tickets/t1/missing.txt")) is None
    asyncio.run(storage.delete(stored.key))
    assert sent[-1].method == "DELETE"
    # Old local keys still route to local disk.
    assert storage.is_managed("local/tickets/t1/2026/10/x-a.txt")
    monkeypatch.setattr(local_disk, "_storage_singleton", None)


def test_a_run_stopped_before_its_first_item_still_counts_as_time_limited(settings, monkeypatch):
    """Data setup → Refresh all can spend the whole budget on the first sync;
    the next ones must then say they stopped (so the scheduler resumes them),
    not report an empty success."""
    import inspect

    from app.modules.ads import sync as ads_sync
    from app.modules.gbp import sync as gbp_sync
    from app.modules.seo import sync as seo_sync

    for mod in (gbp_sync, ads_sync, seo_sync):
        # SEO wraps the loop in _run_sync (run_sync records a shutdown mid-refresh).
        src = inspect.getsource(getattr(mod, "_run_sync", mod.run_sync))
        assert "time_limited: int | None = None" in src and "if time_limited is not None:" in src, mod.__name__


def test_upload_limit_is_capped_on_serverless(settings, monkeypatch):
    from app.common.storage.upload_helpers import effective_upload_limit_mb

    monkeypatch.setattr(settings, "MAX_UPLOAD_MB", 25)
    assert effective_upload_limit_mb() == 25
    monkeypatch.setattr(settings, "JOBS_MODE", "inline")
    assert effective_upload_limit_mb() == 4


def test_sales_roles_cannot_open_meetings():
    from app.common.capabilities import has_capability
    from app.models.enums import Role

    assert has_capability(Role.SALES_EXECUTIVE, "meetings.view") is False
    assert has_capability(Role.SALES_MANAGER, "meetings.view") is False
    assert has_capability(Role.MARKETING_EXECUTIVE, "meetings.view") is True
