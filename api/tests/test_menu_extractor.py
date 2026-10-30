"""Menu extractor (app/modules/merchant_profiling/menu_extractor.py) against a
fake Innowi Online Ordering API — no network, no database."""
from __future__ import annotations

import asyncio
import json

import httpx
import pytest

from app.modules.merchant_profiling import menu_extractor as mx

LOGO = b"logo-bytes"
STOCK = b"stock-placeholder"
API = mx.API_BASE


def _img(n: int) -> str:
    return f"https://resturant.s3.us-west-2.amazonaws.com/prod/377/deals/{n}.png"


MENU = [
    {"name": "Starters", "deals": [
        {"name": "Garlic Bread", "price": 6.0, "imageName": _img(1)},
        {"name": "Garlic Cheese Bread", "price": "6.75", "imageName": _img(2)},
        {"name": "Garlic Bread", "price": 9.0, "imageName": _img(3)},  # duplicate name, dropped
        {"name": "Soup", "price": 0, "currentPrice": 4.5, "imageName": ""},  # no image
        {"name": "Logo Item", "price": 5, "imageName": _img(99)},  # same bytes as logo
    ]},
    {"name": "Pizza", "deals": [{"name": f"Pizza {i}", "price": 12 + i, "imageName": _img(200 + i)} for i in range(6)]},
    {"name": "Catering Trays", "deals": [{"name": "Party Tray", "price": 80, "imageName": _img(300)}]},
    {"name": "Drinks", "deals": [{"name": "Soda", "price": 2, "imageName": "https://x/no-image.svg"}]},
]


def fake_innowi(calls: list[str], *, login_ok: bool = True, broken_image: int | None = None):
    def handler(req: httpx.Request) -> httpx.Response:
        url = str(req.url)
        calls.append(f"{req.method} {url}")
        if url == f"{API}/session/login":
            body = json.loads(req.content)
            assert body == {"branchId": None, "subUrl": "spotpizza"}
            return httpx.Response(200, json={"success": login_ok, "branchId": 377} if login_ok else {"success": False})
        if url.startswith(f"{API}/merchant/branch/spotpizza"):
            return httpx.Response(200, json={"name": "Spot Pizza", "logoUrl": "https://cdn/logo.png", "websiteBackgroundBanner": None})
        if url.startswith(f"{API}/merchant/377/product_by_group"):
            assert "groupId=-1" in url and "orderType=PICKUP" in url
            return httpx.Response(200, json=MENU)
        if url == "https://cdn/logo.png" or url == _img(99):
            return httpx.Response(200, content=LOGO)
        if url.startswith(_img(200)[:-7]):
            n = int(url.rsplit("/", 1)[1].split(".")[0])
            if n == broken_image:
                return httpx.Response(500)
            if 200 <= n < 210:
                return httpx.Response(200, content=STOCK)  # six pizzas share one stock photo
            return httpx.Response(200, content=f"img-{n}".encode())
        return httpx.Response(404)

    return httpx.MockTransport(handler)


@pytest.mark.parametrize("value,expected", [
    ("https://online-ordering.innowi.com/branch/coffeeheist", "coffeeheist"),
    ("online-ordering.innowi.com/branch/coffeeheist/?utm=1#x", "coffeeheist"),
    ("https://online-ordering.innowi.com/branch/urban_punjab-GG", "urban_punjab-GG"),
    ("  spotpizza  ", "spotpizza"),
])
def test_extract_sub_url(value, expected):
    assert mx.extract_sub_url(value) == expected


@pytest.mark.parametrize("value", ["", "https://www.toasttab.com/branch/x", "https://online-ordering.innowi.com/menu", "Toast, DoorDash"])
def test_extract_sub_url_rejects(value):
    with pytest.raises(mx.MenuExtractionError):
        mx.extract_sub_url(value)


def test_is_innowi_ordering_link():
    assert mx.is_innowi_ordering_link("https://online-ordering.innowi.com/branch/spotpizza")
    assert not mx.is_innowi_ordering_link("Toast, DoorDash")
    assert not mx.is_innowi_ordering_link("https://order.toasttab.com/spot")
    assert not mx.is_innowi_ordering_link(None)


