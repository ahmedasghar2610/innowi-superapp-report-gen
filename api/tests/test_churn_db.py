"""Churned accounts: the workbook import, who can do what, filters, the summary,
and the win-back workflow. Runs against the configured Postgres (skipped when
unreachable or not migrated). Fixtures are the two CSM workbooks as of
2026-10-22: real restaurant names and addresses, with the owners' names,
phones and e-mails replaced by placeholders.
"""
from __future__ import annotations

from decimal import Decimal
from pathlib import Path

import httpx
import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.common.security.jwt import create_access_token
from app.common.security.password import hash_password
from app.config import get_settings
from app.db.schemas import qualified
from app.db.session import engine_kwargs
from app.db.session import get_db
from app.main import app
from app.models.auth import User
from app.models.enums import Role, UserStatus
from app.models.profiling import Merchant
from app.modules.churn.importer import normalise_name, parse_workbook, split_address
from app.modules.churn.router import split_categories

DOMAIN = "@test.churn"
FIX = Path(__file__).parent / "fixtures"
CONTACTS = FIX / "churn_contacts.xlsx"
REASONS = FIX / "churn_reasons.xlsx"


# ------------------------------------------------------------- pure logic ---
def test_parse_contacts_layout():
    r = parse_workbook(CONTACTS.read_bytes())
    assert [(s.name, s.layout, s.rows) for s in r.sheets] == [("BA", "contacts", 282), ("LA", "contacts", 241)]
    first = r.rows[0]
    assert first.name == "Ace's Philly CheeseSteaks" and first.region == "BA"
    assert first.phone == "(555) 010-0001" and first.email == "owner1@example.com"
    assert first.dm_name == "Owner 1" and first.stage == "Deployed - Closed"


def test_parse_reasons_layout_skips_subtotals_and_reads_dates_money_notes():
    r = parse_workbook(REASONS.read_bytes())
    assert [(s.name, s.layout, s.rows) for s in r.sheets] == [("Data Jan- Sep with MRR", "reasons", 98)]
    rows = {x.name: x for x in r.rows}
    assert "Subtotal" not in rows and "Total" not in rows
    assert all(x.churned_on for x in r.rows), "every row has a churn date"
    t = rows["T On Ice"]
    assert str(t.churned_on) == "2026-07-08" and t.category == "Price; Product Features"
    assert t.mrr == Decimal("7.81") and t.gpv == 0 and t.csm_name == "Salvatore" and t.tier == 5
    assert t.note and t.note.startswith("I spoke with the owner")
    assert rows["Pho Thanh Binh"].mrr == Decimal("-7.13")         # "($7.13)" is negative
    assert rows["Kabul Icy Treats & Cafe"].gpv == 13406  # "$13,406 "
    assert str(rows["3 Bees Coffee"].start_date) == "2022-04-19"


def test_helpers():
    assert split_address("1711 Branham Ln # A9, San Jose, CA 95118, United States") == {
        "address": "1711 Branham Ln # A9", "city": "San Jose", "state": "CA", "zip": "95118"}
    assert split_address("240 Park Rd, Burlingame, CA 94010")["city"] == "Burlingame"
    assert normalise_name("Lilikoi Boba <> Prospect, San Jose") == "lilikoi boba prospect san jose"
    assert normalise_name("MOTHER AFRICAN CUISINE") == normalise_name("Mother African Cuisine")
    assert split_categories("Billing; Price; Product Reliability; Support") == ["Billing", "Price", "Product Reliability", "Support"]
    assert split_categories("Other - TEMP , Marketing") == ["Other - TEMP", "Marketing"]
    assert split_categories(None) == []


