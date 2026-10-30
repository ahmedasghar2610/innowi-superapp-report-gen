"""Partner leads module — query building, DTO validation, permissions, and the
PATCH / notes rules, with the database replaced by in-memory fakes."""
from __future__ import annotations

import datetime as dt
import uuid

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.common.capabilities import has_capability
from app.common.deps import AuthenticatedUser
from app.db.session import get_db
from app.main import app
from app.models.enums import Role
from app.modules.partner_leads import router as pl_router
from app.modules.partner_leads import service
from app.schemas.partner_leads import CreatePartnerLeadNoteDto, PartnerLeadDto, UpdatePartnerLeadDto

LEAD_ID = str(uuid.uuid4())
NOW = dt.datetime(2026, 10, 11, 12, 0, tzinfo=dt.timezone.utc)


def _lead(**over):
    row = {
        "id": uuid.UUID(LEAD_ID), "created_at": NOW, "updated_at": NOW, "status": "new", "full_name": "Jane Doe",
        "title": "VP", "company": "Acme ISO", "email": "jane@example.com", "phone": None, "website": None,
        "partner_type": "ISO", "region": "NV", "portfolio_size": "51–250", "restaurant_share": None, "processors": None,
        "interests": None, "timeline": None, "heard_about": None, "message": None, "wants_call": True,
        "source_cta": "hero-apply", "landing_url": None, "referrer": None, "utm_source": None, "utm_medium": None,
        "utm_campaign": None, "utm_term": None, "utm_content": None, "assigned_to": None, "assigned_at": None,
        "last_contacted_at": None, "notified_at": None, "teams_notified_at": NOW,
    }
    row.update(over)
    return row


# ── pure helpers ─────────────────────────────────────────────────────────


def test_where_hides_spam_by_default_and_binds_everything():
    w = service.build_where(service.LeadFilters())
    assert w.sql == "status <> 'spam'" and w.params == {}

    w = service.build_where(service.LeadFilters(include_spam=True))
    assert w.sql == "true"

    w = service.build_where(service.LeadFilters(status="spam"))
    assert "status = :status" in w.sql and "<> 'spam'" not in w.sql


def test_where_search_escapes_like_wildcards():
    w = service.build_where(service.LeadFilters(q=" 50%_off "))
    assert w.params["q"] == "%50\\%\\_off%"
    assert "ilike :q" in w.sql


def test_where_unassigned_and_owner():
    assert "assigned_to is null" in service.build_where(service.LeadFilters(assigned_to="unassigned")).sql
    w = service.build_where(service.LeadFilters(assigned_to="Freddie@Innowi.com"))
    assert w.params["assigned_to"] == "freddie@innowi.com"


def test_where_never_interpolates_values():
    evil = "x'; drop table public.partner_leads; --"
    w = service.build_where(service.LeadFilters(q=evil, source=evil, assigned_to=evil))
    assert evil not in w.sql


def test_parse_uuid():
    assert service.parse_uuid(LEAD_ID) == LEAD_ID
    assert service.parse_uuid("not-a-uuid") is None


def test_lead_dto_from_row():
    dto = PartnerLeadDto.model_validate(_lead(interests=["White-label"]))
    out = dto.model_dump(mode="json")
    assert out["id"] == LEAD_ID and out["fullName"] == "Jane Doe" and out["interests"] == ["White-label"]
    assert PartnerLeadDto.model_validate(_lead()).interests == []


def test_update_dto_rules():
    assert UpdatePartnerLeadDto(status="won").model_fields_set == {"status"}
    assert UpdatePartnerLeadDto(assignedTo=None).model_fields_set == {"assignedTo"}
    with pytest.raises(ValidationError):
        UpdatePartnerLeadDto(status="maybe")
    with pytest.raises(ValidationError):
        UpdatePartnerLeadDto(email="x@y.com")  # only status / owner can change


def test_note_dto_strips_and_rejects_blank():
    assert CreatePartnerLeadNoteDto(body="  hi  ").body == "hi"
    with pytest.raises(ValidationError):
        CreatePartnerLeadNoteDto(body="   ")


