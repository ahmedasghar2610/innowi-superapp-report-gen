"""End-to-end tests for the Ops CRM tickets API against a real Postgres.

Skipped unless OPS_TEST_DATABASE_URL is set to a *throwaway* database that
has been migrated to head (DATABASE_URL must point at the same database,
since the app's engine reads it at import). Every test seeds its own users
and merchant with unique emails, so the suite can run against a database
that already has data in it.

    OPS_TEST_DATABASE_URL=$URL DATABASE_URL=$URL DIRECT_URL=$URL pytest tests/test_ops_tickets_db.py
"""
from __future__ import annotations

import asyncio
import datetime as dt
import os
import uuid

import pytest

pytestmark = pytest.mark.skipif(not os.getenv("OPS_TEST_DATABASE_URL"), reason="needs OPS_TEST_DATABASE_URL")


def _seed():
    """Create a manager (ticket.manage), two staff, a suspended user and a merchant."""
    from sqlalchemy import select
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

    from app.config import to_asyncpg_url
    from app.models.auth import User
    from app.models.enums import Role, UserStatus
    from app.models.ops import Project
    from app.models.profiling import Merchant
    from app.common.security.password import hash_password

    tag = uuid.uuid4().hex[:8]

    async def run():
        engine = create_async_engine(to_asyncpg_url(os.environ["OPS_TEST_DATABASE_URL"]))
        Session = async_sessionmaker(engine, expire_on_commit=False)
        async with Session() as s:
            pw = hash_password("x-Password-1")
            users = {
                "aima": User(email=f"aima-{tag}@innowi.test", password_hash=pw, first_name="Aima", last_name="Raza",
                             role=Role.MARKETING_MANAGER, granted_capabilities=["ticket.manage"]),
                "sofia": User(email=f"sofia-{tag}@innowi.test", password_hash=pw, first_name="Sofia", last_name="Rivera",
                              role=Role.MARKETING_EXECUTIVE),
                "jai": User(email=f"jai-{tag}@innowi.test", password_hash=pw, first_name="Jai", last_name="Patel",
                            role=Role.MARKETING_EXECUTIVE),
                "admin": User(email=f"admin-{tag}@innowi.test", password_hash=pw, role=Role.ADMIN),
                "gone": User(email=f"gone-{tag}@innowi.test", password_hash=pw, role=Role.MARKETING_EXECUTIVE,
                             status=UserStatus.SUSPENDED),
            }
            s.add_all(users.values())
            merchant = Merchant(restaurant_name=f"Cha2Cha {tag}")
            s.add(merchant)
            await s.commit()
            project = (await s.execute(select(Project).where(Project.name == "Merchant requests"))).scalar_one()
            out = {k: (u.id, u.email, u.role.value) for k, u in users.items()}
            out["merchant"] = merchant.id
            out["project"] = project.id
        await engine.dispose()
        return out

    return asyncio.run(run())


@pytest.fixture(scope="module")
def ctx():
    from fastapi.testclient import TestClient

    from app.common.security.jwt import create_access_token
    from app.main import app

    from app.db.session import engine

    seeded = _seed()
    # Other test modules may have used the app's pooled engine from a
    # different event loop; asyncpg connections are bound to the loop that
    # opened them. Drop the pool (without touching those connections) so this
    # module's TestClient loop opens fresh ones.
    engine.sync_engine.dispose(close=False)

    def headers(who):
        uid, email, role = seeded[who]
        token, _ = create_access_token({"sub": uid, "email": email, "role": role})
        return {"Authorization": f"Bearer {token}"}

    with TestClient(app) as client:
        yield client, seeded, headers
    engine.sync_engine.dispose(close=False)


def _create(client, seeded, headers, **over):
    body = {
        "title": "New logo for storefront signage",
        "description": "Two colour variants.",
        "type": "DESIGN",
        "category": "Logo",
        "subCategory": "Refresh existing",
        "priority": "HIGH",
        "projectId": seeded["project"],
        "merchantId": seeded["merchant"],
        "assigneeId": seeded["sofia"][0],
        # Always in the future, so only tickets that set an older date count as overdue.
        "dueDate": (dt.date.today() + dt.timedelta(days=30)).isoformat(),
        "subtasks": ["Collect brand files", "Three icon directions"],
    }
    body.update(over)
    return client.post("/api/v1/ops/tickets", json=body, headers=headers("aima"))


