"""The spine — organizations and deals — against the configured Postgres.

Reuses the quote-builder fixtures (admin / sales manager / sales rep /
marketing executive clients, seeded price list) so the quote → deal hook can
be exercised end to end. Skipped when the database is unreachable or not
migrated.
"""
from __future__ import annotations

import datetime as dt
from decimal import Decimal as D

import pytest
from sqlalchemy import text

from app.db.schemas import qualified
from tests.test_quotes_api import _items, _link, api, sessions  # noqa: F401 - pytest fixtures
from tests.test_quotes_negotiation import _sign_body, _submit

PREFIX = "Spine Test "


@pytest.fixture()
async def spine(api):  # noqa: F811
    c, make_session, sent = api
    async with make_session() as db:
        await db.execute(text(f'DELETE FROM {qualified("profiling")}."deal"'))
        await db.execute(text(f'DELETE FROM {qualified("profiling")}."organization"'))
        await db.execute(text(f'DELETE FROM {qualified("profiling")}."merchant" WHERE restaurant_name_dba LIKE :p'),
                         {"p": f"{PREFIX}%"})
        await db.commit()
    yield c, make_session, sent
    async with make_session() as db:
        await db.execute(text(f'DELETE FROM {qualified("profiling")}."deal"'))
        await db.execute(text(f'DELETE FROM {qualified("profiling")}."organization"'))
        await db.execute(text(f'DELETE FROM {qualified("profiling")}."merchant" WHERE restaurant_name_dba LIKE :p'),
                         {"p": f"{PREFIX}%"})
        await db.commit()


async def _new_deal(c, who="rep", name="Casa Mia", **extra):
    body = {"newMerchant": {"restaurantName": f"{PREFIX}{name}", "region": "Bay Area",
                            "contactName": "Maria", "contactEmail": "maria@example.com"}, **extra}
    res = await c[who].post("/deals", json=body)
    assert res.status_code == 201, res.text
    return res.json()


async def _merchant_status(c, merchant_id: str) -> str:
    res = await c["admin"].get(f"/merchants/{merchant_id}")
    assert res.status_code == 200, res.text
    return res.json()["status"]


async def _stage(c, deal_id: str, stage: str, who="rep", **extra):
    res = await c[who].patch(f"/deals/{deal_id}", json={"stage": stage, **extra})
    assert res.status_code == 200, res.text
    return res.json()


# ── deals create the merchant and own its lifecycle ───────────────────────
async def test_new_deal_creates_prospect_merchant_with_number_and_event(spine):
    c, _, _ = spine
    deal = await _new_deal(c)
    assert deal["key"] == f"D-{deal['number']}" and deal["number"] >= 1001
    assert deal["stage"] == "NEW" and deal["merchantStatus"] == "PROSPECT"
    assert deal["restaurantName"] == f"{PREFIX}Casa Mia" and deal["region"] == "Bay Area"
    assert deal["owner"]["email"].startswith("rep")  # defaults to the creator
    assert [e["kind"] for e in deal["events"]] == ["CREATED"]
    assert await _merchant_status(c, deal["merchantId"]) == "PROSPECT"
    # ...and remembers it was created with this deal.
    m = (await c["admin"].get(f"/merchants/{deal['merchantId']}")).json()
    assert m["source"] == "NEW_DEAL" and m["sourceDetail"] == deal["key"]

    # The merchant got the contact.
    contacts = (await c["admin"].get(f"/merchants/{deal['merchantId']}/contacts")).json()
    rows = contacts["data"] if isinstance(contacts, dict) else contacts
    assert any(x.get("email") == "maria@example.com" and x.get("role") == "OWNER" for x in rows)

    # Numbers increase.
    second = await _new_deal(c, name="Second")
    assert second["number"] == deal["number"] + 1


