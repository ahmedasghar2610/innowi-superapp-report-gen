"""Team requests: submit, upvote, comment, triage, approve onto the roadmap, notifications.

Runs against the configured Postgres (skipped when unreachable or not migrated).
"""
from __future__ import annotations

import httpx
import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.common.security.jwt import create_access_token
from app.common.security.password import hash_password
from app.config import get_settings
from app.db.schemas import qualified, schema_translate_map
from app.db.session import get_db
from app.main import app
from app.models import requests as m
from app.models import roadmap as rm
from app.models.auth import User
from app.models.enums import NotificationKind, Role, UserStatus
from app.models.ops import Notification
from app.modules.requests import notify

DOMAIN = "@test.requests"


async def _wipe(conn):
    await conn.execute(text(f'DELETE FROM {qualified("roadmap")}."request"'))
    await conn.execute(text(f'DELETE FROM {qualified("roadmap")}."item"'))
    await conn.execute(text(f'DELETE FROM {qualified("roadmap")}."phase"'))
    await conn.execute(text(f'DELETE FROM {qualified("auth")}."user" WHERE email LIKE \'%{DOMAIN}\''))


@pytest.fixture()
async def sessions():
    settings = get_settings()
    kwargs = {"poolclass": NullPool}
    translate = schema_translate_map()
    if translate:
        kwargs["execution_options"] = {"schema_translate_map": translate}
    engine = create_async_engine(settings.database_url_async, **kwargs)
    try:
        async with engine.connect() as conn:
            exists = (await conn.execute(text("select to_regclass(:t)"),
                                         {"t": f"{qualified('roadmap')}.request"})).scalar()
    except Exception as exc:  # noqa: BLE001
        await engine.dispose()
        pytest.skip(f"database not reachable: {exc}")
    if not exists:
        await engine.dispose()
        pytest.skip("requests tables not migrated")
    async with engine.begin() as conn:
        await _wipe(conn)
    yield async_sessionmaker(bind=engine, expire_on_commit=False, autoflush=False)
    async with engine.begin() as conn:
        await _wipe(conn)
    await engine.dispose()


@pytest.fixture()
async def api(sessions, monkeypatch):
    # No real e-mail / Teams: capture what would have been sent.
    sent: list[tuple[str, dict]] = []
    monkeypatch.setattr(notify, "_post_json", lambda url, payload, headers=None: sent.append((url, payload)) or 200)
    s = get_settings()
    monkeypatch.setattr(s, "RESEND_API_KEY", "test-key")
    monkeypatch.setattr(s, "REQUESTS_TEAMS_WEBHOOK_URL", "https://teams.example/hook")

    async def _db():
        async with sessions() as db:
            yield db

    app.dependency_overrides[get_db] = _db
    users: dict[str, User] = {}
    async with sessions() as db:
        for key, role, grants in [
            ("boss", Role.SUPER_ADMIN, []),           # Shayan: triages by role
            ("dev", Role.ADMIN, ["requests.triage"]),  # Muhammad: triages by grant
            ("admin", Role.ADMIN, []),                 # an admin without the grant: no triage
            ("rep", Role.SALES_EXECUTIVE, []),
            ("emma", Role.SALES_EXECUTIVE, []),
            ("marketing", Role.MARKETING_EXECUTIVE, []),
        ]:
            u = User(email=f"{key}{DOMAIN}", password_hash=hash_password("x" * 12), role=role,
                     status=UserStatus.ACTIVE, first_name=key.title(), granted_capabilities=grants)
            db.add(u)
            users[key] = u
        await db.commit()
    clients = {}
    for key, u in users.items():
        token, _ = create_access_token({"sub": u.id, "email": u.email, "role": u.role.value})
        clients[key] = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test/api/v1",
                                         headers={"Authorization": f"Bearer {token}"})
    clients["anon"] = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test/api/v1")
    yield clients, users, sessions, sent
    for c in clients.values():
        await c.aclose()
    app.dependency_overrides.pop(get_db, None)


async def _submit(c, who="rep", **kw):
    body = {"type": "FEATURE", "area": "PARTNERS", "urgency": "HIGH", "title": "Sort partners A to Z",
            "details": "Sortable columns on the partners page.", "why": "We can't find partners quickly."}
    body.update(kw)
    res = await c[who].post("/requests", json=body)
    assert res.status_code == 201, res.text
    return res.json()


