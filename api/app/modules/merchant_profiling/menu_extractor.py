"""Menu extractor — pulls a merchant's full menu (items, prices, categories,
images) from their Innowi Online Ordering page.

Port of the desktop "Innowi Menu Scraper" (Blog Automation/Application/
innowi_engine.py) into the API, async and without the GUI:

    1. The ordering link https://online-ordering.innowi.com/branch/<subUrl>
       is reduced to its subUrl.
    2. POST /session/login {subUrl} → branchId (the public API needs this
       session cookie before it serves the menu).
    3. GET /merchant/branch/<subUrl> → restaurant name, logo, banner.
    4. GET /merchant/<branchId>/product_by_group → categories with "deals"
       (the menu items).
    5. Item images are downloaded and MD5-hashed so placeholder artwork is
       dropped: anything identical to the restaurant's logo/banner, and any
       image shared by more than five items (a stock "no photo" graphic).

Differences from the desktop tool, all deliberate:
  * Image downloads run in parallel (bounded), so a 200-item menu takes
    seconds, not minutes.
  * Items whose image could not be downloaded stay VALID instead of all being
    lumped into one "ERROR" hash — the desktop tool marked every item a
    "Repeated Graphic" when more than five downloads failed.
  * Only Innowi hosts are accepted as links (no fetching arbitrary URLs).
  * Every item is kept, with a status, so the UI can show what was skipped and
    why; "valid" is the default view.

Pure of the database: `extract_menu()` returns plain dicts. The router stores
them (routers/menu.py). Tested with httpx.MockTransport (tests/test_menu_extractor.py).
"""
from __future__ import annotations

import asyncio
import hashlib
import re
from dataclasses import dataclass, field
from typing import Any, Callable, Optional
from urllib.parse import urlparse

import httpx

API_BASE = "https://restaurantapi.innowi.com/v1/online"
ORDERING_BASE = "https://online-ordering.innowi.com/branch/"

# A stock graphic is "repeated" when MORE than this many items share it.
REPEAT_THRESHOLD = 5
IMAGE_CONCURRENCY = 8
MAX_IMAGE_BYTES = 8 * 1024 * 1024

STATUS_VALID = "VALID"
STATUS_NO_IMAGE = "NO_IMAGE"
STATUS_LOGO = "LOGO_GRAPHIC"
STATUS_REPEATED = "REPEATED_GRAPHIC"

_SLUG_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$")


class MenuExtractionError(Exception):
    """A problem worth showing to the user as-is (bad link, branch not found,
    ordering site unreachable)."""


def ordering_link(sub_url: str) -> str:
    return ORDERING_BASE + sub_url


_BARE_BRANCH_RE = re.compile(r"(?<![A-Za-z0-9.])/branch/([A-Za-z0-9_-]+)")
_LINK_IN_TEXT_RE = re.compile(r"(?:https?://)?(?:[a-z0-9-]+\.)*innowi\.com/branch/([A-Za-z0-9_-]+)", re.IGNORECASE)


def find_innowi_links(text: Optional[str]) -> list[str]:
    """Branch slugs of every Innowi ordering link written anywhere in a piece of
    text, in order, without repeats (case ignored). The merchant profile's
    "Online ordering" is often prose: "Innowi direct (online-ordering.innowi.com/
    branch/kfusionbst) + DoorDash + Grubhub". A bare "/branch/x" counts only next
    to a full Innowi link: on its own it can't be told apart from another platform's path."""
    out: list[str] = []
    text = text or ""
    matches = list(_LINK_IN_TEXT_RE.finditer(text))
    # Once the text has a full Innowi link, a bare "/branch/x" beside it is another
    # Innowi branch ("…/branch/medgrill (main) and /branch/Medgrillcatering").
    if matches:
        matches = sorted(matches + list(_BARE_BRANCH_RE.finditer(text)), key=lambda m: m.start())
    for m in matches:
        slug = m.group(1)
        if _SLUG_RE.match(slug) and slug.lower() not in {x.lower() for x in out}:
            out.append(slug)
    return out


def usable_link(value: Optional[str]) -> Optional[str]:
    """The one Innowi ordering link in `value` (a clean link, a bare slug-free
    link, or prose containing exactly one), else None — no link, or several
    (then someone has to pick, see routers/menu_bulk.py)."""
    v = (value or "").strip()
    if not v:
        return None
    if not re.search(r"\s", v):  # a single link, not prose
        try:
            if "://" in v or "branch/" in v:
                return ordering_link(extract_sub_url(v))
        except MenuExtractionError:
            pass
    found = find_innowi_links(v)
    return ordering_link(found[0]) if len(found) == 1 else None


def is_innowi_ordering_link(value: Optional[str]) -> bool:
    """True when `value` looks like an Innowi online-ordering link (used by the
    UI to decide whether the merchant's saved "Online ordering" can be used)."""
    if not value:
        return False
    try:
        extract_sub_url(value)
        return "://" in value or "branch/" in value
    except MenuExtractionError:
        return False


