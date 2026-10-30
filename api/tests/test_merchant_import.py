"""Merchants → Import from XLS / CSV (merchant_import.py), the Innowi links read
out of the Online ordering text, and the menus-across-merchants endpoints.

Pure parts always run; the DB parts need OPS_TEST_DATABASE_URL (see test_ops_tickets_db.py).
"""
from __future__ import annotations

import asyncio
import csv
import io
import json
import os
import uuid

import pytest

from app.modules.merchant_profiling import menu_extractor as mx
from app.modules.merchant_profiling import menu_jobs
from app.modules.merchant_profiling import merchant_import as mi

TAG = uuid.uuid4().hex[:5].upper()
HEADER = ["Merchant ID", "Restaurant Name (DBA)", "Legal Name", "Package", "Package Status", "Start Date", "MRR", "Account Manager",
          "Cuisine / Category", "Address", "City", "State", "ZIP", "Multi-Location?", "# of Locations", "Owner Name", "Owner Email",
          "Owner Phone", "Preferred Channel", "Online Ordering", "Catering Offered?", "Catering Contact", "Primary Keywords",
          "Competitor 1", "Competitor 2", "Alcohol License?", "Account Health", "Onboarding Date", "Tone of Voice"]


def csv_bytes(rows: list[list[str]]) -> bytes:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(HEADER)
    for r in rows:
        w.writerow(r)
    w.writerow([""] * len(HEADER))  # blank lines are skipped
    return buf.getvalue().encode("utf-8-sig")


def row(code: str, name: str, **kw) -> list[str]:
    base = {"Merchant ID": code, "Restaurant Name (DBA)": name, "Legal Name": "CONFIRM - not published", "Package": "$199",
            "Package Status": "Active", "Start Date": "CONFIRM", "MRR": "$199", "Account Manager": "Bashkim ",
            "Cuisine / Category": "Mediterranean", "Address": "41986 Fremont Blvd", "City": "Fremont", "State": "CA", "ZIP": "94538",
            "Multi-Location?": "No", "# of Locations": "1", "Owner Name": "Milad", "Owner Email": "owner@example.com",
            "Owner Phone": "(510) 270-8337", "Preferred Channel": "Phone - no email published",
            "Online Ordering": "Innowi direct (online-ordering.innowi.com/branch/kfusionbst) + DoorDash + Grubhub",
            "Catering Offered?": "Yes", "Catering Contact": "+1 (510) 270-8337 (phone only)",
            "Primary Keywords": "halal food fremont; kabob near me", "Competitor 1": "Kabul House", "Competitor 2": "CONFIRM",
            "Alcohol License?": "No (Halal)", "Account Health": "Red", "Onboarding Date": "2026-08-24", "Tone of Voice": "Warm, family"}
    base.update({k.replace("_", " "): v for k, v in kw.items()})
    return [base.get(h, "") for h in HEADER]


# ============================================================ pure ====


def test_find_innowi_links_in_prose():
    assert mx.find_innowi_links("Innowi direct (online-ordering.innowi.com/branch/kfusionbst) + DoorDash + Grubhub") == ["kfusionbst"]
    assert mx.find_innowi_links("two branches: online-ordering.innowi.com/branch/medgrill (main) and /branch/Medgrillcatering (catering)") == [
        "medgrill", "Medgrillcatering"]
    # a bare /branch/x with no Innowi link beside it isn't guessed
    assert mx.find_innowi_links("Innowi direct - BUT the branch slug is /branch/thaichickenrice") == []
    assert mx.find_innowi_links("Smile Dining (siamthai.smiledining.com)") == []
    assert mx.find_innowi_links("https://online-ordering.innowi.com/branch/a and https://online-ordering.innowi.com/branch/A") == ["a"]