# ----------------------------------------------------------------- API -----
@pytest.fixture()
async def sessions():
    settings = get_settings()
    engine = create_async_engine(settings.database_url_async, **{**engine_kwargs(), "poolclass": NullPool})
    try:
        async with engine.connect() as conn:
            exists = (await conn.execute(text("select to_regclass(:t)"), {"t": f"{qualified('profiling')}.merchant_churn"})).scalar()
    except Exception as exc:  # noqa: BLE001
        await engine.dispose()
        pytest.skip(f"database not reachable: {exc}")
    if not exists:
        await engine.dispose()
        pytest.skip("merchant_churn not migrated")

    async def clean():
        async with engine.begin() as conn:
            p = qualified("profiling")
            await conn.execute(text(
                f'DELETE FROM {p}."merchant" WHERE status = \'CHURNED\' OR restaurant_name_dba LIKE \'%[churn-test]%\' '
                f'OR id IN (SELECT merchant_id FROM {p}."merchant_churn")'))
            await conn.execute(text(f'DELETE FROM {p}."account_manager" WHERE team = \'CSM\''))
            await conn.execute(text(f'DELETE FROM {qualified("auth")}."user" WHERE email LIKE \'%{DOMAIN}\''))

    await clean()
    yield async_sessionmaker(bind=engine, expire_on_commit=False, autoflush=False)
    await clean()
    await engine.dispose()


@pytest.fixture()
async def api(sessions):
    async def _db():
        async with sessions() as db:
            yield db

    app.dependency_overrides[get_db] = _db
    users = {}
    async with sessions() as db:
        for key, role in [("admin", Role.ADMIN), ("smgr", Role.SALES_MANAGER), ("rep", Role.SALES_EXECUTIVE),
                          ("mkt", Role.MARKETING_EXECUTIVE)]:
            u = User(email=f"{key}{DOMAIN}", password_hash=hash_password("x" * 12), role=role, status=UserStatus.ACTIVE,
                     first_name=key.title())
            db.add(u)
            users[key] = u
        await db.commit()
    clients = {}
    for key, u in users.items():
        token, _ = create_access_token({"sub": u.id, "email": u.email, "role": u.role.value})
        clients[key] = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test/api/v1",
                                         headers={"Authorization": f"Bearer {token}"})
    clients["anon"] = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test/api/v1")
    yield clients, users, sessions
    for c in clients.values():
        await c.aclose()
    app.dependency_overrides.pop(get_db, None)


