"""The partner ladder: stages, came-from, owners, an ISO's agents, smart bulk assignment,
and turning a partner lead or a business card into an organization.

The planner is tested without a database; the rest runs against the configured
Postgres with the quote-builder fixtures (admin / sales manager / rep / marketing)."""
from __future__ import annotations

import uuid

import pytest

from app.modules.deals import partners as pt
from app.modules.partner_contacts import service as card_service
from app.modules.partner_leads import service as lead_service
from tests.test_deals_db import PREFIX, _new_deal, spine  # noqa: F401 - pytest fixture
from tests.test_quotes_api import api, sessions  # noqa: F401 - pytest fixtures


# ── the planner (no database) ────────────────────────────────────────────
def _items(spec: dict[str, int], loose: int = 0) -> list[pt.AssignItem]:
    out = []
    for group, n in spec.items():
        out += [pt.AssignItem(id=f"{group}-{i}", name=f"{group} agent {i:02d}", group=group) for i in range(n)]
    out += [pt.AssignItem(id=f"x-{i}", name=f"loose {i:02d}") for i in range(loose)]
    return out


def test_split_targets_even_counts_and_balance():
    assert pt.split_targets(90, ["a", "b", "c"]) == {"a": 30, "b": 30, "c": 30}
    assert pt.split_targets(10, ["a", "b", "c"]) == {"a": 4, "b": 3, "c": 3}
    assert pt.split_targets(90, ["a", "b", "c"], {"a": 20, "b": 30, "c": 20}) == {"a": 20, "b": 30, "c": 20}
    # Balancing: c already owns 10, so the 12 new ones go to a and b first.
    assert pt.split_targets(12, ["a", "b", "c"], existing={"c": 10}, balance_load=True) == {"a": 6, "b": 6, "c": 0}
    assert pt.split_targets(30, ["a", "b", "c"], existing={"c": 10}, balance_load=True) == {"a": 14, "b": 13, "c": 3}
    with pytest.raises(pt.AssignmentError):
        pt.split_targets(50, ["a", "b"], {"a": 30, "b": 30})
    with pytest.raises(pt.AssignmentError):
        pt.split_targets(5, [])
    with pytest.raises(pt.AssignmentError):
        pt.split_targets(5, ["a", "a"])


def test_plan_keeps_territories_together_and_hits_every_target():
    # BMO with 90 agents: 40 in CA, 25 in TX, 15 in FL, 10 with no state.
    items = _items({"CA": 40, "TX": 25, "FL": 15}, loose=10)
    plans = {p.user_id: p for p in pt.plan_assignment(items, {"a": 20, "b": 30, "c": 20})}
    assert [len(plans[k].item_ids) for k in "abc"] == [20, 30, 20]  # 70 handed out, 20 left over
    every = [i for p in plans.values() for i in p.item_ids]
    assert len(every) == len(set(every)) == 70
    # TX (25) fits b's 30 whole; FL (15) fits a or c whole; CA (40) has to be split.
    assert plans["b"].groups.get("TX") == 25
    assert any(p.groups.get("FL") == 15 for p in plans.values())
    # CA (40) is bigger than anyone's share, so it is the one territory that gets split.
    assert sum(1 for p in plans.values() for g in p.groups if g in ("TX", "FL")) == 2
    assert sum(p.groups.get("CA", 0) for p in plans.values()) == 30
    # Same input, same plan.
    again = {p.user_id: p.item_ids for p in pt.plan_assignment(items, {"a": 20, "b": 30, "c": 20})}
    assert again == {k: v.item_ids for k, v in plans.items()}


def test_plan_without_keep_together_and_with_zero_targets():
    items = _items({"CA": 5, "TX": 5})
    plans = pt.plan_assignment(items, {"a": 3, "b": 0, "c": 7}, keep_together=False)
    assert [len(p.item_ids) for p in plans] == [3, 0, 7]