def test_usable_and_resolved_link():
    assert mx.usable_link("https://online-ordering.innowi.com/branch/coffeeheist?x=1") == "https://online-ordering.innowi.com/branch/coffeeheist"
    assert mx.usable_link("Innowi direct (online-ordering.innowi.com/branch/kfusionbst) + DoorDash") == "https://online-ordering.innowi.com/branch/kfusionbst"
    assert mx.usable_link("online-ordering.innowi.com/branch/a, online-ordering.innowi.com/branch/b") is None  # two: pick one
    assert mx.usable_link("Toast, DoorDash") is None
    two = "online-ordering.innowi.com/branch/medgrill (main) and /branch/Medgrillcatering"
    link, found = menu_jobs.resolve_link(two)
    assert link is None and len(found) == 2
    picked = "https://online-ordering.innowi.com/branch/Medgrillcatering"
    assert menu_jobs.resolve_link(two, picked) == (picked, found)
    assert menu_jobs.resolve_link(two, "https://online-ordering.innowi.com/branch/other")[0] is None  # a stale pick isn't used
    assert menu_jobs.resolve_link("Toast", "https://online-ordering.innowi.com/branch/x")[0] == "https://online-ordering.innowi.com/branch/x"


def test_read_csv_and_unknown_columns():
    sheet = mi.read_file(csv_bytes([row("M-1", "A"), row("", "Example Restaurant")]), "m.csv")
    assert [n for n, _ in sheet.rows] == [2, 3] and sheet.unknown_columns == ["Multi-Location?"]
    with pytest.raises(mi.ImportError_):
        mi.read_file(b"foo,bar\n1,2\n", "x.csv")


def test_read_xlsx_finds_the_merchants_sheet():
    import openpyxl

    wb = openpyxl.Workbook()
    wb.active.title = "Read Me"
    wb.active.append(["How to use this workbook"])
    ws = wb.create_sheet("Merchants")
    ws.append(["Merchant Profile System"])  # a title row above the header
    ws.append(HEADER)
    ws.append(row("M-1", "Kabob Fusion"))
    buf = io.BytesIO()
    wb.save(buf)
    sheet = mi.read_file(buf.getvalue(), "Merchant_Profile_System.xlsx")
    assert sheet.sheet == "Merchants" and len(sheet.rows) == 1 and sheet.rows[0][1]["Restaurant Name (DBA)"] == "Kabob Fusion"


def test_value_parsers():
    assert mi.s("CONFIRM") is None and mi.s(" n/a ") is None and mi.s("CONFIRM - check W-9") == "CONFIRM - check W-9"
    assert mi.channel_of("Phone - no email published").value == "PHONE"
    assert mi.channel_of("Phone / text - no email published").value == "SMS"  # text = SMS
    assert mi.yes_no("No (Halal)").value == "NO" and mi.yes_no("LIKELY YES - beer") is None
    assert mi.num("$249") == 249.0 and mi.as_date("2026-08-24").date().isoformat() == "2026-08-24"
    assert mi.split_list("a; b;CONFIRM; A") == ["a", "b"]
    assert mi.same("Fremont ", "fremont") and not mi.same("Fremont", "Walnut")


# ============================================================== DB ====

db_only = pytest.mark.skipif(not os.getenv("OPS_TEST_DATABASE_URL"), reason="needs OPS_TEST_DATABASE_URL")


def _go(fn):
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from app.config import to_asyncpg_url

    async def wrapper():
        eng = create_async_engine(to_asyncpg_url(os.environ["OPS_TEST_DATABASE_URL"]))
        S = async_sessionmaker(eng, expire_on_commit=False, autoflush=False)
        try:
            async with S() as db:
                from sqlalchemy import select

                from app.models.catalog import Package

                if not (await db.execute(select(Package).where(Package.code == "$199"))).scalar_one_or_none():
                    db.add(Package(code="$199", name="Growth", price=199))
                    await db.commit()
                return await fn(db)
        finally:
            await eng.dispose()

    return asyncio.run(wrapper())