def test_capabilities():
    # Admin + Sales Executive manage partner leads; Marketing Manager can only look.
    for role in (Role.SUPER_ADMIN, Role.ADMIN, Role.SALES_EXECUTIVE):
        assert has_capability(role, "partners.view") and has_capability(role, "partners.edit")
    assert has_capability(Role.MARKETING_MANAGER, "partners.view")
    assert not has_capability(Role.MARKETING_MANAGER, "partners.edit")
    # Marketing Executive: marketing only.
    assert not has_capability(Role.MARKETING_EXECUTIVE, "partners.view")
    assert not has_capability("CLIENT", "partners.view")


def test_sales_executive_has_no_marketing_access():
    from app.common.capabilities import CAPABILITIES

    # Partner leads, plus their OWN Salesforce records (sales.view without sales.viewAll).
    for cap in CAPABILITIES:
        # Ops CRM (2026-10-19): sales also see tickets and the Library, never the vault.
        expected = cap in ("partners.view", "partners.edit", "sales.view", "quotes.view", "quotes.edit",
                           "assistant.use", "roadmap.view", "ticket.view", "library.view",
                           "churn.view", "churn.manage",
                           "organizations.view", "organizations.manage", "deals.view", "deals.manage",
                           # Requests (2026-10-24): everyone sends and upvotes; triage is per person.
                           "requests.view", "requests.create")
        assert has_capability(Role.SALES_EXECUTIVE, cap) is expected, cap


def test_sales_manager_sees_all_sales_but_no_marketing():
    from app.common.capabilities import CAPABILITIES

    for cap in CAPABILITIES:
        expected = cap in ("partners.view", "partners.edit", "sales.view", "sales.viewAll",
                           "quotes.view", "quotes.edit", "quotes.discount", "assistant.use", "roadmap.view",
                           "ticket.view", "library.view", "churn.view", "churn.manage", "churn.import",
                           "organizations.view", "organizations.manage", "deals.view", "deals.manage",
                           "requests.view", "requests.create",
                           # Partner ladder (2026-10-27): the sales lead hands partners / agents out.
                           "organizations.assign")
        assert has_capability(Role.SALES_MANAGER, cap) is expected, cap


def test_sales_roles_never_reach_the_credentials_vault_even_when_granted():
    for role in (Role.SALES_EXECUTIVE, Role.SALES_MANAGER):
        for cap in ("credentials.view", "credentials.reveal", "credentials.manage"):
            assert has_capability(role, cap, grants=["credentials.reveal"]) is False, (role, cap)
    # The same grant still works for a marketing role.
    assert has_capability(Role.MARKETING_EXECUTIVE, "credentials.reveal", grants=["credentials.reveal"]) is True


# ── HTTP layer with fakes ────────────────────────────────────────────────


class FakeSession:
    """Stands in for AsyncSession; only the audit decorator touches it here."""

    def __init__(self):
        self.added = []

    def add(self, obj):
        self.added.append(obj)

    async def commit(self):
        pass

    async def rollback(self):
        pass


@pytest.fixture
def client(monkeypatch):
    state = {"lead": _lead(), "updates": [], "notes": [], "notified": []}
    team = [
        {"email": "freddie@innowi.com", "name": "Freddie", "role": "member", "assignable": True, "receives_new_leads": False,
         "status": "active"},
        {"email": "partners@innowi.com", "name": None, "role": "admin", "assignable": False, "receives_new_leads": False,
         "status": "active"},
        # A past owner with no Super App login: listed for the name, never assignable.
        {"email": "gone@innowi.com", "name": "Gone", "role": "member", "assignable": True, "receives_new_leads": False,
         "status": "no_login"},
    ]

    async def get_lead(db, lead_id):
        return state["lead"] if lead_id == LEAD_ID else None

    async def get_team(db):
        return team

    async def update_lead(db, lead_id, changes, actor):
        state["updates"].append((lead_id, changes, actor))
        state["lead"] = {**state["lead"], **changes}

    async def add_note(db, lead_id, author, body):
        note = {"id": uuid.uuid4(), "author_email": author, "body": body, "created_at": NOW}
        state["notes"].append(note)
        return note

    async def no_rows(db, lead_id):
        return []

    async def notify_assigned(lead_id):
        state["notified"].append(lead_id)
        return True

    for name, fn in {"get_lead": get_lead, "get_team": get_team, "update_lead": update_lead, "add_note": add_note,
                     "get_notes": no_rows, "get_events": no_rows, "notify_assigned": notify_assigned}.items():
        monkeypatch.setattr(service, name, fn)

    user = AuthenticatedUser(id="u1", email="Admin@Innowi.com", role="ADMIN")
    app.dependency_overrides[pl_router._view] = lambda: user
    app.dependency_overrides[pl_router._edit] = lambda: user
    app.dependency_overrides[get_db] = lambda: FakeSession()
    yield TestClient(app), state
    app.dependency_overrides.clear()