async def test_deal_for_existing_merchant_and_input_validation(spine):
    c, _, _ = spine
    first = await _new_deal(c)
    # The picker: sales roles can search merchants here even without profile.view.
    hits = (await c["rep"].get("/deals/merchant-search", params={"q": f"{PREFIX}casa"})).json()
    assert [h["id"] for h in hits] == [first["merchantId"]] and hits[0]["openDeals"] == 1 and hits[0]["status"] == "PROSPECT"
    assert (await c["rep"].get("/deals/merchant-search", params={"q": "x"})).json() == []
    res = await c["rep"].post("/deals", json={"merchantId": first["merchantId"], "source": "Referral"})
    assert res.status_code == 201, res.text
    assert res.json()["merchantId"] == first["merchantId"] and res.json()["source"] == "Referral"

    # Neither or both merchant inputs → 422; unknown merchant → 422; cannot start lost.
    assert (await c["rep"].post("/deals", json={})).status_code == 422
    assert (await c["rep"].post("/deals", json={"merchantId": first["merchantId"],
                                                "newMerchant": {"restaurantName": f"{PREFIX}X"}})).status_code == 422
    assert (await c["rep"].post("/deals", json={"merchantId": "nope"})).status_code == 422
    assert (await c["rep"].post("/deals", json={"merchantId": first["merchantId"], "stage": "LOST"})).status_code == 422


async def test_stages_drive_merchant_status(spine):
    c, _, _ = spine
    deal = await _new_deal(c)
    did, mid = deal["id"], deal["merchantId"]

    d = await _stage(c, did, "DEMO_BOOKED")
    assert d["merchantStatus"] == "PROSPECT"  # sales steps don't touch the merchant
    d = await _stage(c, did, "QUOTE_SENT")
    assert await _merchant_status(c, mid) == "PROSPECT"

    d = await _stage(c, did, "ORDER_FORM_SIGNED")
    assert d["merchantStatus"] == "ONBOARDING" and await _merchant_status(c, mid) == "ONBOARDING"
    d = await _stage(c, did, "MENU")
    assert d["merchantStatus"] == "ONBOARDING"

    d = await _stage(c, did, "LIVE", goLiveDate="2026-11-01")
    assert d["merchantStatus"] == "ACTIVE" and d["goLiveDate"] == "2026-11-01"
    assert await _merchant_status(c, mid) == "ACTIVE"
    m = (await c["admin"].get(f"/merchants/{mid}")).json()
    assert (m.get("goLiveDate") or "").startswith("2026-11-01")

    kinds = [e["kind"] for e in d["events"]]
    assert kinds.count("STAGE_CHANGED") == 5 and kinds[-1] == "CREATED"  # newest first
    live_ev = next(e for e in d["events"] if e["toStage"] == "LIVE")
    assert live_ev["fromStage"] == "MENU" and live_ev["actor"]["email"].startswith("rep")


async def test_lost_keeps_prospect_and_requires_reason_and_active_is_never_downgraded(spine):
    c, _, _ = spine
    deal = await _new_deal(c)
    assert (await c["rep"].patch(f"/deals/{deal['id']}", json={"stage": "LOST"})).status_code == 422
    d = await _stage(c, deal["id"], "LOST", lostReason="Went with a competitor")
    assert d["stage"] == "LOST" and d["lostReason"] == "Went with a competitor"
    assert await _merchant_status(c, deal["merchantId"]) == "PROSPECT"
    # Reopening clears the reason.
    d = await _stage(c, deal["id"], "DEMO_BOOKED")
    assert d["lostReason"] is None

    # A merchant that is already ACTIVE: a second deal going LOST or back to NEW leaves it alone.
    live = await _new_deal(c, name="Live One")
    await _stage(c, live["id"], "LIVE")
    assert await _merchant_status(c, live["merchantId"]) == "ACTIVE"
    again = (await c["rep"].post("/deals", json={"merchantId": live["merchantId"]})).json()
    await _stage(c, again["id"], "ORDER_FORM_SIGNED")
    assert await _merchant_status(c, live["merchantId"]) == "ACTIVE"
    await _stage(c, again["id"], "LOST", lostReason="Expansion cancelled")
    assert await _merchant_status(c, live["merchantId"]) == "ACTIVE"