@db_only
def test_import_create_then_keep_existing_and_show_conflicts():
    from sqlalchemy import select

    from app.models.profiling import BrandProfile, Competitor, Contact, Keyword, Location, Merchant, Subscription

    a, b = f"T{TAG}-1", f"T{TAG}-2"
    first = mi.read_file(csv_bytes([row(a, f"Olive {TAG}"), row(b, f"Kabob {TAG}", Online_Ordering="Toast + DoorDash")]), "m.csv")

    async def step1(db):
        p = await mi.plan(db, first)
        assert p["totals"]["create"] == 2 and p["totals"]["conflicts"] == 0
        ra = next(r for r in p["rows"] if r["key"] == a)
        assert ra["menu"] == {"status": "ready", "links": ["https://online-ordering.innowi.com/branch/kfusionbst"]}
        assert next(r for r in p["rows"] if r["key"] == b)["menu"]["status"] == "none"
        assert any("CONFIRM notes in: Legal Name" in w for w in ra["warnings"])
        res = await mi.apply(db, first, set(), set())
        await db.commit()
        assert res["applied"]["created"] == 2
        m = (await db.execute(select(Merchant).where(Merchant.merchant_code == a))).scalar_one()
        assert m.online_ordering.startswith("Innowi direct (online-ordering")  # whole text kept
        assert m.legal_name == "CONFIRM - not published"
        sub = (await db.execute(select(Subscription).where(Subscription.merchant_id == m.id))).scalar_one()
        assert sub.package_code == "$199" and float(sub.mrr) == 199.0 and sub.start_date is None
        owner = (await db.execute(select(Contact).where(Contact.merchant_id == m.id, Contact.role == "OWNER"))).scalar_one()
        assert (owner.name, owner.email, owner.preferred_channel.value) == ("Milad", "owner@example.com", "PHONE")
        kws = sorted(k.term for k in (await db.execute(select(Keyword).where(Keyword.merchant_id == m.id))).scalars())
        assert kws == ["halal food fremont", "kabob near me"]
        comps = [(c.name, c.rank) for c in (await db.execute(select(Competitor).where(Competitor.merchant_id == m.id))).scalars()]
        assert comps == [("Kabul House", 1)]
        # the team edits the merchant in the Super App
        m.legal_name = "Kabob Fusion LLC"
        brand = await db.get(BrandProfile, m.id)
        assert brand.tone_of_voice == "Warm, family"
        brand.tone_of_voice = "Warm, family, halal-forward"
        loc = (await db.execute(select(Location).where(Location.merchant_id == m.id))).scalar_one()
        loc.city = "Fremont CA"
        await db.commit()
        return m.id

    mid = _go(step1)

    # same file again, plus a new keyword, a changed owner email and an empty tone in the sheet
    second = mi.read_file(csv_bytes([
        row(a, f"Olive {TAG}", Owner_Email="milad@olive.com", Primary_Keywords="halal food fremont; kabob near me; zabiha fremont",
            Tone_of_Voice=""),
        row(b, f"Kabob {TAG}", Online_Ordering="Toast + DoorDash"),
    ]), "m.csv")

    async def step2(db):
        p = await mi.plan(db, second)
        ra = next(r for r in p["rows"] if r["key"] == a)
        conf = {f["key"]: (f["current"], f["incoming"]) for f in ra["fields"] if f["status"] == "conflict"}
        assert conf == {
            "merchant.legal_name": ("Kabob Fusion LLC", "CONFIRM - not published"),
            "location.city": ("Fremont CA", "Fremont"),
            "contact:OWNER.email": ("owner@example.com", "milad@olive.com"),
        }
        assert ra["adds"] == [{"key": "keyword.PRIMARY", "label": "Primary Keywords", "value": "zabiha fremont"}]
        assert next(r for r in p["rows"] if r["key"] == b)["action"] == "unchanged"
        # apply: take the sheet's owner email only; keep the team's legal name and city
        res = await mi.apply(db, second, {f"{a}::contact:OWNER.email"}, set())
        await db.commit()
        assert res["applied"]["conflictsReplaced"] == 1 and res["applied"]["conflictsKept"] == 2 and res["applied"]["added"] == 1
        m = await db.get(Merchant, mid)
        await db.refresh(m)
        assert m.legal_name == "Kabob Fusion LLC"  # kept
        brand = await db.get(BrandProfile, mid)
        await db.refresh(brand)
        assert brand.tone_of_voice == "Warm, family, halal-forward"  # an empty sheet cell never blanks a value
        owner = (await db.execute(select(Contact).where(Contact.merchant_id == mid, Contact.role == "OWNER"))).scalar_one()
        assert owner.email == "milad@olive.com"
        loc = (await db.execute(select(Location).where(Location.merchant_id == mid))).scalar_one()
        assert loc.city == "Fremont CA"
        assert len((await db.execute(select(Keyword).where(Keyword.merchant_id == mid))).scalars().all()) == 3
        # "use sheet for all" on that merchant
        await mi.apply(db, second, set(), {a})
        await db.commit()
        await db.refresh(m)
        assert m.legal_name == "CONFIRM - not published"

    _go(step2)