def test_requires_login():
    c = TestClient(app)
    assert c.get("/api/v1/partner-leads").status_code == 401
    assert c.patch(f"/api/v1/partner-leads/{LEAD_ID}", json={"status": "won"}).status_code == 401


def test_get_detail_and_404(client):
    c, _ = client
    r = c.get(f"/api/v1/partner-leads/{LEAD_ID}")
    assert r.status_code == 200 and r.json()["fullName"] == "Jane Doe" and r.json()["notes"] == []
    assert c.get(f"/api/v1/partner-leads/{uuid.uuid4()}").status_code == 404
    assert c.get("/api/v1/partner-leads/not-a-uuid").status_code == 404


def test_patch_status(client):
    c, state = client
    r = c.patch(f"/api/v1/partner-leads/{LEAD_ID}", json={"status": "contacted"})
    assert r.status_code == 200 and r.json()["status"] == "contacted"
    assert state["updates"] == [(LEAD_ID, {"status": "contacted"}, "Admin@Innowi.com")]
    assert state["notified"] == []  # a status change alone doesn't notify


def test_patch_assign_rules(client):
    c, state = client
    assert c.patch(f"/api/v1/partner-leads/{LEAD_ID}", json={"assignedTo": "stranger@x.com"}).status_code == 400
    assert c.patch(f"/api/v1/partner-leads/{LEAD_ID}", json={"assignedTo": "partners@innowi.com"}).status_code == 400
    assert c.patch(f"/api/v1/partner-leads/{LEAD_ID}", json={"assignedTo": "gone@innowi.com"}).status_code == 400
    r = c.patch(f"/api/v1/partner-leads/{LEAD_ID}", json={"assignedTo": " Freddie@Innowi.com "})
    assert r.status_code == 200 and r.json()["assignedTo"] == "freddie@innowi.com"
    r = c.patch(f"/api/v1/partner-leads/{LEAD_ID}", json={"assignedTo": None})
    assert r.status_code == 200 and r.json()["assignedTo"] is None
    assert [u[1] for u in state["updates"]] == [{"assigned_to": "freddie@innowi.com"}, {"assigned_to": None}]
    # The new owner is notified once; unassigning notifies nobody.
    assert state["notified"] == [LEAD_ID]


def test_patch_rejects_empty_and_unknown_fields(client):
    c, _ = client
    assert c.patch(f"/api/v1/partner-leads/{LEAD_ID}", json={}).status_code == 400
    assert c.patch(f"/api/v1/partner-leads/{LEAD_ID}", json={"status": None}).status_code == 400
    assert c.patch(f"/api/v1/partner-leads/{LEAD_ID}", json={"company": "x"}).status_code in (400, 422)


def test_add_note(client):
    c, state = client
    r = c.post(f"/api/v1/partner-leads/{LEAD_ID}/notes", json={"body": " Called, left voicemail "})
    assert r.status_code == 201 and r.json()["body"] == "Called, left voicemail"
    assert state["notes"][0]["author_email"] == "Admin@Innowi.com"
    assert c.post(f"/api/v1/partner-leads/{uuid.uuid4()}/notes", json={"body": "x"}).status_code == 404


def test_list_rejects_bad_status(client):
    c, _ = client
    assert c.get("/api/v1/partner-leads?status=maybe").status_code == 400


async def test_notify_assigned_never_raises_and_can_be_disabled(monkeypatch):
    from app.config import get_settings

    def boom(*a, **k):
        raise OSError("network down")

    monkeypatch.setattr(service, "_post_json", boom)
    assert await service.notify_assigned(LEAD_ID) is False

    calls = []
    monkeypatch.setattr(service, "_post_json", lambda url, key, payload, timeout: calls.append((url, payload)) or 200)
    assert await service.notify_assigned(LEAD_ID) is True
    assert calls[0][0].endswith("/functions/v1/partner-lead-assigned") and calls[0][1] == {"lead_id": LEAD_ID}

    monkeypatch.setattr(get_settings(), "PARTNER_LEADS_NOTIFY_URL", "")
    assert await service.notify_assigned(LEAD_ID) is False
    assert len(calls) == 1