async def test_deal_fields_owner_organization_deployment_and_notes(spine):
    c, _, _ = spine
    org = (await c["manager"].post("/organizations", json={"name": "Acme ISO", "kind": "PARTNER_ISO"})).json()
    contractor = (await c["manager"].post("/organizations", json={"name": "Install Co", "kind": "CONTRACTOR"})).json()
    deal = await _new_deal(c, organizationId=org["id"])
    assert deal["organization"]["name"] == "Acme ISO"

    manager_id = (await c["manager"].get("/auth/me")).json()["id"]
    res = await c["rep"].patch(f"/deals/{deal['id']}", json={
        "ownerId": manager_id, "amountMonthly": "249.00", "amountOneTime": "1200.50", "demoAt": "2026-10-30T18:00:00Z",
        "deploymentDate": "2026-11-15", "deployedBy": "CONTRACTOR", "contractorOrganizationId": contractor["id"],
        "hiredBy": "PARTNER", "notes": "Two stations, one KDS.",
    })
    assert res.status_code == 200, res.text
    d = res.json()
    assert d["owner"]["id"] == manager_id and D(d["amountMonthly"]) == D("249.00") and D(d["amountOneTime"]) == D("1200.50")
    assert d["deploymentDate"] == "2026-11-15" and d["deployedBy"] == "CONTRACTOR" and d["hiredBy"] == "PARTNER"
    assert d["contractor"]["name"] == "Install Co" and d["notes"] == "Two stations, one KDS."
    assert "OWNER_CHANGED" in [e["kind"] for e in d["events"]]

    # Notes land in the timeline.
    res = await c["rep"].post(f"/deals/{deal['id']}/notes", json={"body": "Called the owner, demo Thursday."})
    assert res.status_code == 201
    assert res.json()["events"][0] == {**res.json()["events"][0], "kind": "NOTE", "body": "Called the owner, demo Thursday."}

    # Clearing works, bad ids are 422.
    d = (await c["rep"].patch(f"/deals/{deal['id']}", json={"clearOwner": True, "clearContractor": True, "clearDemoAt": True})).json()
    assert d["owner"] is None and d["contractor"] is None and d["demoAt"] is None
    assert (await c["rep"].patch(f"/deals/{deal['id']}", json={"ownerId": "nope"})).status_code == 422
    assert (await c["rep"].patch(f"/deals/{deal['id']}", json={"organizationId": "nope"})).status_code == 422

    # The organization page lists the deal (as sponsor) and the contractor page lists it too.
    o = (await c["rep"].get(f"/organizations/{org['id']}")).json()
    assert [x["id"] for x in o["deals"]] == [deal["id"]] and o["dealCount"] == 1
    # The contractor link was cleared above, so Install Co has none.
    assert (await c["rep"].get(f"/organizations/{contractor['id']}")).json()["deals"] == []


# ── list, filters, board ───────────────────────────────────────────────────
async def test_list_filters_and_board_counts(spine):
    c, _, _ = spine
    a = await _new_deal(c, name="Alpha")
    b = await _new_deal(c, name="Beta", who="manager")
    g = await _new_deal(c, name="Gamma")
    await _stage(c, b["id"], "DEMO_DONE", who="manager")
    await _stage(c, g["id"], "LOST", lostReason="No budget")

    lst = (await c["marketing"].get("/deals")).json()
    assert lst["meta"]["total"] == 3 and {d["key"] for d in lst["data"]} == {a["key"], b["key"], g["key"]}
    assert (await c["rep"].get("/deals", params={"mine": "true"})).json()["meta"]["total"] == 2
    assert (await c["rep"].get("/deals", params={"stage": "DEMO_DONE"})).json()["data"][0]["id"] == b["id"]
    assert (await c["rep"].get("/deals", params={"bucket": "OPEN"})).json()["meta"]["total"] == 2
    assert (await c["rep"].get("/deals", params={"bucket": "LOST"})).json()["meta"]["total"] == 1
    assert (await c["rep"].get("/deals", params={"search": "Beta"})).json()["data"][0]["id"] == b["id"]
    assert (await c["rep"].get("/deals", params={"search": a["key"]})).json()["data"][0]["id"] == a["id"]
    assert (await c["rep"].get("/deals", params={"merchantId": a["merchantId"]})).json()["meta"]["total"] == 1
    page = (await c["rep"].get("/deals", params={"limit": 2, "page": 2, "sortBy": "number", "order": "asc"})).json()
    assert page["meta"] == {"page": 2, "limit": 2, "total": 3, "pageCount": 2, "hasNextPage": False, "hasPreviousPage": True}
    assert page["data"][0]["id"] == g["id"]

    board = (await c["marketing"].get("/deals/board")).json()
    assert board["total"] == 3 and board["lost"] == 1 and board["live"] == 0
    cols = {col["stage"]: col for col in board["columns"]}
    assert [col["stage"] for col in board["columns"]][:2] == ["NEW", "DEMO_BOOKED"] and "LOST" not in cols
    assert cols["NEW"]["count"] == 1 and cols["NEW"]["deals"][0]["id"] == a["id"]
    assert cols["DEMO_DONE"]["count"] == 1 and cols["QUOTE_SENT"]["count"] == 0
    assert any(o["email"].startswith("manager") for o in board["owners"])


