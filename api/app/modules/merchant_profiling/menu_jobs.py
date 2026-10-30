"""Background menu extraction.

An extraction takes ~5–60 s (one API call for the menu, then every photo is
hashed), so it runs as a background task instead of holding the request open:

  * POST /merchants/:id/menu/extract starts one (manual / Re-extract).
  * Creating a merchant with an Innowi ordering link, or changing the link on
    an existing merchant, starts one automatically (routers/merchants.py).

While it runs the menu row's last_status is RUNNING and GET /menu reports
live progress (`progress`: phase + photos checked / total) from the in-memory
table below, so the Menu tab can show a loading display and poll.

One job per merchant at a time. Jobs live in this API process: a restart
mid-run leaves a stale RUNNING row, which is reported as interrupted
(see `effective_status`). Run the API as a single process (uvicorn without
--workers), as it is today.
"""
from __future__ import annotations

import asyncio
import datetime as dt
import logging
from typing import Optional

from sqlalchemy import delete, select, text

from app.common import jobs
from app.db.schemas import qualified
from app.db.session import SessionLocal
from app.models.menu import MerchantMenu, MerchantMenuItem
from app.models.profiling import Merchant
from app.modules.merchant_profiling import menu_extractor as mx
from app.modules.merchant_profiling.completeness_service import refresh_completion_cache

logger = logging.getLogger("MenuJobs")

# merchant_id -> {"phase": str, "done": int, "total": int}
_progress: dict[str, dict] = {}
_tasks: dict[str, asyncio.Task] = {}


def is_running(merchant_id: str) -> bool:
    t = _tasks.get(merchant_id)
    return bool(t and not t.done())


def progress_for(merchant_id: str) -> Optional[dict]:
    return _progress.get(merchant_id) if is_running(merchant_id) else None


def effective_status(menu: MerchantMenu) -> tuple[Optional[str], Optional[str]]:
    """(status, error) — a RUNNING row with no live job is reported as failed
    (the API restarted mid-run, or the job died before saving)."""
    if menu.last_status != "RUNNING" or is_running(menu.merchant_id):
        return menu.last_status, menu.last_error
    if jobs.inline() and menu.last_attempt_at and (
        dt.datetime.now(dt.timezone.utc) - menu.last_attempt_at < jobs.stale_after(dt.timedelta(minutes=15))
    ):
        # Serverless: the job runs inside another request (maybe on another
        # instance), so this process can't see it — trust a recent RUNNING row.
        return menu.last_status, menu.last_error
    if menu.merchant_id in _tasks:
        return "FAILED", "The last extraction stopped unexpectedly. Run it again."
    return "FAILED", "The last extraction was interrupted (the API restarted). Run it again."


async def start(
    merchant_id: str,
    link: str,
    *,
    exclude_catering: bool = False,
    filter_graphics: bool = True,
    save_link: bool = True,
    user_email: Optional[str] = None,
) -> bool:
    """Mark the menu RUNNING and start the job. False if one is already running.
    Raises mx.MenuExtractionError for a link that can't be used."""
    mx.extract_sub_url(link)  # validate before touching anything
    if is_running(merchant_id):
        return False
    async with SessionLocal() as db:
        menu = (await db.execute(select(MerchantMenu).where(MerchantMenu.merchant_id == merchant_id))).scalar_one_or_none()
        if menu is not None and jobs.inline() and effective_status(menu)[0] == "RUNNING":
            return False  # serverless: one is already running in another request / instance
        if menu is None:
            menu = MerchantMenu(merchant_id=merchant_id)
            db.add(menu)
        menu.last_status = "RUNNING"
        menu.last_error = None
        menu.last_attempt_at = dt.datetime.now(dt.timezone.utc)
        menu.exclude_catering = exclude_catering
        menu.filter_graphics = filter_graphics
        await db.commit()
    _progress[merchant_id] = {"phase": "connecting", "done": 0, "total": 0}
    if jobs.inline():
        # Serverless: extract inside this request (5–60 s) — a background task
        # would be frozen as soon as the request answered.
        await jobs.run(
            lambda: _run(merchant_id, link, exclude_catering, filter_graphics, save_link, user_email),
            name=f"menu-extract-{merchant_id}",
        )
        return True
    task = asyncio.create_task(
        _run(merchant_id, link, exclude_catering, filter_graphics, save_link, user_email),
        name=f"menu-extract-{merchant_id}",
    )
    _tasks[merchant_id] = task
    return True