@db_only
def test_ambiguous_name_and_duplicate_rows_are_skipped():
    from app.models.profiling import Merchant

    name = f"Twin {TAG}"

    async def go(db):
        db.add_all([Merchant(restaurant_name=name), Merchant(restaurant_name=name)])
        await db.commit()
        sheet = mi.read_file(csv_bytes([row("", name), row(f"D{TAG}", f"Dup {TAG}"), row(f"D{TAG}", f"Dup {TAG}")]), "m.csv")
        p = await mi.plan(db, sheet)
        reasons = [r["reason"] for r in p["rows"]]
        assert "2 merchants are called" in (reasons[0] or "")
        assert p["rows"][1]["action"] == "create" and "Same merchant as row 3" in (reasons[2] or "")

    _go(go)


@db_only
def test_import_endpoint_and_menu_status(monkeypatch):
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

    two = "Innowi direct, two branches: online-ordering.innowi.com/branch/medgrill (main) and /branch/Medgrillcatering (catering)."
    data = csv_bytes([row(f"E{TAG}-1", f"Endpoint {TAG}"), row(f"E{TAG}-2", f"Grill {TAG}", Online_Ordering=two)])
    files = {"file": ("merchants.csv", data, "text/csv")}
    with TestClient(app) as client:
        r = client.post("/api/v1/merchants/import?dryRun=true", files=files, headers=h("aima"))
        assert r.status_code == 200, r.text
        assert r.json()["totals"]["create"] == 2 and r.json()["unknownColumns"] == ["Multi-Location?"]
        r = client.post("/api/v1/merchants/import", files={"file": ("x.csv", b"a,b\n1,2", "text/csv")}, headers=h("aima"))
        assert r.status_code == 400
        r = client.post("/api/v1/merchants/import", files=files, data={"decisions": json.dumps({"useSheet": []})}, headers=h("aima"))
        assert r.status_code == 200 and r.json()["applied"]["created"] == 2
        ids = r.json()["applied"]["merchantIds"]
        made = client.get(f"/api/v1/merchants/{ids[0]}", headers=h("aima")).json()
        assert made["source"] == "MERCHANT_IMPORT" and made["sourceDetail"] == "merchants.csv"

        st = client.get(f"/api/v1/merchant-menus?ids={','.join(ids)}", headers=h("aima")).json()
        by = {x["merchantCode"]: x for x in st["data"]}
        assert by[f"E{TAG}-1"]["status"] == "ready" and by[f"E{TAG}-1"]["link"].endswith("/branch/kfusionbst")
        assert by[f"E{TAG}-2"]["status"] == "pick" and len(by[f"E{TAG}-2"]["links"]) == 2

        # fetch: the "pick" one is skipped with a reason; the ready one is queued
        queued = []

        async def fake_queue(items, user_email=None):
            queued.extend(items)
            return {"started": [m for m, _ in items], "skipped": {}, "remaining": []}

        monkeypatch.setattr(menu_jobs, "start_queue", fake_queue)
        r = client.post("/api/v1/merchant-menus/fetch", json={"merchantIds": ids}, headers=h("aima")).json()
        assert [m for m, _ in queued] == [by[f"E{TAG}-1"]["merchantId"]]
        assert "pick one" in r["skipped"][by[f"E{TAG}-2"]["merchantId"]]

        # pick the catering branch → ready with that link; the Online ordering text is untouched
        gid = by[f"E{TAG}-2"]["merchantId"]
        r = client.put(f"/api/v1/merchant-menus/{gid}/link", json={"link": "online-ordering.innowi.com/branch/Medgrillcatering"}, headers=h("aima"))
        assert r.status_code == 200 and r.json()["status"] == "ready" and r.json()["link"].endswith("/Medgrillcatering")
        assert client.get(f"/api/v1/merchants/{gid}", headers=h("aima")).json()["onlineOrdering"] == two

        # quick check (Innowi mocked)
        async def fake_check(link, transport=None):
            if "kfusionbst" in link:
                return 101
            raise mx.MenuExtractionError("No Innowi online-ordering branch called 'x' was found. Check the link.")

        monkeypatch.setattr(mx, "check_branch", fake_check)
        chk = client.post("/api/v1/merchant-menus/check", json={"merchantIds": ids}, headers=h("aima")).json()["data"]
        res = {x["merchantCode"]: x["check"] for x in chk}
        assert res == {f"E{TAG}-1": "ok", f"E{TAG}-2": "failed"}

        # only admins can delete a merchant
        assert client.delete(f"/api/v1/merchants/{gid}", headers=h("sofia")).status_code == 403
        assert client.delete(f"/api/v1/merchants/{gid}", headers=h("aima")).status_code == 403  # a marketing manager can't either
        assert client.delete(f"/api/v1/merchants/{gid}", headers=h("admin")).status_code == 204
        assert client.get(f"/api/v1/merchants/{gid}", headers=h("admin")).status_code == 404
    engine.sync_engine.dispose(close=False)


