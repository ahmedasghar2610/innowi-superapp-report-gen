"""Quote builder pricing engine + price sheet (pure, no database)."""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal as D
from typing import Optional

import pytest

from app.modules.quotes import pricing
from app.modules.quotes.price_sheet import FIRST_STATION_SKU, PRICE_SHEET
from app.modules.quotes.pricing import BUY, LEASE, Override, PricingError, price_quote, resolve_item


@dataclass
class Row:
    """Stand-in for a price_item row."""

    id: str
    sku: str
    name: str
    section: str
    kind: str
    monthly_price: Optional[D] = None
    purchase_price: Optional[D] = None
    lease_price: Optional[D] = None
    is_station: bool = False
    selectable: bool = True
    max_qty: int = 20
    sort_order: int = 0
    description: Optional[str] = None
    note: Optional[str] = None
    unit_label: Optional[str] = None


def sheet_rows() -> list[Row]:
    rows = []
    for i, it in enumerate(PRICE_SHEET):
        rows.append(Row(id=it["sku"], sku=it["sku"], name=it["name"], section=it["section"], kind=it["kind"],
                        monthly_price=it.get("monthly_price"), purchase_price=it.get("purchase_price"),
                        lease_price=it.get("lease_price"), is_station=it.get("is_station", False),
                        selectable=it.get("selectable", True), max_qty=it.get("max_qty", 20), sort_order=i * 10,
                        description=it.get("description"), note=it.get("note"), unit_label=it.get("unit_label")))
    return rows


def offer(overrides: dict[str, Override] | None = None, discount: D = D("0")):
    overrides = overrides or {}
    items = {r.id: resolve_item(r, overrides.get(r.id), discount) for r in sheet_rows()}
    first = items.pop(FIRST_STATION_SKU)
    return {k: v for k, v in items.items() if v.selectable}, first


def q(selections: dict[str, int], plan: str = BUY, overrides=None, discount=D("0")):
    items, first = offer(overrides, discount)
    return price_quote(items, list(selections.items()), plan, first)


def by_sku(quote, sku):
    return [line for line in quote.lines if line.sku == sku]


# ── the price sheet itself ────────────────────────────────────────────────
def test_sheet_skus_unique_and_priceable():
    skus = [it["sku"] for it in PRICE_SHEET]
    assert len(skus) == len(set(skus))
    need = {"DEVICE": ("purchase_price", "monthly_price"), "HARDWARE": ("purchase_price",),
            "SOFTWARE": ("monthly_price",), "SERVICE": ("purchase_price",)}
    for it in PRICE_SHEET:
        for f in need[it["kind"]]:
            assert it.get(f) is not None, (it["sku"], f)


def test_sheet_matches_published_prices():
    """Spot-check the transcription against the PDF."""
    s = {it["sku"]: it for it in PRICE_SHEET}
    assert s[FIRST_STATION_SKU]["monthly_price"] == D("99.00")
    assert (s["DEV-POS"]["purchase_price"], s["DEV-POS"]["lease_price"], s["DEV-POS"]["monthly_price"]) == (D("873"), D("33.95"), D("24.95"))
    assert (s["DEV-HANDHELD"]["purchase_price"], s["DEV-HANDHELD"]["lease_price"]) == (D("428"), D("16.95"))
    assert s["DEV-KIOSK"]["monthly_price"] == D("49.95") and s["DEV-KDS-24"]["purchase_price"] == D("666")
    assert s["NET-PC63C4"]["purchase_price"] == D("349") and s["NET-PC64C4"]["purchase_price"] == D("399")
    assert s["NET-CAT6-6"]["lease_price"] is None
    assert s["MKT-PACKAGE"]["monthly_price"] == D("249.00")
    assert (s["SVC-DEPLOY"]["purchase_price"], s["SVC-MENU"]["purchase_price"], s["SVC-WEBSITE"]["purchase_price"]) == (D("750"), D("250"), D("1000"))
    assert len(PRICE_SHEET) == 32


# ── station rule ──────────────────────────────────────────────────────────
def test_one_pos_station_is_99():
    quote = q({"DEV-POS": 1})
    assert quote.monthly_software_total == D("99.00")
    assert quote.one_time_total == D("873.00")


def test_two_pos_stations_99_plus_2495():
    quote = q({"DEV-POS": 2})
    assert quote.monthly_software_total == D("123.95")
    assert by_sku(quote, FIRST_STATION_SKU)[0].qty == 1
    assert by_sku(quote, "DEV-POS-SW")[0].qty == 1


def test_handheld_alone_is_99():
    assert q({"DEV-HANDHELD": 1}).monthly_software_total == D("99.00")