# ── quotes hang off deals ──────────────────────────────────────────────────
async def test_quote_executed_moves_deal_and_copies_totals(spine):
    c, _, _ = spine
    items = await _items(c)
    deal = await _new_deal(c)
    await _stage(c, deal["id"], "DEMO_DONE")

    # A link created from the deal is attached and stamped with the merchant.
    link, token = await _link(c, dealId=deal["id"])
    assert link["dealId"] == deal["id"] and link["merchantId"] == deal["merchantId"]
    d = (await c["rep"].get(f"/deals/{deal['id']}")).json()
    assert d["quoteCount"] == 1 and d["quotes"][0]["linkId"] == link["id"] and d["quotes"][0]["requestStatus"] is None
    assert "QUOTE_LINKED" in [e["kind"] for e in d["events"]]
    assert (await c["manager"].post("/quotes/links", json={"mode": "SHOW_PRICES", "restaurantName": "X",
                                                          "dealId": "nope"})).status_code == 422

    req = await _submit(c, token, [{"itemId": items["DEV-POS"]["id"], "qty": 2}, {"itemId": items["HW-INSTALL-KIT"]["id"], "qty": 1}])
    rid = req["id"]
    d = (await c["rep"].get(f"/deals/{deal['id']}")).json()
    assert d["quotes"][0]["requestNumber"] == req["number"] and d["quotes"][0]["requestStatus"] == "PROPOSED"
    assert d["stage"] == "DEMO_DONE" and d["amountMonthly"] is None

    ok = await c["anon"].post(f"/public/quotes/{token}/requests/{rid}/sign", json=_sign_body(1))
    assert ok.status_code == 200 and ok.json()["status"] == "SIGNED"
    assert (await c["rep"].get(f"/deals/{deal['id']}")).json()["stage"] == "DEMO_DONE"  # client signature alone: not yet

    res = await c["rep"].post(f"/quotes/requests/{rid}/countersign", json={
        "name": "Alex Rep", "title": "Sales", "method": "TYPED", "signatureData": "Alex Rep", "agree": True})
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "EXECUTED"

    d = (await c["rep"].get(f"/deals/{deal['id']}")).json()
    assert d["stage"] == "ORDER_FORM_SIGNED" and d["merchantStatus"] == "ONBOARDING"
    totals = req["totals"]
    assert D(d["amountMonthly"]) == D(totals["monthly"]) and D(d["amountOneTime"]) == D(totals["oneTime"])
    assert d["quotes"][0]["requestStatus"] == "EXECUTED" and D(d["quotes"][0]["monthlyTotal"]) == D(totals["monthly"])
    kinds = [e["kind"] for e in d["events"]]
    assert kinds[:2] == ["STAGE_CHANGED", "QUOTE_EXECUTED"]
    assert await _merchant_status(c, deal["merchantId"]) == "ONBOARDING"


async def test_quote_executed_never_moves_a_deal_backwards(spine):
    c, _, _ = spine
    items = await _items(c)
    deal = await _new_deal(c)
    await _stage(c, deal["id"], "MENU")
    _, token = await _link(c, dealId=deal["id"])
    req = await _submit(c, token, [{"itemId": items["DEV-POS"]["id"], "qty": 1}])
    await c["anon"].post(f"/public/quotes/{token}/requests/{req['id']}/sign", json=_sign_body(1))
    res = await c["rep"].post(f"/quotes/requests/{req['id']}/countersign", json={
        "name": "Alex Rep", "method": "TYPED", "signatureData": "Alex Rep", "agree": True})
    assert res.status_code == 200, res.text
    d = (await c["rep"].get(f"/deals/{deal['id']}")).json()
    assert d["stage"] == "MENU" and D(d["amountMonthly"]) == D(req["totals"]["monthly"])
    assert "QUOTE_EXECUTED" in [e["kind"] for e in d["events"]]