def resolve_link(online_ordering: Optional[str], picked: Optional[str] = None) -> tuple[Optional[str], list[str]]:
    """(link to fetch the menu from, the Innowi links found in the merchant's Online ordering text).

    The text is kept as the team wrote it; the link comes out of it:
      * exactly one Innowi link in the text → that one;
      * several (e.g. a main and a catering branch) → the one picked earlier
        (`picked`, the menu row's source_url) if it is among them, else None:
        someone has to choose;
      * none → the link used last time (a link pasted on the Menu tab), else None.
    """
    text = (online_ordering or "").strip()
    found = [mx.ordering_link(x) for x in mx.find_innowi_links(text)]
    if not found and text:
        one = mx.usable_link(text)  # a clean link or bare slug-only value
        found = [one] if one else []
    if len(found) == 1:
        return found[0], found
    if found:
        if picked and picked.lower() in {f.lower() for f in found}:
            return picked, found
        return None, found
    return (picked or None), found


async def start_if_innowi_link(merchant_id: str, link: Optional[str], user_email: Optional[str] = None) -> bool:
    """Auto-start after a merchant is created/edited. Never raises — a merchant
    save must not fail because the menu couldn't be queued. `link` is the
    merchant's Online ordering text; it is used only when it holds exactly one
    Innowi link."""
    link = mx.usable_link(link)
    if not link:
        return False
    if jobs.inline():
        # Serverless: don't hold the merchant save open for up to a minute; the
        # Menu tab's Extract button runs it on demand.
        logger.info("Auto menu extraction skipped for %s (serverless); use Extract on the Menu tab", merchant_id)
        return False
    try:
        async with SessionLocal() as db:
            ready = (
                await db.execute(text("select to_regclass(:t) is not null"), {"t": f"{qualified('profiling')}.merchant_menu"})
            ).scalar()
        if not ready:
            logger.warning("Menu tables missing — run `alembic upgrade head`; skipping auto menu extraction")
            return False
        return await start(merchant_id, link or "", save_link=True, user_email=user_email)
    except Exception as e:  # pragma: no cover - defensive
        logger.warning("Couldn't start menu extraction for %s: %s", merchant_id, e)
        return False


async def _run(merchant_id: str, link: str, exclude_catering: bool, filter_graphics: bool, save_link: bool, user_email: Optional[str]) -> None:
    def on_progress(phase: str, done: int, total: int) -> None:
        _progress[merchant_id] = {"phase": phase, "done": done, "total": total}

    try:
        try:
            result = await mx.extract_menu(
                link, exclude_catering=exclude_catering, filter_graphics=filter_graphics, on_progress=on_progress,
            )
            if not result.items:
                raise mx.MenuExtractionError("The ordering page has no menu items (or every category was excluded).")
        except mx.MenuExtractionError as e:
            await _record_failure(merchant_id, str(e))
            return
        except Exception as e:  # unexpected — keep the old menu, say something useful
            logger.exception("Menu extraction crashed for %s", merchant_id)
            await _record_failure(merchant_id, f"Unexpected error while extracting the menu ({e.__class__.__name__}).")
            return

        _progress[merchant_id] = {"phase": "saving", "done": len(result.items), "total": len(result.items)}
        try:
            await _save(merchant_id, result, save_link, user_email)
        except Exception as e:
            logger.exception("Saving the menu failed for %s", merchant_id)
            await _record_failure(merchant_id, f"The menu was read but couldn't be saved ({e.__class__.__name__}).")
    finally:
        _progress.pop(merchant_id, None)