async def _notices(sessions, user: User, kind=None) -> list[Notification]:
    async with sessions() as db:
        q = select(Notification).where(Notification.user_id == user.id)
        if kind:
            q = q.where(Notification.kind == kind)
        return list((await db.execute(q.order_by(Notification.created_at))).scalars())


def _emails(sent, to: str) -> list[dict]:
    return [p for url, p in sent if "resend" in url and to in p["to"]]


async def test_everyone_submits_and_sees_all_only_triagers_decide(api):
    c, users, _, _ = api
    assert (await c["anon"].get("/requests")).status_code == 401
    r = await _submit(c)
    assert r["ref"] == f"R-{r['number']}" and r["status"] == "NEW"
    assert r["votes"] == 1 and r["votedByMe"] is True and r["mine"] is True  # you need it too
    assert r["events"][0]["kind"] == "CREATED"
    assert r["canTriage"] is False and r["canEdit"] is True

    for who in ("emma", "marketing", "admin", "boss", "dev"):
        body = (await c[who].get("/requests")).json()
        assert [x["ref"] for x in body["data"]] == [r["ref"]]
        assert body["counts"]["new"] == 1 and body["counts"]["open"] == 1
        assert body["canTriage"] is (who in ("boss", "dev"))
    # Not a triager: no status changes, no approvals — even an Admin without the grant.
    for who in ("rep", "emma", "admin"):
        assert (await c[who].post(f"/requests/{r['ref']}/status",
                                  json={"status": "UNDER_REVIEW"})).status_code == 403
    assert (await c["dev"].post(f"/requests/{r['ref']}/status", json={"status": "UNDER_REVIEW"})).status_code == 200
    # Refs work with or without the prefix; unknown ones 404.
    assert (await c["emma"].get(f"/requests/{r['number']}")).status_code == 200
    assert (await c["emma"].get("/requests/r-99999999")).status_code == 404


async def test_new_request_tells_the_triagers_by_bell_email_and_teams(api):
    c, users, sessions, sent = api
    r = await _submit(c)
    for who in ("boss", "dev"):
        (n,) = await _notices(sessions, users[who], NotificationKind.REQUEST_NEW)
        assert n.link == f"/requests/{r['ref']}" and r["ref"] in n.title and n.ticket_id is None
        (mail,) = _emails(sent, f"{who}{DOMAIN}")
        assert mail["subject"].startswith(f"New request {r['ref']}") and "/requests/" in mail["html"]
    # The requester and people without triage hear nothing.
    for who in ("rep", "admin", "emma"):
        assert await _notices(sessions, users[who]) == []
    teams = [p for url, p in sent if url == "https://teams.example/hook"]
    assert len(teams) == 1 and r["ref"] in teams[0]["attachments"][0]["content"]["body"][0]["text"]
    # The bell endpoint returns the link so the web can open the request.
    bell = (await c["dev"].get("/ops/notifications")).json()
    assert bell["data"][0]["link"] == f"/requests/{r['ref']}" and bell["data"][0]["ticketKey"] is None


async def test_personal_choices_decide_bell_and_email(api):
    c, users, sessions, sent = api
    async with sessions() as db:
        dev = await db.get(User, users["dev"].id)
        dev.preferences = {"notifications": {"requests": {"inApp": False, "email": False, "teams": False}}}
        await db.commit()
    await _submit(c)
    assert await _notices(sessions, users["dev"]) == [] and _emails(sent, f"dev{DOMAIN}") == []
    assert len(_emails(sent, f"boss{DOMAIN}")) == 1


async def test_upvotes_toggle_and_sort_top_first(api):
    c, users, _, _ = api
    a = await _submit(c, title="First ask")
    b = await _submit(c, who="emma", title="Second ask")
    for who in ("rep", "marketing", "dev"):
        res = await c[who].post(f"/requests/{b['ref']}/vote")
        assert res.status_code == 200
    again = (await c["rep"].post(f"/requests/{b['ref']}/vote")).json()
    assert again["votes"] == 4 and again["votedByMe"] is True  # voting twice counts once
    top = (await c["admin"].get("/requests?sort=top")).json()["data"]
    assert [x["ref"] for x in top] == [b["ref"], a["ref"]]
    off = (await c["rep"].delete(f"/requests/{b['ref']}/vote")).json()
    assert off["votes"] == 3 and off["votedByMe"] is False
    assert set(off["voters"]) == {"Emma", "Marketing", "Dev"}
    assert [x["ref"] for x in (await c["rep"].get("/requests?mine=true")).json()["data"]] == [a["ref"]]


