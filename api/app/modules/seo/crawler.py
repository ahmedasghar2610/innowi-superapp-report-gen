"""Screaming Frog crawls done by helper PCs.

A helper (helper.py, on a PC with a licensed Screaming Frog, started with
Windows by 3-start-with-windows.bat) asks the Super App for work every minute.
Nothing connects *into* that PC: it only makes outgoing requests, with its
crawler key in the X-Crawler-Key header.

    GET  /seo/crawler/ping                  key check, "last seen"
    GET  /seo/crawler/next                  claims the oldest queued job → {"job": {id, domain, url}} | {"job": null}
    POST /seo/crawler/jobs/{id}/status      {"status": "running" | "failed", "message"}
    POST /seo/crawler/jobs/{id}/result      the Screaming Frog CSV export as a zip

The zip is read with the same parser as the manual import (sf_import.parse:
internal_all.csv, issues_overview_report.csv, issues_reports/*.csv and the
optional extras), stored as a new crawl, and the site's scorecard and findings
are recomputed — exactly what `python -m scripts.seo_import_sf` does by hand.

People queue crawls from the SEO pages ("Crawl all sites", "Crawl now"). Each
job goes to one helper only, so several helpers can run (a backup PC); when
none is online, jobs simply wait.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import io
import logging
import secrets
import tempfile
import zipfile
from pathlib import Path
from typing import Optional

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.common import jobs
from app.models.seo import SeoCrawl, SeoCrawlerKey, SeoCrawlJob, SeoSite, utcnow
from app.modules.seo import data, pagespeed, sf_import
from app.modules.seo.crawl import host_of

logger = logging.getLogger("SEO.crawler")

KEY_PREFIX = "sfk_"
ONLINE_FOR = dt.timedelta(minutes=3)  # helpers ask every minute
RUNNING_FOR = dt.timedelta(hours=2)  # a crawl that hasn't reported back by then has died
MAX_ZIP_BYTES = 40 * 1024 * 1024
MAX_UNZIPPED_BYTES = 400 * 1024 * 1024
ACTIVE = ("queued", "running", "saving")  # saving: the export arrived and is being stored / scored


class CrawlerError(ValueError):
    """Shown to the person / helper as is."""


# ================================================================ keys ====


def hash_key(key: str) -> str:
    return hashlib.sha256(key.strip().encode("utf-8")).hexdigest()


async def create_key(db: AsyncSession, name: str, user_id: Optional[str]) -> tuple[SeoCrawlerKey, str]:
    name = " ".join((name or "").split())[:80]
    if not name:
        raise CrawlerError("Give the key a name, e.g. the laptop it is for.")
    key = KEY_PREFIX + secrets.token_urlsafe(30)
    row = SeoCrawlerKey(name=name, key_hash=hash_key(key), key_hint=key[-4:], created_by_id=user_id)
    db.add(row)
    await db.commit()
    return row, key


async def key_for(db: AsyncSession, key: Optional[str]) -> Optional[SeoCrawlerKey]:
    if not key or not key.strip():
        return None
    row = (await db.execute(select(SeoCrawlerKey).where(SeoCrawlerKey.key_hash == hash_key(key)))).scalar_one_or_none()
    if not row or row.revoked_at:
        return None
    return row


def is_online(k: SeoCrawlerKey, now: Optional[dt.datetime] = None) -> bool:
    return bool(k.last_seen_at and not k.revoked_at and (now or utcnow()) - k.last_seen_at <= ONLINE_FOR)


def key_dto(k: SeoCrawlerKey, now: Optional[dt.datetime] = None) -> dict:
    return {
        "id": k.id, "name": k.name, "hint": k.key_hint, "createdAt": k.created_at.isoformat() if k.created_at else None,
        "revokedAt": k.revoked_at.isoformat() if k.revoked_at else None,
        "lastSeenAt": k.last_seen_at.isoformat() if k.last_seen_at else None,
        "helperName": k.helper_name, "helperVersion": k.helper_version, "online": is_online(k, now),
    }


def seen(k: SeoCrawlerKey, name: Optional[str], version: Optional[str]) -> None:
    k.last_seen_at = utcnow()
    if name:
        k.helper_name = name[:120]
    if version:
        k.helper_version = version[:20]


# ================================================================ jobs ====


def site_url(site: SeoSite) -> str:
    return (site.home_url or f"https://{site.domain}/").strip()


def job_dto(j: SeoCrawlJob, site: Optional[SeoSite] = None) -> dict:
    return {
        "id": j.id, "siteId": j.site_id, "siteName": site.name if site else None, "domain": site.domain if site else host_of(j.url),
        "url": j.url, "status": j.status, "requestedAt": j.requested_at.isoformat(),
        "claimedAt": j.claimed_at.isoformat() if j.claimed_at else None, "finishedAt": j.finished_at.isoformat() if j.finished_at else None,
        "helper": j.helper_name, "message": j.message, "crawlId": j.crawl_id, "urls": j.urls, "durationSec": j.duration_sec,
    }


async def expire_stale(db: AsyncSession, now: Optional[dt.datetime] = None) -> int:
    """Running jobs whose helper never reported back (PC switched off mid-crawl, helper killed)."""
    now = now or utcnow()
    res = await db.execute(
        update(SeoCrawlJob)
        .where(SeoCrawlJob.status.in_(("running", "saving")), SeoCrawlJob.claimed_at < now - RUNNING_FOR)
        .values(status="failed", finished_at=now,
                message="The helper stopped reporting (the PC was switched off or lost its connection). Crawl again.")
    )
    return res.rowcount or 0


async def queue(db: AsyncSession, sites: list[SeoSite], user_id: Optional[str]) -> dict:
    """Queue a crawl of each site, skipping sites that already have one waiting or running."""
    if not sites:
        return {"queued": 0, "skipped": 0, "jobs": []}
    busy = set((await db.execute(
        select(SeoCrawlJob.site_id).where(SeoCrawlJob.site_id.in_([s.id for s in sites]), SeoCrawlJob.status.in_(ACTIVE))
    )).scalars())
    now = utcnow()
    jobs = []
    for i, s in enumerate(sites):
        if s.id in busy:
            continue
        # A microsecond apart, so "oldest first" keeps the order the sites were listed in.
        j = SeoCrawlJob(site_id=s.id, url=site_url(s), status="queued", requested_by_id=user_id, requested_at=now + dt.timedelta(microseconds=i))
        db.add(j)
        jobs.append((j, s))
    await db.commit()
    return {"queued": len(jobs), "skipped": len(sites) - len(jobs), "jobs": [job_dto(j, s) for j, s in jobs]}


async def cancel(db: AsyncSession, job: SeoCrawlJob) -> None:
    if job.status != "queued":
        raise CrawlerError("Only a crawl that hasn't started yet can be cancelled.")
    job.status, job.finished_at, job.message = "cancelled", utcnow(), "Cancelled before a helper picked it up."
    await db.commit()


async def claim(db: AsyncSession, k: SeoCrawlerKey) -> Optional[tuple[SeoCrawlJob, SeoSite]]:
    """The oldest queued job, for this helper only (row lock: two helpers never get the same job)."""
    now = utcnow()
    await expire_stale(db, now)
    # A helper asking for new work while a job of its own is still "running" was restarted mid-crawl.
    await db.execute(
        update(SeoCrawlJob).where(SeoCrawlJob.key_id == k.id, SeoCrawlJob.status == "running")
        .values(status="failed", finished_at=now, message="The helper was restarted before this crawl finished. Crawl again.")
    )
    job = (await db.execute(
        select(SeoCrawlJob).where(SeoCrawlJob.status == "queued").order_by(SeoCrawlJob.requested_at)
        .limit(1).with_for_update(skip_locked=True)
    )).scalar_one_or_none()
    if not job:
        await db.commit()
        return None
    job.status, job.claimed_at, job.key_id, job.helper_name = "running", now, k.id, k.helper_name or k.name
    job.message = f"Crawling on {job.helper_name}"
    site = await db.get(SeoSite, job.site_id)
    await db.commit()
    return job, site


async def job_for_key(db: AsyncSession, k: SeoCrawlerKey, job_id: str) -> SeoCrawlJob:
    job = await db.get(SeoCrawlJob, job_id)
    if not job or job.key_id != k.id:
        raise CrawlerError("This job isn't assigned to this helper.")
    return job


async def report(db: AsyncSession, k: SeoCrawlerKey, job_id: str, status: str, message: Optional[str]) -> SeoCrawlJob:
    job = await job_for_key(db, k, job_id)
    if job.status not in ACTIVE:
        raise CrawlerError(f"This job is already {job.status}.")
    if status == "running":
        job.message = (message or job.message or "")[:1000] or None
    elif status == "failed":
        job.status, job.finished_at = "failed", utcnow()
        job.message = (message or "The crawl failed on the helper.")[:2000]
    else:
        raise CrawlerError("status must be running or failed.")
    await db.commit()
    return job


def unzip_csvs(blob: bytes, dest: Path) -> int:
    """Only the .csv files, flattened to their own names inside `issues_reports/` or the root
    (no paths from the archive are trusted). Returns how many files were written."""
    if len(blob) > MAX_ZIP_BYTES:
        raise CrawlerError(f"The export is larger than {MAX_ZIP_BYTES // (1024 * 1024)} MB.")
    try:
        zf = zipfile.ZipFile(io.BytesIO(blob))
    except zipfile.BadZipFile:
        raise CrawlerError("The upload isn't a zip file.")
    total, n = 0, 0
    (dest / "issues_reports").mkdir(parents=True, exist_ok=True)
    for info in zf.infolist():
        if info.is_dir():
            continue
        parts = [p for p in info.filename.replace("\\", "/").split("/") if p not in ("", ".", "..")]
        if not parts or not parts[-1].lower().endswith(".csv"):
            continue
        total += info.file_size
        if total > MAX_UNZIPPED_BYTES:
            raise CrawlerError("The export is too large once unzipped.")
        name = Path(parts[-1]).name
        sub = dest / "issues_reports" if len(parts) > 1 and parts[-2].lower() == "issues_reports" else dest
        with zf.open(info) as src, open(sub / name, "wb") as out:
            out.write(src.read())
        n += 1
    if not n:
        raise CrawlerError("The zip has no CSV files in it.")
    return n


def check_zip(blob: bytes) -> None:
    """Cheap checks before the upload is accepted (the full read happens while saving)."""
    if len(blob) > MAX_ZIP_BYTES:
        raise CrawlerError(f"The export is larger than {MAX_ZIP_BYTES // (1024 * 1024)} MB.")
    try:
        names = [n.replace("\\", "/").rsplit("/", 1)[-1].lower() for n in zipfile.ZipFile(io.BytesIO(blob)).namelist()]
    except zipfile.BadZipFile:
        raise CrawlerError("The upload isn't a zip file.")
    if "internal_all.csv" not in names:
        raise CrawlerError("internal_all.csv is missing from the Screaming Frog export.")


def _upload_path(job_id: str) -> Path:
    folder = Path(tempfile.gettempdir()) / "sfcrawl-uploads"
    folder.mkdir(parents=True, exist_ok=True)
    return folder / f"{job_id}.zip"


async def receive(db: AsyncSession, k: SeoCrawlerKey, job_id: str, blob: bytes, duration: Optional[int] = None) -> dict:
    """The helper's upload. It is accepted at once and saved + scored as a job of its own (in the
    background on a server; inside this request on a serverless host), so a busy moment in the Super
    App — another refresh writing the same site — never keeps the helper waiting."""
    job = await job_for_key(db, k, job_id)
    if job.status != "running":
        raise CrawlerError(f"This job is already {job.status}.")
    try:
        check_zip(blob)
    except CrawlerError as exc:
        job.status, job.finished_at, job.message = "failed", utcnow(), str(exc)
        await db.commit()
        raise
    path = _upload_path(job_id)
    path.write_bytes(blob)
    job.status, job.duration_sec, job.message = "saving", duration, "Received — saving the crawl and updating the scores…"
    await db.commit()
    await jobs.run(lambda: save_in_new_session(job_id, str(path)), name=f"sf-crawl-{job_id}")
    if jobs.inline():  # already saved inside this request
        await db.refresh(job)
        if job.status == "failed":
            raise CrawlerError(job.message or "Saving the crawl failed.")
        return {"status": job.status, "crawlId": job.crawl_id, "urls": job.urls, "message": job.message}
    return {"status": "saving", "message": "Received — the Super App is saving it and updating the site's scores."}


async def save_in_new_session(job_id: str, path: str) -> None:
    from app.db.session import SessionLocal

    async with SessionLocal() as db:
        await save(db, job_id, Path(path))


async def save(db: AsyncSession, job_id: str, path: Path) -> Optional[dict]:
    """Store an uploaded crawl and rescore the site. Problems in the export fail the job with the reason."""
    try:
        job = await db.get(SeoCrawlJob, job_id)
        if not job or job.status != "saving":
            return None
        site = await db.get(SeoSite, job.site_id)
        helper = job.helper_name or "helper"
        try:
            with tempfile.TemporaryDirectory(prefix="sfcrawl-") as tmp:
                unzip_csvs(path.read_bytes(), Path(tmp))
                parsed = sf_import.parse(Path(tmp))
                if host_of(parsed.domain) != host_of(site.domain):
                    raise CrawlerError(f"The crawl is of {parsed.domain}, not {site.domain} (does the site redirect to another domain?).")
                crawl = await sf_import.store(db, site, parsed, f"helper: {helper}")
        except (CrawlerError, sf_import.ImportProblem, OSError) as exc:
            await db.rollback()
            job = await db.get(SeoCrawlJob, job_id)
            job.status, job.finished_at, job.message = "failed", utcnow(), str(exc)[:2000]
            await db.commit()
            return None
        job = await db.get(SeoCrawlJob, job_id)
        site = await db.get(SeoSite, job.site_id)
        out = await data.recompute(db, site, psi_configured=pagespeed.configured())
        t = parsed.totals
        c = out.get("findings") or {}
        job.status, job.finished_at, job.crawl_id, job.urls = "done", utcnow(), crawl.id, t.get("urls")
        job.message = (f"Saved: {t.get('urls')} URLs · {t.get('issuesWithUrls')} issue types · "
                       f"health {site.health if site.health is not None else '—'} · {c.get('new', 0)} new findings")
        await db.commit()
        return {"crawlId": crawl.id, "urls": t.get("urls")}
    except Exception as exc:  # never leave a job "saving"
        logger.exception("Saving crawl job %s failed", job_id)
        await db.rollback()
        job = await db.get(SeoCrawlJob, job_id)
        if job and job.status == "saving":
            job.status, job.finished_at = "failed", utcnow()
            job.message = f"Saving failed: {exc.__class__.__name__}: {str(exc)[:300]}"
            await db.commit()
        return None
    finally:
        try:
            path.unlink()
        except OSError:
            pass


# ============================================================== status ====


def _iso(v: Optional[dt.datetime]) -> Optional[str]:
    return v.isoformat() if v else None


async def status(db: AsyncSession, now: Optional[dt.datetime] = None) -> dict:
    """The crawler strip on the SEO pages: helpers, queue, the latest job per site."""
    now = now or utcnow()
    if await expire_stale(db, now):
        await db.commit()
    keys = list((await db.execute(select(SeoCrawlerKey).where(SeoCrawlerKey.revoked_at.is_(None)).order_by(SeoCrawlerKey.created_at))).scalars())
    counts = dict((await db.execute(
        select(SeoCrawlJob.status, func.count()).where(SeoCrawlJob.status.in_(ACTIVE)).group_by(SeoCrawlJob.status)
    )).all())
    # latest job per site
    latest_ids = select(SeoCrawlJob.site_id, func.max(SeoCrawlJob.requested_at).label("at")).group_by(SeoCrawlJob.site_id).subquery()
    rows = (await db.execute(
        select(SeoCrawlJob, SeoSite).join(latest_ids, (SeoCrawlJob.site_id == latest_ids.c.site_id) & (SeoCrawlJob.requested_at == latest_ids.c.at))
        .join(SeoSite, SeoSite.id == SeoCrawlJob.site_id)
    )).all()
    last_crawl = dict((await db.execute(select(SeoCrawl.site_id, func.max(SeoCrawl.crawled_at)).group_by(SeoCrawl.site_id))).all())
    recent = (await db.execute(
        select(SeoCrawlJob, SeoSite).join(SeoSite, SeoSite.id == SeoCrawlJob.site_id).order_by(SeoCrawlJob.requested_at.desc()).limit(15)
    )).all()
    online = [k for k in keys if is_online(k, now)]
    return {
        "helpers": [key_dto(k, now) for k in keys],
        "online": len(online),
        "lastSeenAt": _iso(max((k.last_seen_at for k in keys if k.last_seen_at), default=None)),
        "queued": int(counts.get("queued", 0)),
        "running": int(counts.get("running", 0)),
        "saving": int(counts.get("saving", 0)),
        "sites": {s.id: {**job_dto(j, s), "lastCrawledAt": last_crawl[s.id].isoformat() if last_crawl.get(s.id) else None} for j, s in rows},
        "recent": [job_dto(j, s) for j, s in recent],
    }