async def _upload(client, path: Path, dry_run: bool = False):
    files = {"file": (path.name, path.read_bytes(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
    return await client.post("/churn/import", params={"dryRun": str(dry_run).lower()}, files=files)


async def test_import_permissions(api):
    c, _, _ = api
    assert (await c["anon"].get("/churn")).status_code == 401
    for who in ("rep", "mkt"):
        assert (await _upload(c[who], REASONS, dry_run=True)).status_code == 403
    assert (await _upload(c["smgr"], REASONS, dry_run=True)).status_code == 200


async def test_dry_run_writes_nothing(api):
    c, _, sessions = api
    res = await _upload(c["admin"], CONTACTS, dry_run=True)
    assert res.status_code == 200, res.text
    rep = res.json()
    # 523 rows; three are the same place listed twice (Punjab Cafe, Tasty Mob Market, Kiss My Boba).
    # Same-name rows at different addresses (Town Bizness Hibachi x4, ...) are separate accounts.
    assert rep["dryRun"] is True and rep["rowsRead"] == 523 and rep["merchantsCreated"] == 520
    assert rep["duplicatesInFile"] == 3 and rep["contactsAdded"] == 523 and rep["locationsAdded"] == 516  # placeholder contacts are all distinct; 4 rows carry no address
    assert (await c["admin"].get("/churn")).json()["meta"]["total"] == 0
    async with sessions() as db:
        n = (await db.execute(select(Merchant).where(Merchant.status == "CHURNED"))).scalars().all()
        assert n == []


async def test_import_both_workbooks_then_reimport_is_idempotent(api):
    c, users, sessions = api
    rep1 = (await _upload(c["admin"], CONTACTS)).json()
    assert rep1["merchantsCreated"] == 520 and rep1["churnRecordsCreated"] == 520 and rep1["skipped"] == []
    s1 = (await c["admin"].get("/churn/summary")).json()
    assert s1["withReason"] == 0 and "SF" not in s1["regions"]  # SF folds into BA

    rep2 = (await _upload(c["admin"], REASONS)).json()
    assert rep2["rowsRead"] == 98
    # The reasons workbook overlaps the contacts list on some names and adds the rest.
    assert rep2["merchantsMatched"] + rep2["merchantsCreated"] == 98 and rep2["merchantsMatched"] > 0
    total = (await c["admin"].get("/churn", params={"limit": 1})).json()["meta"]["total"]
    assert total == 520 + rep2["merchantsCreated"]
    # "Fish's Wild (Cupertino)" exists at two addresses; the reasons row had none to pick by → reported.
    assert any(a["name"] == "Fish's Wild (Cupertino)" for a in rep2["ambiguous"])

    # Every imported merchant is CHURNED, and the merchant list can filter on it.
    ml = (await c["admin"].get("/merchants", params={"status": "CHURNED", "limit": 1})).json()
    assert ml["meta"]["total"] == total
    # ...and every one of them says it came from the churn workbook, naming file and sheet.
    src = (await c["admin"].get("/merchants", params={"status": "CHURNED", "source": "CHURN_IMPORT", "limit": 100})).json()
    assert src["meta"]["total"] == total
    assert all(m["source"] == "CHURN_IMPORT" and ".xlsx / " in (m["sourceDetail"] or "")
               for m in src["data"])
    # The directory hides churned accounts unless asked (they live on /churn).
    default = (await c["admin"].get("/merchants", params={"limit": 1})).json()
    assert default["meta"]["total"] < total
    everything = (await c["admin"].get("/merchants", params={"status": "ALL", "limit": 1})).json()
    assert everything["meta"]["total"] >= total
    dq = (await c["admin"].get("/profiling/data-quality")).json()
    assert dq["bands"]["critical"] + dq["bands"]["partial"] + dq["bands"]["complete"] < total

    # Detail of a reasons row: facts, CSM → account manager, solution, tier, note → win-back notes.
    hit = (await c["admin"].get("/churn", params={"search": "T On Ice"})).json()["data"][0]
    assert hit["churnedOn"] == "2026-07-08" and hit["categories"] == ["Price", "Product Features"]
    assert hit["csmName"] == "Salvatore" and hit["accountManager"] == "Salvatore"
    assert hit["innowiSolution"] == "Kiosk Only" and hit["accountTier"] == 5 and hit["region"] == "LA"
    assert float(hit["mrrAtChurn"]) == 7.81 and hit["winbackNotes"].startswith("I spoke with the owner")
    assert hit["winbackStatus"] == "NOT_STARTED" and hit["merchantStatus"] == "CHURNED"

    # A contacts row kept its owner contact + parsed address.
    ace = (await c["admin"].get("/churn", params={"search": "Ace's Philly"})).json()["data"][0]
    assert ace["contact"]["email"] == "owner1@example.com" and ace["contact"]["name"] == "Owner 1"
    assert ace["location"]["city"] == "San Jose" and ace["location"]["zip"] == "95118"
    assert ace["reason"] is None and "(Deployed - Closed)" in ace["source"]  # the stage isn't a reason

    # A name present in both files was merged, not duplicated.
    both = (await c["admin"].get("/churn", params={"search": "Mother African Cuisine"})).json()["data"]
    assert len(both) == 1 and both[0]["contact"]["email"].endswith("@example.com") and both[0]["category"] == "Product Not Useful"

    # Re-import: nothing new is created, win-back edits survive.
    await c["admin"].patch(f"/churn/{hit['merchantId']}", json={"winbackStatus": "IN_TALKS", "winbackNotes": "called 10/22"})
    rep3 = (await _upload(c["admin"], REASONS)).json()
    assert rep3["merchantsCreated"] == 0 and rep3["merchantsMatched"] == 98 and rep3["churnRecordsCreated"] == 0
    again = (await c["admin"].get(f"/churn/{hit['merchantId']}")).json()
    assert again["winbackStatus"] == "IN_TALKS" and again["winbackNotes"].startswith("called 10/22")
    assert (await c["admin"].get("/churn", params={"limit": 1})).json()["meta"]["total"] == total
    async with sessions() as db:
        dup = (await db.execute(select(Merchant).where(Merchant.restaurant_name == "T On Ice"))).scalars().all()
        assert len(dup) == 1


async def test_filters_summary_and_winback_flow(api):
    c, users, _ = api
    assert (await _upload(c["admin"], REASONS)).status_code == 200
    rows = (await c["rep"].get("/churn", params={"region": "NY"})).json()
    assert rows["meta"]["total"] == 4 and all(r["region"] == "NY" for r in rows["data"])
    price = (await c["rep"].get("/churn", params={"category": "Price", "limit": 200})).json()
    assert price["meta"]["total"] >= 20 and all("Price" in r["category"] for r in price["data"])
    window = (await c["rep"].get("/churn", params={"churnedFrom": "2026-09-01", "churnedTo": "2026-09-30", "limit": 200})).json()
    assert window["meta"]["total"] == 13
    by_mrr = (await c["rep"].get("/churn", params={"sortBy": "mrrAtChurn", "order": "desc", "limit": 3})).json()["data"]
    assert by_mrr[0]["restaurantName"] == "Hooz Donuts"

    s = (await c["mkt"].get("/churn/summary")).json()
    assert s["total"] == 98 and s["withReason"] == 98
    assert {x["key"]: x["count"] for x in s["byRegion"]}["BA"] == 54
    assert {x["key"]: x["count"] for x in s["byMonth"]}["2026-07"] == 18
    cats = {x["key"]: x["count"] for x in s["byCategory"]}
    assert cats["Price"] == 19 and cats["Business Closed"] >= 20  # "CCP Price" is its own category
    assert "NY" in s["regions"] and "Price" in s["categories"] and "Kim Marshall" in s["csms"]
    assert float(s["mrrLost"]) > 10000

    # Win-back: a rep can take an account, log a touch, and the first touch moves it to CONTACTED.
    mid = by_mrr[0]["merchantId"]
    res = await c["rep"].patch(f"/churn/{mid}", json={"winbackOwnerId": users["rep"].id, "nextFollowUpOn": "2026-11-01"})
    assert res.status_code == 200, res.text
    assert res.json()["winbackOwner"]["email"] == f"rep{DOMAIN}" and res.json()["nextFollowUpOn"] == "2026-11-01"
    res = await c["rep"].post(f"/churn/{mid}/notes", json={"body": "Called, owner open to a new rate"})
    assert res.status_code == 201 and res.json()["winbackStatus"] == "CONTACTED" and res.json()["notes"][0]["author"]["name"] == "Rep"
    mine = (await c["rep"].get("/churn", params={"mine": "true"})).json()
    assert mine["meta"]["total"] == 1 and mine["data"][0]["notesCount"] == 1
    # Marketing executive reads but can't work it; a rep can't rewrite the churn facts.
    assert (await c["mkt"].patch(f"/churn/{mid}", json={"winbackStatus": "DECLINED"})).status_code == 403
    assert (await c["rep"].patch(f"/churn/{mid}", json={"mrrAtChurn": "1"})).status_code == 403
    assert (await c["smgr"].patch(f"/churn/{mid}", json={"category": "Price; Support"})).status_code == 200
    # Won back → the merchant is ACTIVE again and leaves the CHURNED merchant filter, record stays.
    won = (await c["smgr"].patch(f"/churn/{mid}", json={"winbackStatus": "WON_BACK"})).json()
    assert won["merchantStatus"] == "ACTIVE"
    assert (await c["admin"].get("/merchants", params={"status": "CHURNED", "search": "Hooz"})).json()["meta"]["total"] == 0
    assert (await c["admin"].get(f"/churn/{mid}")).status_code == 200


async def test_mark_existing_merchant_churned(api):
    c, _, _ = api
    m = (await c["admin"].post("/merchants", json={"restaurantName": "Primo [churn-test]", "region": "BA"})).json()
    assert m["status"] == "ACTIVE"
    assert (await c["mkt"].post(f"/churn/{m['id']}", json={"reason": "x"})).status_code == 403
    res = await c["rep"].post(f"/churn/{m['id']}", json={"category": "Price", "reason": "Went to Toast", "mrrAtChurn": "199"})
    assert res.status_code == 201 and res.json()["merchantStatus"] == "CHURNED" and res.json()["source"] == "manual"
    assert (await c["rep"].post(f"/churn/{m['id']}", json={})).status_code == 409
    assert (await c["admin"].get(f"/merchants/{m['id']}")).json()["status"] == "CHURNED"
    assert (await c["admin"].get("/churn", params={"search": "Primo"})).json()["meta"]["total"] == 1


async def test_bad_uploads(api):
    c, _, _ = api
    r = await c["admin"].post("/churn/import", files={"file": ("x.csv", b"a,b", "text/csv")})
    assert r.status_code == 400
    r = await c["admin"].post("/churn/import", files={"file": ("x.xlsx", b"not a workbook", "application/octet-stream")})
    assert r.status_code == 400