def test_reference_endpoints(ctx):
    client, seeded, headers = ctx
    cat = client.get("/api/v1/ops/catalog", headers=headers("jai")).json()
    assert [t["type"] for t in cat["types"]] == ["MARKETING", "DESIGN", "WEBSITE", "INTERNAL"]
    projects = client.get("/api/v1/ops/projects", headers=headers("jai")).json()["data"]
    assert [p["name"] for p in projects][:4] == ["Merchant requests", "Email & SMS", "SuperApp", "Website relaunch"]
    people = {p["email"]: p for p in client.get("/api/v1/ops/people", headers=headers("jai")).json()["data"]}
    assert people[seeded["aima"][1]]["canManageTickets"] is True
    assert people[seeded["sofia"][1]]["canManageTickets"] is False
    assert seeded["gone"][1] not in people  # suspended users can't be assigned


def test_me_exposes_grants(ctx):
    client, seeded, headers = ctx
    me = client.get("/api/v1/auth/me", headers=headers("aima")).json()
    assert me["grantedCapabilities"] == ["ticket.manage"]


def test_create_requires_ticket_manage(ctx):
    client, seeded, headers = ctx
    body = {"title": "x", "type": "INTERNAL", "category": "Process", "projectId": seeded["project"],
            "assigneeId": seeded["sofia"][0]}
    # An ADMIN role does not get ticket.manage — it is granted per person.
    assert client.post("/api/v1/ops/tickets", json=body, headers=headers("admin")).status_code == 403
    assert client.post("/api/v1/ops/tickets", json=body, headers=headers("sofia")).status_code == 403


def test_create_and_read(ctx):
    client, seeded, headers = ctx
    r = _create(client, seeded, headers)
    assert r.status_code == 201, r.text
    t = r.json()
    assert t["key"] == f"OPS-{t['number']}" and t["number"] >= 1001
    assert t["status"] == "NEW" and t["assignee"]["name"] == "Sofia Rivera"
    assert t["merchant"]["id"] == seeded["merchant"] and t["createdBy"]["name"] == "Aima Raza"
    assert [s["title"] for s in t["subtasks"]] == ["Collect brand files", "Three icon directions"]
    assert t["subtaskCount"] == 2 and t["subtasksDone"] == 0
    assert t["viewer"] == {"canManage": True, "canWork": True, "watching": True}  # the creator follows it

    for key in (t["key"], t["key"].lower(), str(t["number"]), t["id"]):
        assert client.get(f"/api/v1/ops/tickets/{key}", headers=headers("jai")).status_code == 200
    as_jai = client.get(f"/api/v1/ops/tickets/{t['key']}", headers=headers("jai")).json()
    assert as_jai["viewer"] == {"canManage": False, "canWork": False, "watching": False}
    assert client.get("/api/v1/ops/tickets/OPS-99999999", headers=headers("jai")).status_code == 404


def test_create_validation(ctx):
    client, seeded, headers = ctx
    assert _create(client, seeded, headers, category="Menu", subCategory="SSL").status_code == 400
    assert _create(client, seeded, headers, type="WEBSITE").status_code == 400  # Logo isn't a Website category
    assert _create(client, seeded, headers, assigneeId=seeded["gone"][0]).status_code == 400
    assert _create(client, seeded, headers, merchantId="nope").status_code == 400
    assert _create(client, seeded, headers, projectId="nope").status_code == 400
    r = _create(client, seeded, headers, assigneeId=None)
    assert r.status_code in (400, 422)
    assert _create(client, seeded, headers, bogus=1).status_code in (400, 422)


def test_internal_ticket_without_merchant(ctx):
    client, seeded, headers = ctx
    r = _create(client, seeded, headers, type="INTERNAL", category="Process", subCategory="Approval",
                merchantId=None, subtasks=[])
    assert r.status_code == 201, r.text
    assert r.json()["merchant"] is None
    listed = client.get("/api/v1/ops/tickets", params={"merchantId": "none", "limit": 200}, headers=headers("jai")).json()
    assert r.json()["id"] in {t["id"] for t in listed["data"]}


def test_assignee_can_only_change_status(ctx):
    client, seeded, headers = ctx
    t = _create(client, seeded, headers).json()
    url = f"/api/v1/ops/tickets/{t['key']}"
    # Not the assignee → 403 even for status.
    assert client.patch(url, json={"status": "IN_PROGRESS"}, headers=headers("jai")).status_code == 403
    # Assignee: status yes, other fields no.
    r = client.patch(url, json={"status": "IN_PROGRESS"}, headers=headers("sofia"))
    assert r.status_code == 200 and r.json()["status"] == "IN_PROGRESS"
    assert client.patch(url, json={"priority": "LOW"}, headers=headers("sofia")).status_code == 403
    assert client.patch(url, json={"status": "DONE", "title": "x"}, headers=headers("sofia")).status_code == 403
    done = client.patch(url, json={"status": "DONE"}, headers=headers("sofia")).json()
    assert done["completedAt"] is not None
    reopened = client.patch(url, json={"status": "IN_REVIEW"}, headers=headers("sofia")).json()
    assert reopened["completedAt"] is None