def test_pos_plus_handhelds():
    quote = q({"DEV-POS": 1, "DEV-HANDHELD": 2})
    assert quote.monthly_software_total == D("148.90")  # 99 + 2 x 24.95
    assert not by_sku(quote, "DEV-POS-SW")  # the only POS took the first-station price


def test_kds_and_kiosk_are_not_stations():
    quote = q({"DEV-KDS-15": 2, "DEV-KIOSK": 1})
    assert quote.monthly_software_total == D("89.85")  # 2 x 19.95 + 49.95, no first-station line
    assert not by_sku(quote, FIRST_STATION_SKU)


def test_typical_restaurant_buy():
    quote = q({"DEV-POS": 2, "DEV-HANDHELD": 3, "DEV-KDS-15": 2, "HW-RECEIPT-PRINTER": 1,
               "SW-ORDERHUB": 1, "SVC-DEPLOY": 1})
    # software: 99 + 1x24.95 + 3x24.95 + 2x19.95 + 49.95
    assert quote.monthly_software_total == D("288.65")
    # one-time: 2x873 + 3x428 + 2x558 + 355 + 750
    assert quote.one_time_total == D("5251.00")
    assert quote.monthly_lease_total == D("0.00")


def test_lease_moves_hardware_to_monthly_but_not_services_or_cables():
    quote = q({"DEV-POS": 1, "NET-CAT6-6": 4, "SVC-MENU": 1}, plan=LEASE)
    assert quote.monthly_lease_total == D("33.95")
    assert quote.one_time_total == D("262.00")  # cables (no lease price) 4x3 + menu 250
    assert quote.monthly_total == D("132.95")


# ── special pricing ───────────────────────────────────────────────────────
def test_link_discount_applies_everywhere():
    quote = q({"DEV-POS": 1, "SVC-WEBSITE": 1}, discount=D("10"))
    assert quote.one_time_total == D("1685.70")  # (873 + 1000) x 0.9
    assert quote.monthly_software_total == D("89.10")
    assert quote.list_one_time_total == D("1873.00")


def test_set_price_beats_percent_beats_link_discount():
    ov = {"SVC-DEPLOY": Override(purchase_price=D("0")), "SVC-MENU": Override(percent_off=D("50"))}
    quote = q({"SVC-DEPLOY": 1, "SVC-MENU": 1, "SVC-WEBSITE": 1}, overrides=ov, discount=D("25"))
    assert by_sku(quote, "SVC-DEPLOY")[0].unit_price == D("0.00")
    assert by_sku(quote, "SVC-MENU")[0].unit_price == D("125.00")
    assert by_sku(quote, "SVC-WEBSITE")[0].unit_price == D("750.00")


def test_first_station_price_can_be_special():
    quote = q({"DEV-POS": 1}, overrides={FIRST_STATION_SKU: Override(monthly_price=D("79"))})
    assert quote.monthly_software_total == D("79.00")


def test_rounding_to_cents():
    quote = q({"SW-PHONE-LINK": 1}, discount=D("33.33"))
    assert by_sku(quote, "SW-PHONE-LINK")[0].unit_price == D("9.97")  # 14.95 x 0.6667 = 9.967


# ── validation ────────────────────────────────────────────────────────────
@pytest.mark.parametrize("sel,msg", [
    ({"DEV-POS": 21}, "at most"),
    ({"DEV-POS": -1}, "0 or more"),
    ({"NOPE": 1}, "isn't available"),
    ({FIRST_STATION_SKU: 1}, "isn't available"),
    ({"DEV-POS": 0}, "at least one"),
])
def test_rejects_bad_selections(sel, msg):
    with pytest.raises(PricingError, match=msg):
        q(sel)


def test_rejects_bad_plan():
    with pytest.raises(PricingError):
        q({"DEV-POS": 1}, plan="RENT")


def test_lines_serialise_as_strings():
    d = q({"DEV-POS": 1}).lines[0].as_dict()
    assert isinstance(d["unitPrice"], str) and d["unitPrice"] == "873.00"


def test_money_helper():
    assert pricing.money("1.005") == D("1.01")


def test_notifications_send_a_named_user_agent(monkeypatch):
    """Resend blocks Python's default User-Agent (403, error 1010), so every outgoing call must name itself."""
    import urllib.request
    from app.modules.quotes import notify

    seen = {}

    class _Res:
        status = 200

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    def fake_urlopen(req, timeout=None):
        seen["ua"] = req.get_header("User-agent")
        seen["auth"] = req.get_header("Authorization")
        return _Res()

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    assert notify._post_json("https://api.resend.com/emails", {"x": 1}, {"Authorization": "Bearer k"}) == 200
    assert seen["ua"] and not seen["ua"].startswith("Python-urllib")
    assert seen["auth"] == "Bearer k"
