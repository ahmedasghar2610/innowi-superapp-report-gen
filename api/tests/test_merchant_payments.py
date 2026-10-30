"""Merchants → Payments: the paid-marketing revenue report ("Revenue Sheet Sept. 2026")
read, matched to merchants by name, written per month, and read back with checks
against the merchant's Profile.

Pure parts always run; the DB part needs OPS_TEST_DATABASE_URL (see test_ops_tickets_db.py).
"""
from __future__ import annotations

import datetime as dt
import io
import json
import os
import uuid

import pytest

from app.modules.merchant_profiling import payments_import as pay

TAG = uuid.uuid4().hex[:5]
HEAD = ["Accounts Sept. 2026", "Status ", "Package Type", "Contract ($)", "Payments (Recurring)/ \nCharged ($)", "Variance",
        "Online Orders \nRevenue", "Comission-base charge", "Notes"]


def _book(rows: list[list], sheet: str = "Revenue Sheet Sept. 2026") -> bytes:
    import openpyxl

    wb = openpyxl.Workbook()
    wb.active.title = "Churned Accounts of August "
    wb.active.append(["Reastaurant Name", "Start Date", "End Date", "Package Price", "Reason for Churn"])
    ws = wb.create_sheet(sheet)
    ws.append(HEAD)
    for r in rows:
        ws.append(r)
    ws.append([None, len(rows), None, 999, 999, 0, None, None, None])  # totals row
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def test_read_report_and_values():
    data = _book([["Coffee heist (Doii Café)", "Paused", "Paid", 199, 199, "-", "\n$1,274.66", None, None],
                  ["Gaters", "Active", "Paid", 299, 0, 299, 1215.44, None, "Payments team asked not to charge"]])
    sheets = pay.read_report(data, "Paid Mkt. Accounts - 2026.xlsx")
    assert [s.name for s in sheets] == ["Revenue Sheet Sept. 2026"]
    rs = pay.pick_sheet(sheets, None)
    assert rs.month == dt.date(2026, 9, 1) and len(rs.rows) == 2  # the totals row is skipped
    v = pay._values(rs.rows[0][1])
    assert v["orders_revenue"] == 1274.66 and v["variance"] == 0 and v["status"] == "Paused"
    assert pay._values(rs.rows[1][1])["variance"] == 299
    assert pay.month_of("Mkt. Revenue Sheet August 2026 ") == dt.date(2026, 8, 1)
    assert pay.money("\n\t$3,357.96") == 3357.96 and pay.money("-") is None


def test_name_matching():
    from app.models.profiling import Merchant

    ms = []
    for i, n in enumerate(["Cairo Grill", "Fatima Bazaar & Grill", "De Los Altos Grill", "De Los Altos Grill (Food Truck)",
                           "Blossom Chai Cafe", "Koftegi Turkish Grill & Bakery", "Coffee Heist"]):
        m = Merchant(restaurant_name=n)
        m.id = f"m{i}"
        ms.append(m)
    pick = lambda a: pay._pick(pay.match(a, ms))  # noqa: E731
    assert pick("Cairo Grill (Fatima Bazaar)") == ("m0", True)
    assert pick("De Los Altos Grill") == ("m2", True)
    assert pick("De Los Altos Grill (Food Truck)") == ("m3", True)
    assert pick("Blossom Chai café") == ("m4", True)
    assert pick("Coffee heist (Doii Café)") == ("m6", True)
    assert pick("Al Sanabel bakery (Koftegi)") == ("m5", False)  # suggested, the person confirms
    assert pick("Nobody At All") == (None, False)


def test_checks_against_profile():
    month = {"contract": 249.0, "charged": 0.0, "status": "Paused", "ordersRevenue": 0.0}
    cs = pay.checks(month, {"mrr": 199.0, "merchantStatus": "ACTIVE"}, None)
    assert [c["title"] for c in cs] == ["Not charged", "Contract differs from the Profile", "Status differs", "No online-order revenue"]
    ok = pay.checks({"contract": 199.0, "charged": 199.0, "status": "Active", "ordersRevenue": 500.0}, {"mrr": 199.0, "merchantStatus": "ACTIVE"},
                    {"ordersRevenue": 1000.0})
    assert [c["title"] for c in ok] == ["Online orders dropped"]