# ── against the database ─────────────────────────────────────────────────
async def _org(c, who="manager", **body):
    body = {"name": f"{PREFIX}Org {uuid.uuid4().hex[:6]}", "kind": "PARTNER_ISO", **body}
    res = await c[who].post("/organizations", json=body)
    assert res.status_code == 201, res.text
    return res.json()


async def _me(c, who):
    return (await c[who].get("/auth/me")).json()["id"]


async def test_stage_came_from_next_step_and_history(spine):
    c, _, _ = spine
    o = await _org(c, cameFrom="ELAVON", cameFromDetail="Gustavo Ponce")
    assert (o["stage"], o["cameFrom"], o["cameFromDetail"]) == ("NEW", "ELAVON", "Gustavo Ponce")
    assert [e["kind"] for e in o["events"]] == ["CREATED"]

    for stage in ("DEMO_SCHEDULED", "DEMO_HELD", "NDA_SENT", "NDA_SIGNED", "AGREEMENT_SENT", "AGREEMENT_SIGNED",
                  "COLLATERAL_SENT", "IU_ENROLLED"):
        res = await c["rep"].patch(f"/organizations/{o['id']}", json={"stage": stage})
        assert res.status_code == 200, res.text
    d = res.json()
    assert d["stage"] == "IU_ENROLLED" and d["iuEnrolledAt"] and not d["certified"]
    d = (await c["rep"].patch(f"/organizations/{o['id']}", json={"stage": "CERTIFIED"})).json()
    assert d["certified"] and d["certifiedAt"]
    # Ticking "certified" on a fresh partner also moves it to Certified.
    other = await _org(c)
    assert (await c["rep"].patch(f"/organizations/{other['id']}", json={"certified": True})).json()["stage"] == "CERTIFIED"

    d = (await c["rep"].patch(f"/organizations/{o['id']}", json={
        "cameFrom": "CONFERENCE", "cameFromDetail": "WSAA 2026", "nextStep": "Send the ISO contract",
        "nextStepDue": "2026-11-03"})).json()
    assert (d["cameFrom"], d["nextStep"], d["nextStepDue"]) == ("CONFERENCE", "Send the ISO contract", "2026-11-03")
    d = (await c["rep"].post(f"/organizations/{o['id']}/notes", json={"body": "Called Leigh."})).json()
    kinds = [e["kind"] for e in d["events"]]
    assert kinds[0] == "NOTE" and kinds.count("STAGE_CHANGED") == 9 and "CAME_FROM_CHANGED" in kinds
    stage_ev = next(e for e in d["events"] if e["kind"] == "STAGE_CHANGED")
    assert (stage_ev["fromValue"], stage_ev["toValue"]) == ("IU_ENROLLED", "CERTIFIED")
    assert (await c["rep"].patch(f"/organizations/{o['id']}", json={"stage": "LIVE"})).status_code == 400
    assert (await c["rep"].patch(f"/organizations/{o['id']}", json={"cameFrom": "TWITTER"})).status_code == 400


async def test_owner_rules(spine):
    c, _, _ = spine
    rep_id, mgr_id = await _me(c, "rep"), await _me(c, "manager")
    o = await _org(c)
    # A rep can take an unassigned partner for themselves, but not give it to someone else.
    assert (await c["rep"].patch(f"/organizations/{o['id']}", json={"ownerId": mgr_id})).status_code == 403
    d = (await c["rep"].patch(f"/organizations/{o['id']}", json={"ownerId": rep_id})).json()
    assert d["owner"]["id"] == rep_id and d["assignedAt"]
    # ...and can't take it off themselves or move it on: that's the sales lead's call.
    assert (await c["rep"].patch(f"/organizations/{o['id']}", json={"clearOwner": True})).status_code == 403
    d = (await c["manager"].patch(f"/organizations/{o['id']}", json={"ownerId": mgr_id})).json()
    assert d["owner"]["id"] == mgr_id
    ev = next(e for e in d["events"] if e["kind"] == "OWNER_CHANGED")
    assert ev["fromValue"].startswith("rep") and ev["toValue"].startswith("manager")
    assert (await c["manager"].patch(f"/organizations/{o['id']}", json={"ownerId": "nope"})).status_code == 422
    # Filters: mine / unassigned.
    mine = (await c["manager"].get("/organizations", params={"ownerId": "me", "search": PREFIX})).json()
    assert [x["id"] for x in mine["data"]] == [o["id"]]
    await _org(c, name=f"{PREFIX}Nobody's")
    none = (await c["manager"].get("/organizations", params={"ownerId": "none", "search": PREFIX})).json()
    assert [x["name"] for x in none["data"]] == [f"{PREFIX}Nobody's"]