async def test_requester_edits_while_new_or_needs_info_only(api):
    c, users, _, _ = api
    r = await _submit(c)
    url = f"/requests/{r['ref']}"
    assert (await c["emma"].patch(url, json={"title": "Hijack"})).status_code == 403
    ok = await c["rep"].patch(url, json={"title": "Sort partners A–Z and by date", "urgency": "BLOCKING"})
    assert ok.status_code == 200 and ok.json()["title"] == "Sort partners A–Z and by date"
    assert ok.json()["events"][-1]["kind"] == "EDITED"
    await c["boss"].post(f"{url}/status", json={"status": "UNDER_REVIEW"})
    assert (await c["rep"].patch(url, json={"title": "Too late"})).status_code == 403
    assert (await c["boss"].patch(url, json={"area": "SALES"})).status_code == 200  # triagers can tidy it
    assert (await c["rep"].patch(url, json={})).status_code == 403


async def test_needs_info_then_requester_answer_goes_back_to_review(api):
    c, users, sessions, sent = api
    r = await _submit(c)
    url = f"/requests/{r['ref']}"
    bad = await c["boss"].post(f"{url}/status", json={"status": "NEEDS_INFO"})
    assert bad.status_code == 400  # say what you need
    res = await c["boss"].post(f"{url}/status", json={"status": "NEEDS_INFO", "note": "Which columns?"})
    assert res.json()["status"] == "NEEDS_INFO" and res.json()["decisionNote"] == "Which columns?"
    (n,) = await _notices(sessions, users["rep"], NotificationKind.REQUEST_UPDATED)
    assert "needs more information" in n.title and "Which columns?" in (n.body or "")
    assert any("Which columns?" in p["html"] for p in _emails(sent, f"rep{DOMAIN}"))
    # Someone else's comment doesn't move it; the requester's answer does.
    assert (await c["emma"].post(f"{url}/comments", json={"body": "Me too"})).json()["status"] == "NEEDS_INFO"
    ans = (await c["rep"].post(f"{url}/comments", json={"body": "Name, date, source."})).json()
    assert ans["status"] == "UNDER_REVIEW" and [x["body"] for x in ans["commentList"]] == ["Me too",
                                                                                         "Name, date, source."]
    answered = [n for n in await _notices(sessions, users["boss"], NotificationKind.REQUEST_UPDATED)
                if "answered" in n.title]
    assert len(answered) == 1
    # Commenters now follow the request.
    assert any("commented" in n.title or "answered" in n.title
               for n in await _notices(sessions, users["emma"], NotificationKind.REQUEST_UPDATED))


async def test_decline_needs_a_reason_and_duplicates_move_the_votes(api):
    c, users, sessions, _ = api
    keep = await _submit(c, title="ISO dashboard")
    dup = await _submit(c, who="emma", title="Dashboard for ISOs")
    await c["marketing"].post(f"/requests/{dup['ref']}/vote")
    assert (await c["boss"].post(f"/requests/{dup['ref']}/status", json={"status": "DECLINED"})).status_code == 400
    assert (await c["boss"].post(f"/requests/{dup['ref']}/status",
                                 json={"status": "DUPLICATE", "duplicateOf": dup["ref"]})).status_code == 400
    res = await c["boss"].post(f"/requests/{dup['ref']}/status",
                               json={"status": "DUPLICATE", "duplicateOf": keep["ref"]})
    assert res.status_code == 200 and res.json()["duplicateOf"] == keep["ref"]
    kept = (await c["rep"].get(f"/requests/{keep['ref']}")).json()
    assert kept["votes"] == 3  # rep + emma + marketing
    assert (await c["boss"].post(f"/requests/{dup['ref']}/status",
                                 json={"status": "DUPLICATE", "duplicateOf": keep["ref"]})).status_code == 400
    closed = (await c["rep"].get("/requests?status=closed")).json()
    assert [x["ref"] for x in closed["data"]] == [dup["ref"]] and closed["counts"]["closed"] == 1
    dec = await c["dev"].post(f"/requests/{keep['ref']}/status", json={"status": "DECLINED", "note": "Not now"})
    assert dec.json()["status"] == "DECLINED" and dec.json()["decisionNote"] == "Not now"
    assert any("was declined" in n.title for n in await _notices(sessions, users["marketing"]))