def test_manager_edits_and_history(ctx):
    client, seeded, headers = ctx
    t = _create(client, seeded, headers).json()
    url = f"/api/v1/ops/tickets/{t['key']}"
    r = client.patch(url, json={
        "assigneeId": seeded["jai"][0], "priority": "URGENT", "dueDate": None,
        "category": "Menu", "merchantId": None, "title": "Menu redesign",
    }, headers=headers("aima"))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["assignee"]["name"] == "Jai Patel" and body["priority"] == "URGENT"
    assert body["dueDate"] is None and body["merchant"] is None
    assert body["category"] == "Menu" and body["subCategory"] is None  # old sub didn't fit "Menu"
    assert client.patch(url, json={"assigneeId": None}, headers=headers("aima")).status_code == 400

    events = [a for a in client.get(f"{url}/activity", headers=headers("jai")).json()["data"] if a["kind"] == "event"]
    kinds = [e["event"] for e in events]
    assert kinds[0] == "CREATED"
    assert {"ASSIGNED", "PRIORITY_CHANGED", "DUE_DATE_CHANGED", "UPDATED"} <= set(kinds)
    assigned = next(e for e in events if e["event"] == "ASSIGNED")
    assert assigned["data"]["from"]["name"] == "Sofia Rivera" and assigned["data"]["to"]["name"] == "Jai Patel"
    updated = next(e for e in events if e["event"] == "UPDATED")
    assert set(updated["data"]["fields"]) == {"category", "sub-category", "merchant", "title"}


def test_subtasks_and_comments(ctx):
    client, seeded, headers = ctx
    t = _create(client, seeded, headers).json()
    url = f"/api/v1/ops/tickets/{t['key']}"
    assert client.post(f"{url}/subtasks", json={"title": "Export"}, headers=headers("jai")).status_code == 403
    sub = client.post(f"{url}/subtasks", json={"title": "Export vectors"}, headers=headers("sofia"))
    assert sub.status_code == 201 and sub.json()["position"] == 2
    sid = t["subtasks"][0]["id"]
    assert client.patch(f"/api/v1/ops/subtasks/{sid}", json={"done": True}, headers=headers("jai")).status_code == 403
    done = client.patch(f"/api/v1/ops/subtasks/{sid}", json={"done": True}, headers=headers("sofia")).json()
    assert done["done"] is True and done["doneAt"]
    assert client.delete(f"/api/v1/ops/subtasks/{sub.json()['id']}", headers=headers("aima")).status_code == 204

    # Anyone with ticket.view may comment.
    c = client.post(f"{url}/comments", json={"body": "  Looks good  "}, headers=headers("jai"))
    assert c.status_code == 201 and c.json()["body"] == "Looks good" and c.json()["author"]["name"] == "Jai Patel"
    assert client.post(f"{url}/comments", json={"body": "   "}, headers=headers("jai")).status_code in (400, 422)

    fresh = client.get(url, headers=headers("jai")).json()
    assert fresh["subtaskCount"] == 2 and fresh["subtasksDone"] == 1 and fresh["commentCount"] == 1
    feed = client.get(f"{url}/activity", headers=headers("jai")).json()["data"]
    assert [i["createdAt"] for i in feed] == sorted(i["createdAt"] for i in feed)
    assert any(i["kind"] == "comment" for i in feed)
    assert {"SUBTASK_ADDED", "SUBTASK_COMPLETED", "SUBTASK_REMOVED"} <= {i["event"] for i in feed if i["kind"] == "event"}