async def test_agents_under_an_iso_rollups_and_selling(spine):
    c, _, _ = spine
    iso = await _org(c, name=f"{PREFIX}BMO", cameFrom="BMO")
    rows = [{"name": f"Agent {i:02d}", "state": "CA" if i < 6 else "TX", "email": f"a{i}@example.com"} for i in range(10)]
    rows.append({"name": "Agent 03"})  # same name again
    res = await c["rep"].post(f"/organizations/{iso['id']}/agents", json={"agents": rows, "dryRun": True})
    assert res.json() == {"created": 10, "skipped": [{"row": 11, "name": "Agent 03", "reason": "already under this ISO"}],
                          "dryRun": True}
    assert (await c["rep"].get("/organizations", params={"parentId": iso["id"]})).json()["meta"]["total"] == 0
    assert (await c["rep"].post(f"/organizations/{iso['id']}/agents", json={"agents": rows})).json()["created"] == 10
    again = (await c["rep"].post(f"/organizations/{iso['id']}/agents", json={"agents": rows[:2]})).json()
    assert again["created"] == 0 and len(again["skipped"]) == 2

    agents = (await c["rep"].get("/organizations", params={"parentId": iso["id"], "limit": 50})).json()["data"]
    assert len(agents) == 10 and all(a["kind"] == "PARTNER_AGENT" and a["parent"]["id"] == iso["id"] for a in agents)
    assert all(a["cameFrom"] == "BMO" and a["source"] == "AGENT_LIST" for a in agents)
    # Top-level list hides agents; the ISO shows the roll-up.
    top = (await c["rep"].get("/organizations", params={"topLevel": "true", "search": PREFIX})).json()["data"]
    assert [x["name"] for x in top] == [f"{PREFIX}BMO"] and top[0]["agentCount"] == 10

    a0 = next(a for a in agents if a["name"] == "Agent 00")
    await c["rep"].patch(f"/organizations/{a0['id']}", json={"stage": "IU_ENROLLED"})
    await c["rep"].patch(f"/organizations/{agents[1]['id']}", json={"stage": "CERTIFIED"})
    # A deal credited to an agent makes that agent - and its ISO - "selling".
    await _new_deal(c, name="Agent Deal", organizationId=a0["id"])
    iso_now = (await c["rep"].get(f"/organizations/{iso['id']}")).json()
    assert (iso_now["agentCount"], iso_now["agentsIuEnrolled"], iso_now["agentsCertified"], iso_now["agentsSelling"]) == (10, 2, 1, 1)
    assert iso_now["selling"] and iso_now["dealCount"] == 1 and iso_now["dealsLast30"] == 1
    assert [d["organization"]["id"] for d in iso_now["deals"]] == [a0["id"]]  # the ISO page lists its agents' deals
    selling = (await c["rep"].get("/organizations", params={"parentId": iso["id"], "selling": "true"})).json()["data"]
    assert [x["id"] for x in selling] == [a0["id"]]
    assert (await c["rep"].get("/organizations", params={"topLevel": "true", "search": PREFIX, "selling": "true"})).json()["meta"]["total"] == 1

    # Agents can't nest, and an ISO with agents can't become an agent.
    assert (await c["rep"].post(f"/organizations/{a0['id']}/agents", json={"agents": [{"name": "x"}]})).status_code == 422
    other = await _org(c)
    assert (await c["rep"].patch(f"/organizations/{iso['id']}", json={"parentId": other["id"]})).status_code == 422
    assert (await c["rep"].patch(f"/organizations/{other['id']}", json={"parentId": a0["id"]})).status_code == 422