def test_parse_menu_dedupes_prices_and_catering():
    items = mx.parse_menu(MENU)
    names = [i["name"] for i in items]
    assert names.count("Garlic Bread") == 1
    assert items[0]["price"] == 6.0 and items[1]["price"] == 6.75
    soup = next(i for i in items if i["name"] == "Soup")
    assert soup["price"] == 4.5 and soup["image_url"] is None
    assert "Party Tray" in names
    assert "Party Tray" not in [i["name"] for i in mx.parse_menu(MENU, exclude_catering=True)]


def test_extract_menu_end_to_end():
    calls: list[str] = []
    res = asyncio.run(mx.extract_menu("https://online-ordering.innowi.com/branch/spotpizza", transport=fake_innowi(calls)))
    assert res.restaurant_name == "Spot Pizza" and res.branch_id == 377 and res.logo_url == "https://cdn/logo.png"
    by = {i["name"]: i["status"] for i in res.items}
    assert by["Garlic Bread"] == mx.STATUS_VALID
    assert by["Soup"] == mx.STATUS_NO_IMAGE
    assert by["Soda"] == mx.STATUS_NO_IMAGE
    assert by["Logo Item"] == mx.STATUS_LOGO
    assert all(by[f"Pizza {i}"] == mx.STATUS_REPEATED for i in range(6))
    assert res.stats == {"total": 12, "valid": 3, "graphicSkipped": 7, "noImage": 2}
    # no-image placeholders are never downloaded
    assert not any("no-image" in c for c in calls)


def test_failed_image_download_stays_valid():
    res = asyncio.run(mx.extract_menu("spotpizza", transport=fake_innowi([], broken_image=205)))
    by = {i["name"]: i["status"] for i in res.items}
    # 5 pizzas still share the stock image: not over the threshold any more.
    assert by["Pizza 5"] == mx.STATUS_VALID
    assert by["Pizza 0"] == mx.STATUS_VALID


def test_no_filtering_keeps_graphics():
    res = asyncio.run(mx.extract_menu("spotpizza", filter_graphics=False, transport=fake_innowi([])))
    by = {i["name"]: i["status"] for i in res.items}
    assert by["Logo Item"] == mx.STATUS_VALID and by["Pizza 0"] == mx.STATUS_VALID
    assert by["Soup"] == mx.STATUS_NO_IMAGE


def test_unknown_branch_is_a_friendly_error():
    with pytest.raises(mx.MenuExtractionError, match="No Innowi online-ordering branch"):
        asyncio.run(mx.extract_menu("spotpizza", transport=fake_innowi([], login_ok=False)))


def test_unreachable_api_is_a_friendly_error():
    def boom(req):
        raise httpx.ConnectError("down")

    with pytest.raises(mx.MenuExtractionError, match="Couldn't reach"):
        asyncio.run(mx.extract_menu("spotpizza", transport=httpx.MockTransport(boom)))


def test_menu_routes_require_auth():
    from fastapi.testclient import TestClient
    from app.main import app

    c = TestClient(app)
    assert c.get("/api/v1/merchants/x/menu").status_code == 401
    assert c.post("/api/v1/merchants/x/menu/extract", json={}).status_code == 401
    assert c.get("/api/v1/merchants/x/menu/export").status_code == 401


def test_progress_is_reported():
    seen: list[tuple[str, int, int]] = []
    asyncio.run(mx.extract_menu("spotpizza", transport=fake_innowi([]), on_progress=lambda p, d, t: seen.append((p, d, t))))
    phases = [p for p, _, _ in seen]
    assert phases[0] == "connecting" and "menu" in phases and phases[-1] == "done"
    images = [(d, t) for p, d, t in seen if p == "images"]
    assert images[0][0] == 0 and images[-1][0] == images[-1][1] > 0  # counts up to the total


def test_progress_callback_errors_are_ignored():
    def bad(*_):
        raise RuntimeError("ui gone")

    res = asyncio.run(mx.extract_menu("spotpizza", transport=fake_innowi([]), on_progress=bad))
    assert res.stats["total"] == 12


def test_auto_start_ignores_non_innowi_links():
    from app.modules.merchant_profiling import menu_jobs

    assert asyncio.run(menu_jobs.start_if_innowi_link("m1", "Toast, DoorDash")) is False
    assert asyncio.run(menu_jobs.start_if_innowi_link("m1", None)) is False