async def test_link_quote_after_the_fact_counts_an_executed_request(spine):
    c, _, _ = spine
    items = await _items(c)
    deal = await _new_deal(c)
    link, token = await _link(c)  # no deal yet
    req = await _submit(c, token, [{"itemId": items["DEV-POS"]["id"], "qty": 1}])
    await c["anon"].post(f"/public/quotes/{token}/requests/{req['id']}/sign", json=_sign_body(1))
    await c["rep"].post(f"/quotes/requests/{req['id']}/countersign", json={
        "name": "Alex Rep", "method": "TYPED", "signatureData": "Alex Rep", "agree": True})
    assert (await c["rep"].get(f"/deals/{deal['id']}")).json()["stage"] == "NEW"

    res = await c["rep"].post(f"/deals/{deal['id']}/link-quote", json={"linkId": link["id"]})
    assert res.status_code == 200, res.text
    d = res.json()
    assert d["stage"] == "ORDER_FORM_SIGNED" and D(d["amountMonthly"]) == D(req["totals"]["monthly"])
    assert d["quotes"][0]["requestStatus"] == "EXECUTED"
    assert (await c["rep"].get(f"/quotes/links/{link['id']}")).json()["dealId"] == deal["id"]

    # Same link onto another deal → 409; unknown link → 422.
    other = await _new_deal(c, name="Other")
    assert (await c["rep"].post(f"/deals/{other['id']}/link-quote", json={"linkId": link["id"]})).status_code == 409
    assert (await c["rep"].post(f"/deals/{other['id']}/link-quote", json={"linkId": "nope"})).status_code == 422


# ── organizations ──────────────────────────────────────────────────────────
async def test_organizations_crud_contacts_and_filters(spine):
    c, _, _ = spine
    res = await c["rep"].post("/organizations", json={
        "name": "Acme ISO", "kind": "PARTNER_ISO", "city": "San Jose", "state": "CA", "website": "https://acme.example",
        "contacts": [{"name": "Pat Lee", "role": "Owner", "email": "pat@example.com", "isPrimary": True},
                     {"name": "Sam Ng", "role": "Ops", "isPrimary": True}],  # second primary is demoted
    })
    assert res.status_code == 201, res.text
    org = res.json()
    assert org["status"] == "PROSPECT" and org["certified"] is False and org["certifiedAt"] is None
    assert [x["isPrimary"] for x in org["contacts"]] == [True, False] and org["primaryContact"]["name"] == "Pat Lee"

    # Certify (never expires) + status.
    o = (await c["manager"].patch(f"/organizations/{org['id']}", json={"certified": True, "status": "ACTIVE"})).json()
    assert o["certified"] is True and o["certifiedAt"] is not None and o["status"] == "ACTIVE"
    o = (await c["manager"].patch(f"/organizations/{org['id']}", json={"notes": "Signed 2026."})).json()
    assert o["certifiedAt"] is not None and o["notes"] == "Signed 2026."  # untouched by other edits

    # Contacts: add (new primary wins), edit, delete, 404s.
    add = await c["rep"].post(f"/organizations/{org['id']}/contacts", json={"name": "Jo King", "isPrimary": True})
    assert add.status_code == 201
    o = (await c["rep"].get(f"/organizations/{org['id']}")).json()
    assert [x["name"] for x in o["contacts"] if x["isPrimary"]] == ["Jo King"]
    upd = await c["rep"].patch(f"/organizations/{org['id']}/contacts/{add.json()['id']}",
                               json={"name": "Jo King", "phone": "408-555-0100", "isPrimary": False})
    assert upd.status_code == 200 and upd.json()["phone"] == "408-555-0100"
    assert (await c["rep"].delete(f"/organizations/{org['id']}/contacts/{add.json()['id']}")).status_code == 204
    assert (await c["rep"].delete(f"/organizations/{org['id']}/contacts/nope")).status_code == 404
    assert len((await c["rep"].get(f"/organizations/{org['id']}")).json()["contacts"]) == 2
    assert (await c["rep"].get("/organizations/nope")).status_code == 404

    await c["rep"].post("/organizations", json={"name": "Install Co", "kind": "CONTRACTOR"})
    assert (await c["marketing"].get("/organizations")).json()["meta"]["total"] == 2
    assert (await c["rep"].get("/organizations", params={"kind": "CONTRACTOR"})).json()["data"][0]["name"] == "Install Co"
    assert (await c["rep"].get("/organizations", params={"search": "san jose"})).json()["data"][0]["name"] == "Acme ISO"
    assert (await c["rep"].get("/organizations", params={"certified": "true"})).json()["meta"]["total"] == 1
    assert (await c["rep"].get("/organizations", params={"status": "PROSPECT"})).json()["data"][0]["name"] == "Install Co"