async def test_sorting(spine):
    c, _, _ = spine
    for n, stage in (("Charlie", "NDA_SENT"), ("alpha", "CERTIFIED"), ("Bravo", "NEW")):
        o = await _org(c, name=f"{PREFIX}{n}")
        await c["manager"].patch(f"/organizations/{o['id']}", json={"stage": stage})
    names = lambda r: [x["name"].removeprefix(PREFIX) for x in r.json()["data"]]  # noqa: E731
    q = {"search": PREFIX}
    assert names(await c["rep"].get("/organizations", params=q)) == ["alpha", "Bravo", "Charlie"]
    assert names(await c["rep"].get("/organizations", params={**q, "order": "desc"})) == ["Charlie", "Bravo", "alpha"]
    assert names(await c["rep"].get("/organizations", params={**q, "sortBy": "stage"})) == ["Bravo", "Charlie", "alpha"]
    assert names(await c["rep"].get("/organizations", params={**q, "sortBy": "createdAt", "order": "desc"}))[0] == "Bravo"
    assert (await c["rep"].get("/organizations", params={**q, "sortBy": "bogus"})).status_code == 400


async def test_smart_bulk_assignment(spine):
    c, _, _ = spine
    rep_id, mgr_id, admin_id = await _me(c, "rep"), await _me(c, "manager"), await _me(c, "admin")
    iso = await _org(c, name=f"{PREFIX}BMO")
    rows = [{"name": f"Agent {i:02d}", "state": ("CA", "TX", "FL")[i % 3]} for i in range(30)]
    await c["manager"].post(f"/organizations/{iso['id']}/agents", json={"agents": rows})
    agents = (await c["manager"].get("/organizations", params={"parentId": iso["id"], "limit": 50})).json()["data"]
    # Someone already looks after one of them.
    await c["manager"].patch(f"/organizations/{agents[0]['id']}", json={"ownerId": admin_id})

    plan = {"parentId": iso["id"], "people": [{"userId": rep_id, "count": 10}, {"userId": mgr_id, "count": 15}]}
    assert (await c["rep"].post("/organizations/assign", json=plan)).status_code == 403  # reps can't hand out
    prev = (await c["manager"].post("/organizations/assign", json=plan)).json()
    assert prev["dryRun"] and prev["total"] == 29 and prev["assigned"] == 25 and prev["leftOver"] == 4
    assert prev["skippedAlreadyOwned"] == 1
    by = {p["user"]["id"]: p for p in prev["people"]}
    assert by[rep_id]["count"] == 10 and by[mgr_id]["count"] == 15
    assert all(g.split(" (")[0] in ("CA", "TX", "FL") for p in prev["people"] for g in p["groups"])
    # Nothing written by the preview.
    assert (await c["manager"].get("/organizations", params={"parentId": iso["id"], "ownerId": "none"})).json()["meta"]["total"] == 29

    done = (await c["manager"].post("/organizations/assign", json={**plan, "dryRun": False})).json()
    assert done["assigned"] == 25
    owned = lambda uid: c["manager"].get("/organizations", params={"parentId": iso["id"], "ownerId": uid})  # noqa: E731
    assert (await owned(rep_id)).json()["meta"]["total"] == 10
    assert (await owned(mgr_id)).json()["meta"]["total"] == 15
    assert (await owned(admin_id)).json()["meta"]["total"] == 1  # untouched
    one = (await owned(rep_id)).json()["data"][0]
    ev = next(e for e in (await c["rep"].get(f"/organizations/{one['id']}")).json()["events"] if e["kind"] == "OWNER_CHANGED")
    assert ev["body"] == "Bulk assignment"

    # Even split of what's left, balancing what people already own: rep has 10, manager 15 -> both of the 4 go to rep.
    even = (await c["manager"].post("/organizations/assign", json={
        "parentId": iso["id"], "people": [{"userId": rep_id}, {"userId": mgr_id}], "balanceLoad": True})).json()
    by = {p["user"]["id"]: p for p in even["people"]}
    assert even["total"] == 4 and by[rep_id]["count"] == 4 and by[mgr_id]["count"] == 0

    # Bad input.
    bad = lambda body: c["manager"].post("/organizations/assign", json=body)  # noqa: E731
    assert (await bad({"parentId": iso["id"], "people": [{"userId": rep_id, "count": 99}]})).status_code == 422
    assert (await bad({"parentId": iso["id"], "people": [{"userId": rep_id, "count": 1}, {"userId": mgr_id}]})).status_code == 422
    assert (await bad({"people": [{"userId": rep_id}]})).status_code == 422
    assert (await bad({"parentId": iso["id"], "people": [{"userId": "ghost"}]})).status_code == 422

    # Reassigning everything, by list of ids, across three people evenly.
    ids = [a["id"] for a in agents]
    allp = (await c["manager"].post("/organizations/assign", json={
        "organizationIds": ids, "onlyUnassigned": False, "keepTogether": "none",
        "people": [{"userId": rep_id}, {"userId": mgr_id}, {"userId": admin_id}], "dryRun": False})).json()
    assert allp["total"] == 30 and sorted(p["count"] for p in allp["people"]) == [10, 10, 10]