def extract_sub_url(value: str) -> str:
    """The branch slug from a full ordering link or a bare slug.

    Accepts  https://online-ordering.innowi.com/branch/coffeeheist?x=1
             online-ordering.innowi.com/branch/coffeeheist
             coffeeheist
    Rejects links on any other host (Toast, DoorDash, the merchant's site…).
    """
    s = (value or "").strip()
    if not s:
        raise MenuExtractionError("Enter the merchant's Innowi online-ordering link.")
    if "/" in s or "://" in s:
        parsed = urlparse(s if "://" in s else "https://" + s)
        host = (parsed.hostname or "").lower()
        if not (host == "innowi.com" or host.endswith(".innowi.com")):
            raise MenuExtractionError(
                "That isn't an Innowi online-ordering link. It should look like "
                "https://online-ordering.innowi.com/branch/<restaurant>."
            )
        path = parsed.path
        if "branch/" not in path:
            raise MenuExtractionError("The link has no /branch/<restaurant> part.")
        s = path.split("branch/", 1)[1]
    s = s.split("?")[0].split("#")[0].strip("/").split("/")[0]
    if not _SLUG_RE.match(s):
        raise MenuExtractionError("Couldn't read the restaurant name from that link.")
    return s


async def check_branch(link: str, *, transport: Optional[httpx.AsyncBaseTransport] = None) -> int:
    """Quick "can this menu be fetched?": the same session login the full
    extraction starts with, nothing downloaded. Returns the branch id; raises
    MenuExtractionError with a reason to show when it can't."""
    sub_url = extract_sub_url(link)
    async with httpx.AsyncClient(timeout=15, transport=transport, follow_redirects=True,
                                 headers={"Content-Type": "application/json", "Accept": "application/json",
                                          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) InnowiSuperApp"}) as client:
        try:
            r = await client.post(f"{API_BASE}/session/login", json={"branchId": None, "subUrl": sub_url})
        except httpx.HTTPError as e:
            raise MenuExtractionError(f"Couldn't reach Innowi Online Ordering ({e.__class__.__name__}). Try again in a minute.") from e
        data = _json(r)
        if r.status_code >= 400 or not data.get("success"):
            raise MenuExtractionError(f"No Innowi online-ordering branch called '{sub_url}' was found. Check the link.")
        bid = _int_or_none(data.get("branchId"))
        if bid is None:
            raise MenuExtractionError(f"Innowi didn't return a branch for '{sub_url}'.")
        return bid


def _price(deal: dict) -> Optional[float]:
    raw = deal.get("price")
    if raw in (None, "", 0, "0"):
        raw = deal.get("currentPrice") or raw
    try:
        return round(float(raw), 2) if raw not in (None, "") else None
    except (TypeError, ValueError):
        return None


def parse_menu(categories: Any, *, exclude_catering: bool = False) -> list[dict]:
    """Flatten product_by_group → items, de-duplicated by name (first wins, as
    the desktop tool did). Pure; unit-tested."""
    items: list[dict] = []
    seen: set[str] = set()
    for cat in categories if isinstance(categories, list) else []:
        if not isinstance(cat, dict):
            continue
        cat_name = (cat.get("name") or "").strip()
        if exclude_catering and "catering" in cat_name.lower():
            continue
        for deal in cat.get("deals") or []:
            if not isinstance(deal, dict):
                continue
            name = (deal.get("name") or "").strip()
            if not name or name in seen:
                continue
            seen.add(name)
            image = (deal.get("imageName") or "").strip() or None
            description = (deal.get("description") or "").strip() or None
            items.append({
                "name": name,
                "price": _price(deal),
                "category": cat_name or None,
                "description": description,
                "image_url": image,
                "image_hash": None,
                "status": STATUS_VALID,
            })
    return items


def classify_images(items: list[dict], baseline_hashes: set[str], *, filter_graphics: bool = True) -> None:
    """Set each item's status from its image hash (in place). Pure; unit-tested."""
    counts: dict[str, int] = {}
    for it in items:
        h = it.get("image_hash")
        if h:
            counts[h] = counts.get(h, 0) + 1
    for it in items:
        url = it.get("image_url")
        if not url or "no-image" in url.lower():
            it["status"] = STATUS_NO_IMAGE
            continue
        if not filter_graphics:
            it["status"] = STATUS_VALID
            continue
        h = it.get("image_hash")
        if h and h in baseline_hashes:
            it["status"] = STATUS_LOGO
        elif h and counts.get(h, 0) > REPEAT_THRESHOLD:
            it["status"] = STATUS_REPEATED
        else:
            it["status"] = STATUS_VALID


async def _hash_url(client: httpx.AsyncClient, url: str) -> Optional[str]:
    if not url or not url.lower().startswith(("http://", "https://")):
        return None
    try:
        async with client.stream("GET", url, timeout=15) as r:
            if r.status_code != 200:
                return None
            md5 = hashlib.md5()
            size = 0
            async for chunk in r.aiter_bytes():
                size += len(chunk)
                if size > MAX_IMAGE_BYTES:
                    return None
                md5.update(chunk)
            return md5.hexdigest().upper()
    except httpx.HTTPError:
        return None


@dataclass
class MenuResult:
    sub_url: str
    branch_id: Optional[int]
    restaurant_name: Optional[str]
    logo_url: Optional[str]
    banner_url: Optional[str]
    items: list[dict] = field(default_factory=list)

    @property
    def stats(self) -> dict[str, int]:
        s = {"total": len(self.items), "valid": 0, "graphicSkipped": 0, "noImage": 0}
        for it in self.items:
            if it["status"] == STATUS_VALID:
                s["valid"] += 1
            elif it["status"] == STATUS_NO_IMAGE:
                s["noImage"] += 1
            else:
                s["graphicSkipped"] += 1
        return s


async def extract_menu(
    link: str,
    *,
    exclude_catering: bool = False,
    filter_graphics: bool = True,
    transport: Optional[httpx.AsyncBaseTransport] = None,
    on_progress: Optional[Callable[[str, int, int], None]] = None,
) -> MenuResult:
    """Run the whole extraction for one ordering link. Raises
    MenuExtractionError with a user-facing message on any failure.

    `on_progress(phase, done, total)` is called as it goes — phases:
    "connecting", "menu", "images" (done/total photos), "done"."""

    def progress(phase: str, done: int = 0, total: int = 0) -> None:
        if on_progress:
            try:
                on_progress(phase, done, total)
            except Exception:  # progress reporting must never break a run
                pass

    sub_url = extract_sub_url(link)
    progress("connecting")
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) InnowiSuperApp",
    }
    async with httpx.AsyncClient(headers=headers, timeout=20, transport=transport, follow_redirects=True) as client:
        try:
            r = await client.post(f"{API_BASE}/session/login", json={"branchId": None, "subUrl": sub_url})
        except httpx.HTTPError as e:
            raise MenuExtractionError(f"Couldn't reach Innowi Online Ordering ({e.__class__.__name__}). Try again in a minute.") from e
        data = _json(r)
        if r.status_code >= 400 or not data.get("success"):
            raise MenuExtractionError(f"No Innowi online-ordering branch called '{sub_url}' was found. Check the link.")
        branch_id = data.get("branchId")

        info: dict = {}
        try:
            ir = await client.get(f"{API_BASE}/merchant/branch/{sub_url}", params={"device-type": "ONLINE"})
            if ir.status_code == 200:
                info = _json(ir)
        except httpx.HTTPError:
            info = {}

        progress("menu")
        try:
            mr = await client.get(
                f"{API_BASE}/merchant/{branch_id}/product_by_group",
                params={"groupId": -1, "orderType": "PICKUP"},
            )
        except httpx.HTTPError as e:
            raise MenuExtractionError("Innowi Online Ordering didn't return the menu. Try again in a minute.") from e
        if mr.status_code >= 400:
            raise MenuExtractionError(f"Innowi Online Ordering refused the menu request (HTTP {mr.status_code}).")
        try:
            categories = mr.json()
        except ValueError as e:
            raise MenuExtractionError("Innowi Online Ordering returned a menu we couldn't read.") from e

        items = parse_menu(categories, exclude_catering=exclude_catering)
        logo_url = (info.get("logoUrl") or "").strip() or None
        banner_url = (info.get("websiteBackgroundBanner") or "").strip() or None

        baseline: set[str] = set()
        if filter_graphics:
            sem = asyncio.Semaphore(IMAGE_CONCURRENCY)

            # One download per distinct URL, even if items share it.
            urls = sorted({it["image_url"] for it in items if it["image_url"] and "no-image" not in it["image_url"].lower()})
            done = 0
            progress("images", 0, len(urls))

            async def bounded(url: str, count: bool = False) -> Optional[str]:
                nonlocal done
                async with sem:
                    h = await _hash_url(client, url)
                if count:
                    done += 1
                    progress("images", done, len(urls))
                return h

            for h in await asyncio.gather(*(bounded(u) for u in (logo_url, banner_url) if u)):
                if h:
                    baseline.add(h)
            hashes = dict(zip(urls, await asyncio.gather(*(bounded(u, True) for u in urls))))
            for it in items:
                it["image_hash"] = hashes.get(it["image_url"]) if it["image_url"] else None

        classify_images(items, baseline, filter_graphics=filter_graphics)
        progress("done", len(items), len(items))

    return MenuResult(
        sub_url=sub_url,
        branch_id=branch_id if isinstance(branch_id, int) else _int_or_none(branch_id),
        restaurant_name=(info.get("name") or "").strip() or None,
        logo_url=logo_url,
        banner_url=banner_url,
        items=items,
    )


def _int_or_none(v: Any) -> Optional[int]:
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def _json(r: httpx.Response) -> dict:
    try:
        d = r.json()
        return d if isinstance(d, dict) else {}
    except ValueError:
        return {}