# ── permissions ────────────────────────────────────────────────────────────
async def test_marketing_executive_reads_only_and_anon_is_rejected(spine):
    c, _, _ = spine
    deal = await _new_deal(c)
    org = (await c["rep"].post("/organizations", json={"name": "Acme", "kind": "OTHER"})).json()
    for req in (
        c["marketing"].post("/deals", json={"merchantId": deal["merchantId"]}),
        c["marketing"].patch(f"/deals/{deal['id']}", json={"stage": "DEMO_BOOKED"}),
        c["marketing"].post(f"/deals/{deal['id']}/notes", json={"body": "x"}),
        c["marketing"].post(f"/deals/{deal['id']}/link-quote", json={"linkId": "x"}),
        c["marketing"].post("/organizations", json={"name": "X", "kind": "OTHER"}),
        c["marketing"].patch(f"/organizations/{org['id']}", json={"name": "Y"}),
        c["marketing"].post(f"/organizations/{org['id']}/contacts", json={"name": "Z"}),
    ):
        assert (await req).status_code == 403
    for req in (c["marketing"].get("/deals"), c["marketing"].get("/deals/board"), c["marketing"].get(f"/deals/{deal['id']}"),
                c["marketing"].get("/organizations"), c["marketing"].get(f"/organizations/{org['id']}")):
        assert (await req).status_code == 200
    assert (await c["anon"].get("/deals")).status_code == 401
    assert (await c["anon"].get("/organizations")).status_code == 401
    # Sales rep and admin can manage.
    assert (await c["admin"].patch(f"/deals/{deal['id']}", json={"source": "Event"})).status_code == 200
    assert (await c["rep"].patch(f"/deals/{deal['id']}", json={"source": "Referral"})).status_code == 200


async def test_merchant_deals_filter_and_delete_cascade(spine):
    c, make_session, _ = spine
    deal = await _new_deal(c)
    assert (await c["rep"].get("/deals", params={"merchantId": deal["merchantId"]})).json()["meta"]["total"] == 1
    # Deleting the merchant takes its deals with it (FK CASCADE).
    async with make_session() as db:
        await db.execute(text(f'DELETE FROM {qualified("profiling")}."merchant" WHERE id = :id'), {"id": deal["merchantId"]})
        await db.commit()
    assert (await c["rep"].get(f"/deals/{deal['id']}")).status_code == 404
    assert isinstance(dt.date.today(), dt.date)


# ── where records came from ────────────────────────────────────────────────
async def test_sources_are_recorded_and_filterable(spine):
    c, make_session, _ = spine
    # A merchant typed in on the Merchants page.
    res = await c["admin"].post("/merchants", json={"restaurantName": f"{PREFIX}Typed In"})
    assert res.status_code == 201, res.text
    typed = res.json()
    assert typed["source"] == "MANUAL" and typed["sourceDetail"] is None
    deal = await _new_deal(c, name="Via Deal")

    by_source = lambda s: c["admin"].get("/merchants", params={"source": s, "search": PREFIX, "status": "ALL"})
    assert [m["id"] for m in (await by_source("MANUAL")).json()["data"]] == [typed["id"]]
    assert [m["id"] for m in (await by_source("NEW_DEAL")).json()["data"]] == [deal["merchantId"]]
    # A record from before sources were kept ("Not recorded").
    async with make_session() as db:
        await db.execute(text(f'UPDATE {qualified("profiling")}."merchant" SET source = NULL WHERE id = :i'),
                         {"i": typed["id"]})
        await db.commit()
    assert [m["id"] for m in (await by_source("NONE")).json()["data"]] == [typed["id"]]
    assert (await c["admin"].get("/merchants", params={"source": "BOGUS"})).status_code == 400

    # Organizations: by hand, or from a partner application.
    hand = (await c["manager"].post("/organizations", json={"name": "By Hand ISO", "kind": "PARTNER_ISO"})).json()
    lead = (await c["manager"].post("/organizations", json={"name": "Applied ISO", "kind": "PARTNER_ISO",
                                                            "partnerLeadId": "lead-42"})).json()
    assert (hand["source"], hand["sourceDetail"]) == ("MANUAL", None)
    assert (lead["source"], lead["sourceDetail"]) == ("PARTNER_LEAD", "lead-42")
    got = (await c["rep"].get("/organizations", params={"source": "PARTNER_LEAD"})).json()
    assert [o["id"] for o in got["data"]] == [lead["id"]] and got["data"][0]["source"] == "PARTNER_LEAD"
    assert (await c["rep"].get("/organizations", params={"source": "NONE"})).json()["meta"]["total"] == 0
    assert (await c["rep"].get(f"/organizations/{hand['id']}")).json()["source"] == "MANUAL"