async def test_lead_and_card_become_organizations(spine, monkeypatch):
    c, _, _ = spine
    lead_id, card_id = str(uuid.uuid4()), str(uuid.uuid4())
    lead = {"id": lead_id, "full_name": "Kelly Wyatt", "company": f"{PREFIX}The Payment Dude", "email": "kelly@example.com",
            "phone": "915-231-0551", "website": "thepaymentdude.com", "partner_type": "ISO / agent organization",
            "heard_about": "Google", "title": "CEO"}
    card = {"id": card_id, "full_name": "Howard Fish", "title": "VP", "company": "Paysafe", "email": "howard@example.com",
            "phone": "555-0100", "website": None, "partner_type": "Other", "met_at": "WSAA 2026", "met_on": None}

    async def get_lead(db, lid):
        return lead if lid == lead_id else None

    async def get_contact(db, cid):
        return card if cid == card_id else None

    monkeypatch.setattr(lead_service, "get_lead", get_lead)
    monkeypatch.setattr(card_service, "get_contact", get_contact)

    o = (await c["rep"].post(f"/organizations/from-lead/{lead_id}", json={})).json()
    assert (o["name"], o["kind"], o["source"], o["cameFrom"], o["partnerLeadId"]) == (
        f"{PREFIX}The Payment Dude", "PARTNER_ISO", "PARTNER_LEAD", "INBOUND_PARTNER", lead_id)
    assert o["contacts"][0]["email"] == "kelly@example.com" and o["contacts"][0]["isPrimary"]
    assert (await c["rep"].post(f"/organizations/from-lead/{lead_id}", json={})).status_code == 409
    assert (await c["rep"].post(f"/organizations/from-lead/{uuid.uuid4()}", json={})).status_code == 404

    # A card for someone at an existing partner joins that organization.
    paysafe = await _org(c, name=f"{PREFIX}Paysafe")
    d = (await c["rep"].post(f"/organizations/from-card/{card_id}", json={"organizationId": paysafe["id"]})).json()
    assert [x["name"] for x in d["contacts"]] == ["Howard Fish"] and d["cameFrom"] == "CONFERENCE"
    assert d["cameFromDetail"] == "WSAA 2026" and d["events"][0]["kind"] == "LINKED"
    assert (await c["rep"].post(f"/organizations/from-card/{card_id}", json={})).status_code == 409

    links = (await c["rep"].get("/organizations/links", params={"leadIds": lead_id, "contactIds": f"{card_id},other"})).json()
    assert links["leads"][lead_id]["id"] == o["id"] and links["cards"][card_id]["id"] == paysafe["id"]
    assert "other" not in links["cards"]