@pytest.mark.skipif(not os.getenv("OPS_TEST_DATABASE_URL"), reason="needs OPS_TEST_DATABASE_URL")
def test_import_endpoint_and_merchant_view():
    from fastapi.testclient import TestClient

    from app.common.security.jwt import create_access_token
    from app.db.session import engine
    from app.main import app
    from tests.test_ops_tickets_db import _seed

    seeded = _seed()
    engine.sync_engine.dispose(close=False)

    def h(who):
        uid, email, role = seeded[who]
        token, _ = create_access_token({"sub": uid, "email": email, "role": role})
        return {"Authorization": f"Bearer {token}"}

    with TestClient(app) as client:
        a = client.post("/api/v1/merchants", headers=h("admin"), json={"restaurantName": f"Zephyr Kabab {TAG}"}).json()["id"]
        b = client.post("/api/v1/merchants", headers=h("admin"), json={"restaurantName": f"Quillon Noodle Bar {TAG}"}).json()["id"]
        data = _book([[f"ZEPHYR KABAB {TAG}", "Active", "Paid", 199, 150, "-", "\n$2,000.00", None, "Partial month"],
                      [f"Quillon Noodle {TAG}", "Paused", "Paid", 99, 99, "-", 0, None, None],
                      ["Somebody Else Entirely", "Active", "Paid", 50, 50, "-", 10, None, None]])
        files = {"file": ("Paid Mkt. Accounts - 2026.xlsx", data, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
        assert client.post("/api/v1/merchant-payments/import?dryRun=true", files=files, headers=h("sofia")).status_code == 403
        pre = client.post("/api/v1/merchant-payments/import?dryRun=true", files=files, headers=h("admin")).json()
        assert pre["sheet"] == "Revenue Sheet Sept. 2026" and pre["month"] == "2026-09-01"
        rows = {r["account"]: r for r in pre["rows"]}
        assert rows[f"ZEPHYR KABAB {TAG}"]["merchantId"] == a and rows[f"ZEPHYR KABAB {TAG}"]["sure"]
        noodle = rows[f"Quillon Noodle {TAG}"]
        assert noodle["suggested"] == b
        assert rows["Somebody Else Entirely"]["merchantId"] is None
        r = client.post("/api/v1/merchant-payments/import", files=files, headers=h("admin"),
                        data={"choices": json.dumps({noodle["key"]: "skip"})}).json()
        assert r["applied"]["written"] == 1
        got = client.get(f"/api/v1/merchants/{a}/payments", headers=h("admin")).json()
        last = got["latest"]
        assert last["month"] == "2026-09-01" and last["charged"] == 150 and last["variance"] == 49 and last["returnMultiple"] == 13.3
        assert "Charged less than the contract" in [c["title"] for c in last["checks"]]
        assert client.get(f"/api/v1/merchants/{b}/payments", headers=h("admin")).json()["latest"] is None  # skipped
        # Re-importing the month replaces it, never duplicates.
        client.post("/api/v1/merchant-payments/import", files=files, headers=h("admin"), data={"month": "2026-09"})
        again = client.get(f"/api/v1/merchants/{a}/payments", headers=h("admin")).json()
        assert len(again["months"]) == 1

        # By hand: add October, can't add September twice, edit, delete.
        assert client.post(f"/api/v1/merchants/{a}/payments", headers=h("sofia"), json={"month": "2026-10"}).status_code == 403
        r = client.post(f"/api/v1/merchants/{a}/payments", headers=h("admin"),
                        json={"month": "2026-10", "status": "Active", "contract": 199, "charged": 199, "ordersRevenue": 2500})
        assert r.status_code == 201, r.text
        oct_ = r.json()
        assert oct_["variance"] == 0 and oct_["account"] == f"Zephyr Kabab {TAG}" and oct_["sourceFile"] == "Added by hand"
        assert client.post(f"/api/v1/merchants/{a}/payments", headers=h("admin"), json={"month": "2026-09"}).status_code == 409
        r = client.patch(f"/api/v1/merchant-payments/{oct_['id']}", headers=h("admin"), json={"charged": 99, "notes": "Half month"})
        assert r.json()["variance"] == 100 and r.json()["notes"] == "Half month"
        assert client.patch(f"/api/v1/merchant-payments/{oct_['id']}", headers=h("admin"), json={"month": "2026-09"}).status_code == 409
        view = client.get(f"/api/v1/merchants/{a}/payments", headers=h("admin")).json()
        assert [m["month"] for m in view["months"]] == ["2026-10-01", "2026-09-01"] and view["latest"]["ordersRevenueChange"] == 0.25
        assert client.delete(f"/api/v1/merchant-payments/{oct_['id']}", headers=h("admin")).status_code == 204
        assert len(client.get(f"/api/v1/merchants/{a}/payments", headers=h("admin")).json()["months"]) == 1
    engine.sync_engine.dispose(close=False)