# ======================================================= promotions ====

PROMO_HEADER = ["Merchant ID", "Restaurant Name (DBA)", "Promo Name", "Offer Type", "Offer Value", "Promo Code", "Channels",
                "Start Date", "End Date", "Status", "Staff Briefed?", "Fine print", "Budget"]


def _workbook(merchants: list[list[str]], promos: list[list]) -> bytes:
    import openpyxl

    wb = openpyxl.Workbook()
    wb.active.title = "Merchants"
    wb.active.append(HEADER)
    for r in merchants:
        wb.active.append(r)
    ws = wb.create_sheet("Promotions")
    ws.append(["Promotions tracker"])
    ws.append(PROMO_HEADER)
    for r in promos:
        ws.append(r)
    ws.append([None] * len(PROMO_HEADER))
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def test_read_promotions_sheet():
    from app.modules.merchant_profiling import promotions_import as pi

    data = _workbook([row("M-1", "Kabob Fusion")], [["M-1", "Kabob Fusion", "Lunch Combo", "% off", "15%", "LUNCH15", "Website, Google Ads",
                                                     "2026-10-01", "2026-10-31", "Live", "Yes", "Mon–Fri only", "$200"]])
    ps = pi.read_promotions(data, "book.xlsx")
    assert ps and ps.sheet == "Promotions" and len(ps.rows) == 1
    n, rec, extra = ps.rows[0]
    assert rec["promo_name"] == "Lunch Combo" and rec["code"] == "M-1" and extra == {"Budget": "$200"}
    v = pi._values(rec, extra)
    assert v["status"].value == "ACTIVE" and v["start_date"].day == 1 and v["notes"] == "Mon–Fri only\nBudget: $200"
    # the Merchants sheet reader never picks up the Promotions sheet
    assert mi.read_file(data, "book.xlsx").sheet == "Merchants"
    # a CSV that is only promotions
    buf = io.StringIO()
    csv.writer(buf).writerows([PROMO_HEADER, ["M-1", "", "BOGO", "BOGO", "Buy one get one", "", "", "", "", "", "", "", ""]])
    ps = pi.read_promotions(buf.getvalue().encode(), "promos.csv")
    assert ps and ps.whole_file and ps.rows[0][1]["promo_name"] == "BOGO"
    assert pi.read_promotions(csv_bytes([row("M-1", "A")]), "m.csv") is None
    # the Merchant Profile System workbook's own layout (scripts/import_xlsx.py): "Merchant" = restaurant name, header on row 1
    import openpyxl

    wb = openpyxl.Workbook()
    wb.active.title = "Merchants"
    wb.active.append(HEADER)
    for name in ("Access", "Promotions", "Opportunities"):
        ws = wb.create_sheet(name)
        if name == "Promotions":
            ws.append(["Merchant", "Promo Name", "Offer Type", "Offer Value", "Promo Code", "Channels", "Start Date", "End Date", "Status",
                       "Redemptions", "Redemption Method", "Approval Owner", "Staff Briefed?", "Blackout Dates", "Notes"])
            ws.append(["Kabob Fusion", "Grand Opening", "% Off", "20%", "OPEN20", "Instagram", None, None, "No Promotion",
                       None, "Show code", "Owner", "No", "Holidays", "First week only"])
        else:
            ws.append(["Merchant", "Type", "Value"])
    buf2 = io.BytesIO()
    wb.save(buf2)
    ps = pi.read_promotions(buf2.getvalue(), "Merchant_Profile_System.xlsx")
    assert ps.sheet == "Promotions" and ps.rows[0][1]["name"] == "Kabob Fusion"
    v = pi._values(ps.rows[0][1], ps.rows[0][2])
    assert v["status"].value == "NO_PROMOTION" and v["blackout_dates"] == "Holidays" and v["staff_briefed"].value == "NO"