async def test_approve_creates_a_roadmap_item_and_follows_it_to_shipped(api):
    c, users, sessions, _ = api
    r = await _submit(c)
    await c["emma"].post(f"/requests/{r['ref']}/vote")
    phase = (await c["boss"].post("/roadmap/phases", json={"name": "Partners", "startMonth": "2026-11-01",
                                                           "endMonth": "2026-11-01"})).json()
    assert (await c["rep"].post(f"/requests/{r['ref']}/approve", json={"phaseId": phase["id"]})).status_code == 403
    assert (await c["boss"].post(f"/requests/{r['ref']}/approve", json={})).status_code == 400
    res = await c["dev"].post(f"/requests/{r['ref']}/approve",
                              json={"phaseId": phase["id"], "ownerId": users["dev"].id, "note": "Week of Nov 2"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "APPROVED" and body["roadmapItem"]["phaseName"] == "Partners"
    async with sessions() as db:
        item = await db.get(rm.Item, body["roadmapItem"]["id"])
        assert item.link == f"/requests/{r['ref']}" and item.area == "SALES" and item.priority == "HIGH"
        assert r["ref"] in item.description and item.owner_id == users["dev"].id
    assert any("on the roadmap" in n.title for n in await _notices(sessions, users["emma"]))

    # The owner starts it, then finishes it: the request follows and its people hear.
    await c["dev"].patch(f"/roadmap/items/{item.id}", json={"status": "IN_PROGRESS"})
    assert (await c["rep"].get(f"/requests/{r['ref']}")).json()["status"] == "IN_PROGRESS"
    await c["dev"].patch(f"/roadmap/items/{item.id}", json={"status": "DONE"})
    done = (await c["rep"].get(f"/requests/{r['ref']}")).json()
    assert done["status"] == "SHIPPED" and done["roadmapItem"]["status"] == "DONE"
    assert [e["toStatus"] for e in done["events"] if e["kind"] == "STATUS"] == ["APPROVED", "IN_PROGRESS", "SHIPPED"]
    shipped = [n for n in await _notices(sessions, users["rep"]) if "has shipped" in n.title]
    assert len(shipped) == 1


async def test_approve_can_link_an_existing_item(api):
    c, users, _, _ = api
    phase = (await c["boss"].post("/roadmap/phases", json={"name": "P", "startMonth": "2026-11-01",
                                                           "endMonth": "2026-11-01"})).json()
    item = (await c["boss"].post("/roadmap/items", json={"phaseId": phase["id"], "title": "ISO pipeline",
                                                         "area": "SALES", "status": "IN_PROGRESS"})).json()
    r = await _submit(c)
    res = (await c["boss"].post(f"/requests/{r['ref']}/approve", json={"itemId": item["id"]})).json()
    assert res["status"] == "IN_PROGRESS" and res["roadmapItem"]["title"] == "ISO pipeline"
    assert (await c["boss"].post(f"/requests/{r['ref']}/approve",
                                 json={"itemId": item["id"], "phaseId": phase["id"]})).status_code == 400


async def test_requests_triage_is_grantable_per_person(api):
    c, users, _, _ = api
    res = await c["boss"].patch(f"/users/{users['admin'].id}", json={"grantedCapabilities": ["requests.triage"]})
    assert res.status_code == 200, res.text
    r = await _submit(c)
    assert (await c["admin"].post(f"/requests/{r['ref']}/status", json={"status": "UNDER_REVIEW"})).status_code == 200
    # A grant nobody may hold by role: a stray role-based check would fail here.
    assert (await c["admin"].get("/requests")).json()["canTriage"] is True
    assert (await c["marketing"].get("/requests")).json()["canTriage"] is False


async def test_validation(api):
    c, _, _, _ = api
    assert (await c["rep"].post("/requests", json={"type": "FEATURE", "area": "SALES", "title": "x",
                                                    "details": "long enough"})).status_code == 400
    assert (await c["rep"].post("/requests", json={"type": "WISH", "area": "SALES", "title": "A title",
                                                    "details": "long enough"})).status_code == 400
    assert (await c["rep"].get("/requests?status=WHATEVER")).status_code == 400
    r = await _submit(c)
    assert (await c["rep"].post(f"/requests/{r['ref']}/comments", json={"body": "   "})).status_code == 400