def test_list_filters_sort_and_counts(ctx):
    client, seeded, headers = ctx
    tag = uuid.uuid4().hex[:6]
    low = _create(client, seeded, headers, title=f"zz {tag} low", priority="LOW").json()
    urgent = _create(client, seeded, headers, title=f"zz {tag} urgent", priority="URGENT",
                     type="WEBSITE", category="Bug / fix", subCategory="Broken page").json()
    overdue = _create(client, seeded, headers, title=f"zz {tag} overdue", priority="MEDIUM", dueDate="2020-01-01").json()
    params = {"search": tag, "limit": 50}

    rows = client.get("/api/v1/ops/tickets", params=params, headers=headers("jai")).json()
    assert [r["id"] for r in rows["data"]] == [urgent["id"], overdue["id"], low["id"]]
    assert rows["meta"]["total"] == 3
    assert next(r for r in rows["data"] if r["id"] == overdue["id"])["isOverdue"] is True

    only_web = client.get("/api/v1/ops/tickets", params={**params, "type": "WEBSITE"}, headers=headers("jai")).json()
    assert [r["id"] for r in only_web["data"]] == [urgent["id"]]
    hi = client.get("/api/v1/ops/tickets", params={**params, "priority": "urgent,low"}, headers=headers("jai")).json()
    assert {r["id"] for r in hi["data"]} == {urgent["id"], low["id"]}
    od = client.get("/api/v1/ops/tickets", params={**params, "overdue": True}, headers=headers("jai")).json()
    assert [r["id"] for r in od["data"]] == [overdue["id"]]
    assert client.get("/api/v1/ops/tickets", params={"priority": "bogus"}, headers=headers("jai")).status_code == 400

    counts = client.get("/api/v1/ops/tickets/counts", params={"search": tag}, headers=headers("jai")).json()
    assert counts["total"] == 3 and counts["byType"]["WEBSITE"] == 1 and counts["byType"]["DESIGN"] == 2

    by_key = client.get("/api/v1/ops/tickets", params={"search": urgent["key"], "view": "all"}, headers=headers("jai")).json()
    assert urgent["id"] in {r["id"] for r in by_key["data"]}

    # "me" = the signed-in user; Sofia owns all three.
    mine = client.get("/api/v1/ops/tickets", params={**params, "assigneeId": "me"}, headers=headers("sofia")).json()
    assert mine["meta"]["total"] == 3
    theirs = client.get("/api/v1/ops/tickets", params={**params, "assigneeId": "me"}, headers=headers("jai")).json()
    assert theirs["meta"]["total"] == 0

    # Done tickets drop out of the default (open) view.
    client.patch(f"/api/v1/ops/tickets/{low['key']}", json={"status": "DONE"}, headers=headers("aima"))
    open_ = client.get("/api/v1/ops/tickets", params=params, headers=headers("jai")).json()
    assert low["id"] not in {r["id"] for r in open_["data"]}
    done = client.get("/api/v1/ops/tickets", params={**params, "view": "done"}, headers=headers("jai")).json()
    assert [r["id"] for r in done["data"]] == [low["id"]]


def test_delete_requires_manage(ctx):
    client, seeded, headers = ctx
    t = _create(client, seeded, headers).json()
    url = f"/api/v1/ops/tickets/{t['key']}"
    assert client.delete(url, headers=headers("sofia")).status_code == 403
    assert client.delete(url, headers=headers("aima")).status_code == 204
    assert client.get(url, headers=headers("aima")).status_code == 404


def test_projects(ctx):
    client, seeded, headers = ctx
    name = f"Proj {uuid.uuid4().hex[:6]}"
    assert client.post("/api/v1/ops/projects", json={"name": name}, headers=headers("sofia")).status_code == 403
    r = client.post("/api/v1/ops/projects", json={"name": name}, headers=headers("aima"))
    assert r.status_code == 201
    assert client.post("/api/v1/ops/projects", json={"name": name}, headers=headers("aima")).status_code == 409


def test_user_grants_via_users_api(ctx):
    client, seeded, headers = ctx
    from app.models.enums import Role  # noqa: F401

    url = f"/api/v1/users/{seeded['jai'][0]}"
    assert client.patch(url, json={"grantedCapabilities": ["users.manage"]}, headers=headers("admin")).status_code in (400, 422)
    r = client.patch(url, json={"grantedCapabilities": ["ticket.manage"]}, headers=headers("admin"))
    assert r.status_code == 200 and r.json()["grantedCapabilities"] == ["ticket.manage"]
    body = {"title": "Jai can create now", "type": "INTERNAL", "category": "Other", "projectId": seeded["project"],
            "assigneeId": seeded["sofia"][0]}
    assert client.post("/api/v1/ops/tickets", json=body, headers=headers("jai")).status_code == 201
    client.patch(url, json={"grantedCapabilities": []}, headers=headers("admin"))
    assert client.post("/api/v1/ops/tickets", json=body, headers=headers("jai")).status_code == 403