def test_import_promotions_endpoint():
    if not os.getenv("OPS_TEST_DATABASE_URL"):
        pytest.skip("needs OPS_TEST_DATABASE_URL")
    from fastapi.testclient import TestClient

    from app.common.security.jwt import create_access_token
    from app.db.session import engine
    from app.main import app
    from tests.test_ops_tickets_db import _seed

    seeded = _seed()
    engine.sync_engine.dispose(close=False)
    uid, email, role = seeded["aima"]
    token, _ = create_access_token({"sub": uid, "email": email, "role": role})
    h = {"Authorization": f"Bearer {token}"}
    code = f"P{TAG}-1"
    data = _workbook([row(code, f"Promo Place {TAG}")], [
        [code, f"Promo Place {TAG}", "Lunch Combo", "% off", "15%", "LUNCH15", "Website", "2026-10-01", "2026-10-31", "Live", "Yes", "", ""],
        ["", f"Promo Place {TAG}", "Family Night", "Bundle", "$39 for 4", "", "", "", "", "Planned", "", "", ""],
        ["NOPE-1", "Nobody Here", "Ghost deal", "", "10%", "", "", "", "", "", "", "", ""],
        [code, f"Promo Place {TAG}", "", "", "", "", "", "", "", "No Promotion", "", "", ""],  # noted, nothing added
    ])
    files = {"file": ("book.xlsx", data, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
    with TestClient(app) as client:
        pre = client.post("/api/v1/merchants/import?dryRun=true", files=files, headers=h).json()
        assert pre["promotions"]["totals"] == {"rows": 4, "new": 2, "exists": 0, "noMerchant": 1, "none": 1}, pre["promotions"]
        assert pre["promotions"]["rows"][0]["note"] == "Merchant is created by this import"
        r = client.post("/api/v1/merchants/import", files=files, headers=h).json()
        assert r["promotions"]["applied"]["created"] == 2
        mid = r["applied"]["merchantIds"][0]
        got = client.get(f"/api/v1/merchants/{mid}/promotions", headers=h).json()["data"]
        assert {p["promoName"] for p in got} == {"Lunch Combo", "Family Night"}
        # the same file again adds nothing
        again = client.post("/api/v1/merchants/import?dryRun=true", files=files, headers=h).json()
        assert again["promotions"]["totals"]["exists"] == 2 and again["promotions"]["totals"]["new"] == 0
    engine.sync_engine.dispose(close=False)


def test_import_access_and_delivery_sheets():
    """Access → Connections, Delivery → Services ("Included? = No" skipped); importing twice adds nothing."""
    if not os.getenv("OPS_TEST_DATABASE_URL"):
        pytest.skip("needs OPS_TEST_DATABASE_URL")
    import openpyxl
    from fastapi.testclient import TestClient

    from app.common.security.jwt import create_access_token
    from app.db.session import engine
    from app.main import app
    from tests.test_ops_tickets_db import _seed

    seeded = _seed()
    engine.sync_engine.dispose(close=False)
    uid, email, role = seeded["aima"]
    token, _ = create_access_token({"sub": uid, "email": email, "role": role})
    h = {"Authorization": f"Bearer {token}"}
    name = f"Sheet Place {TAG}"
    wb = openpyxl.Workbook()
    wb.active.title = "Merchants"
    wb.active.append(HEADER)
    wb.active.append(row(f"S{TAG}-1", name))
    acc = wb.create_sheet("Access")
    acc.append(["Merchant", "Access Item", "Criticality", "Status", "Date Requested", "Date Received", "Verified?", "Verified Date",
                "Expiry / Renewal", "Owner", "Flag", "Why It Matters / Notes"])
    acc.append([name, "Google Business Profile (GMB)", "Critical", "Requested", None, None, None, None, None, None, "BLOCKER", "Manager invite"])
    acc.append([name, "Domain Registrar", "Medium", "Not Requested", None, None, None, None, None, None, "Open", "DNS"])
    dl = wb.create_sheet("Delivery")
    dl.append(["Merchant", "Service", "Package", "Included?", "Qty / Period", "Frequency", "Owner Team", "Status"])
    dl.append([name, "SEO", "$199", "Yes", 1, "Monthly", "SEO", "Not Started"])
    dl.append([name, "Rewards", "$199", "No", 0, None, "Marketing", "Not Started"])
    buf = io.BytesIO()
    wb.save(buf)
    files = {"file": ("book.xlsx", buf.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
    with TestClient(app) as client:
        pre = {x["kind"]: x for x in client.post("/api/v1/merchants/import?dryRun=true", files=files, headers=h).json()["otherSheets"]}
        assert pre["access"]["new"] == 2 and pre["delivery"]["new"] == 1 and pre["delivery"]["skipped"] == 1
        r = client.post("/api/v1/merchants/import", files=files, headers=h).json()
        mid = r["applied"]["merchantIds"][0]
        conns = client.get(f"/api/v1/merchants/{mid}/connections", headers=h).json()["data"]
        assert {c["accessItem"] for c in conns} == {"Google Business Profile (GMB)", "Domain Registrar"}
        svcs = client.get(f"/api/v1/merchants/{mid}/services", headers=h).json()["data"]
        assert [s["serviceName"] for s in svcs] == ["SEO"]
        assert client.get(f"/api/v1/merchants/{mid}/profile", headers=h).status_code == 200
        again = {x["kind"]: x for x in client.post("/api/v1/merchants/import?dryRun=true", files=files, headers=h).json()["otherSheets"]}
        assert again["access"]["exists"] == 2 and again["delivery"]["exists"] == 1 and again["access"]["new"] == 0
    engine.sync_engine.dispose(close=False)