async def start_queue(items: list[tuple[str, str]], user_email: Optional[str] = None) -> dict:
    """Fetch several menus one after another (not all at once: each one downloads
    every photo). `items` = (merchant_id, link). Returns {"started", "skipped",
    "remaining"}: on a serverless host they run inside this request until its
    time budget is used, and the rest are "remaining" (run it again)."""
    todo: list[tuple[str, str]] = []
    skipped: dict[str, str] = {}
    for mid, link in items:
        try:
            mx.extract_sub_url(link)
        except mx.MenuExtractionError as e:
            skipped[mid] = str(e)
            continue
        if is_running(mid):
            skipped[mid] = "Already being fetched."
            continue
        todo.append((mid, link))
    if jobs.inline():
        started: list[str] = []
        for i, (mid, link) in enumerate(todo):
            if jobs.time_up():
                return {"started": started, "skipped": skipped, "remaining": [m for m, _ in todo[i:]]}
            if await start(mid, link, save_link=True, user_email=user_email):
                started.append(mid)
            else:
                skipped[mid] = "Already being fetched."
        return {"started": started, "skipped": skipped, "remaining": []}
    if not todo:
        return {"started": [], "skipped": skipped, "remaining": []}
    now = dt.datetime.now(dt.timezone.utc)
    async with SessionLocal() as db:
        for mid, _ in todo:
            menu = (await db.execute(select(MerchantMenu).where(MerchantMenu.merchant_id == mid))).scalar_one_or_none()
            if menu is None:
                menu = MerchantMenu(merchant_id=mid)
                db.add(menu)
            menu.last_status, menu.last_error, menu.last_attempt_at = "RUNNING", None, now
        await db.commit()
    for mid, _ in todo:
        _progress[mid] = {"phase": "queued", "done": 0, "total": 0}

    async def run_all() -> None:
        for mid, link in todo:
            try:
                await _run(mid, link, False, True, True, user_email)
            except Exception:  # pragma: no cover - _run records its own failures
                logger.exception("Queued menu fetch failed for %s", mid)
            finally:
                _tasks.pop(mid, None)

    task = asyncio.create_task(run_all(), name="menu-extract-queue")
    for mid, _ in todo:
        _tasks[mid] = task
    return {"started": [m for m, _ in todo], "skipped": skipped, "remaining": []}


async def _record_failure(merchant_id: str, message: str) -> None:
    async with SessionLocal() as db:
        menu = (await db.execute(select(MerchantMenu).where(MerchantMenu.merchant_id == merchant_id))).scalar_one_or_none()
        if menu:
            menu.last_status = "FAILED"
            menu.last_error = message
            await db.commit()


async def _save(merchant_id: str, result: mx.MenuResult, save_link: bool, user_email: Optional[str]) -> None:
    async with SessionLocal() as db:
        merchant = await db.get(Merchant, merchant_id)
        menu = (await db.execute(select(MerchantMenu).where(MerchantMenu.merchant_id == merchant_id))).scalar_one_or_none()
        if merchant is None or menu is None:
            return  # merchant deleted mid-run
        await db.execute(delete(MerchantMenuItem).where(MerchantMenuItem.merchant_id == merchant_id))
        for pos, it in enumerate(result.items):
            db.add(MerchantMenuItem(
                merchant_id=merchant_id, position=pos, name=it["name"][:500], price=it["price"],
                category=it["category"], description=it["description"],
                image_url=(it["image_url"] or None) and it["image_url"][:1000],
                image_hash=it["image_hash"], status=it["status"],
            ))
        stats = result.stats
        menu.source_url = mx.ordering_link(result.sub_url)
        menu.sub_url = result.sub_url
        menu.branch_id = result.branch_id
        menu.restaurant_name = result.restaurant_name
        menu.logo_url = result.logo_url
        menu.banner_url = result.banner_url
        menu.total_count = stats["total"]
        menu.valid_count = stats["valid"]
        menu.graphic_skipped_count = stats["graphicSkipped"]
        menu.no_image_count = stats["noImage"]
        menu.last_status = "OK"
        menu.last_error = None
        menu.extracted_at = dt.datetime.now(dt.timezone.utc)
        menu.extracted_by = user_email

        # The Online ordering text is the team's own notes (platforms, other
        # branches, ...): it is never replaced by the clean link. It is only
        # filled in when the profile has nothing there yet.
        link_changed = False
        if save_link and not (merchant.online_ordering or "").strip():
            merchant.online_ordering = menu.source_url
            link_changed = True
        await db.commit()
        if link_changed:
            await refresh_completion_cache(db, merchant_id)
