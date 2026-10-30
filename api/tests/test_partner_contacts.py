"""Partner network (contacts) module — query building, DTO rules, permissions
and the HTTP rules, with the database replaced by in-memory fakes."""
from __future__ import annotations

import datetime as dt
import uuid

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.common.deps import AuthenticatedUser
from app.db.session import get_db
from app.main import app
from app.modules.partner_contacts import router as pc_router
from app.modules.partner_contacts import service
from app.schemas.partner_contacts import (
    CreatePartnerContactDto,
    PartnerContactDto,
    PromotePartnerContactDto,
    UpdatePartnerContactDto,
)

CONTACT_ID = str(uuid.uuid4())
NOW = dt.datetime(2026, 10, 14, 12, 0, tzinfo=dt.timezone.utc)


def _contact(**over):
    row = {
        "id": uuid.UUID(CONTACT_ID), "created_at": NOW, "updated_at": NOW, "status": "new",
        "full_name": "Leigh Cook", "title": "President", "company": "Today Payments", "email": "success@todaypayments.com",
        "phone": "+1 (619) 450-5800", "website": "https://todaypayments.com", "address": None, "partner_type": "Other",
        "notes": None, "tags": None, "met_at": "WSAA 2026", "met_on": None, "source": "business-card",
        "scanned_by": "shayan", "card_id": "dd6475e4", "other_text": None, "photo_url": None, "batch_id": "cards-20261014-abc12345",
        "promoted_lead_id": None, "promoted_at": None, "promoted_by": None,
    }
    row.update(over)
    return row


# ── pure helpers ─────────────────────────────────────────────────────────


def test_where_defaults_to_everything_and_binds_values():
    assert service.build_where(service.ContactFilters()).sql == "true"
    w = service.build_where(service.ContactFilters(q=" 50%_off ", status="new", event="WSAA 2026", promoted=False))
    assert w.params["q"] == "%50\\%\\_off%" and w.params["status"] == "new" and w.params["event"] == "WSAA 2026"
    assert "promoted_lead_id is null" in w.sql
    assert "promoted_lead_id is not null" in service.build_where(service.ContactFilters(promoted=True)).sql


def test_where_never_interpolates_values():
    evil = "x'; drop table public.partner_contacts; --"
    w = service.build_where(service.ContactFilters(q=evil, event=evil, source=evil, status=evil))
    assert evil not in w.sql


def test_contact_dto_from_row():
    out = PartnerContactDto.model_validate(_contact(tags=["iso", "west"])).model_dump(mode="json")
    assert out["id"] == CONTACT_ID and out["fullName"] == "Leigh Cook" and out["metAt"] == "WSAA 2026"
    assert out["tags"] == ["iso", "west"] and out["promotedLeadId"] is None
    assert PartnerContactDto.model_validate(_contact()).tags == []


def test_update_dto_cleans_and_validates():
    d = UpdatePartnerContactDto(email=" Jane@Acme.COM ", title="  ", tags=[" iso ", "iso", ""])
    assert d.email == "jane@acme.com" and d.title is None and d.tags == ["iso"]
    assert d.model_fields_set == {"email", "title", "tags"}
    with pytest.raises(ValidationError):
        UpdatePartnerContactDto(status="hot")
    with pytest.raises(ValidationError):
        UpdatePartnerContactDto(email="not-an-email")
    with pytest.raises(ValidationError):
        UpdatePartnerContactDto(partnerType="Wizard")
    with pytest.raises(ValidationError):
        UpdatePartnerContactDto(promotedLeadId="x")  # not editable


def test_create_dto_requires_name():
    assert CreatePartnerContactDto(fullName=" Sam Lee ").fullName == "Sam Lee"
    with pytest.raises(ValidationError):
        CreatePartnerContactDto(fullName="   ")
    assert PromotePartnerContactDto().partnerType is None
    assert PromotePartnerContactDto(partnerType="Independent sales agent").partnerType == "Independent sales agent"


# ── HTTP layer with fakes ────────────────────────────────────────────────


class FakeSession:
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
    state = {"contact": _contact(), "updates": [], "created": [], "promoted": []}

    async def get_contact(db, cid):
        return state["contact"] if cid == CONTACT_ID else None

    async def update_contact(db, cid, changes):
        state["updates"].append((cid, changes))
        cols = {service.EDITABLE[k]: v for k, v in changes.items()}
        state["contact"] = {**state["contact"], **cols}

    async def create_contact(db, data, actor):
        state["created"].append((data, actor))
        if data.get("email") == "dupe@x.com":
            raise service.ContactError("A contact with that e-mail already exists")
        return _contact(id=uuid.uuid4(), full_name=data["fullName"], email=data.get("email"), source="manual", scanned_by=actor)

    async def promote(db, cid, ptype, actor):
        if not state["contact"].get("email"):
            raise service.ContactError("This contact has no e-mail address.")
        lead = str(uuid.uuid4())
        state["promoted"].append((cid, ptype, actor))
        state["contact"] = {**state["contact"], "promoted_lead_id": uuid.UUID(lead), "promoted_by": actor, "status": "potential_partner"}
        return lead

    for name, fn in {"get_contact": get_contact, "update_contact": update_contact, "create_contact": create_contact, "promote": promote}.items():
        monkeypatch.setattr(service, name, fn)

    user = AuthenticatedUser(id="u1", email="Admin@Innowi.com", role="ADMIN")
    app.dependency_overrides[pc_router._view] = lambda: user
    app.dependency_overrides[pc_router._edit] = lambda: user
    app.dependency_overrides[get_db] = lambda: FakeSession()
    yield TestClient(app), state
    app.dependency_overrides.clear()


def test_requires_login():
    c = TestClient(app)
    assert c.get("/api/v1/partner-contacts").status_code == 401
    assert c.patch(f"/api/v1/partner-contacts/{CONTACT_ID}", json={"status": "vendor"}).status_code == 401
    assert c.post(f"/api/v1/partner-contacts/{CONTACT_ID}/promote", json={}).status_code == 401


def test_get_and_404(client):
    c, _ = client
    r = c.get(f"/api/v1/partner-contacts/{CONTACT_ID}")
    assert r.status_code == 200 and r.json()["fullName"] == "Leigh Cook" and r.json()["source"] == "business-card"
    assert c.get(f"/api/v1/partner-contacts/{uuid.uuid4()}").status_code == 404
    assert c.get("/api/v1/partner-contacts/not-a-uuid").status_code == 404


def test_list_rejects_bad_filters(client):
    c, _ = client
    assert c.get("/api/v1/partner-contacts?status=hot").status_code == 400
    assert c.get("/api/v1/partner-contacts?source=fax").status_code == 400


def test_patch_fields(client):
    c, state = client
    r = c.patch(f"/api/v1/partner-contacts/{CONTACT_ID}", json={"status": "potential_partner", "partnerType": "Payment gateway or processor", "tags": ["west"]})
    assert r.status_code == 200 and r.json()["status"] == "potential_partner" and r.json()["partnerType"] == "Payment gateway or processor"
    assert state["updates"] == [(CONTACT_ID, {"status": "potential_partner", "partnerType": "Payment gateway or processor", "tags": ["west"]})]
    # Clearing a text field sends null; blanking the name is refused.
    assert c.patch(f"/api/v1/partner-contacts/{CONTACT_ID}", json={"notes": None}).status_code == 200
    assert c.patch(f"/api/v1/partner-contacts/{CONTACT_ID}", json={"fullName": "  "}).status_code == 400
    assert c.patch(f"/api/v1/partner-contacts/{CONTACT_ID}", json={}).status_code == 400
    assert c.patch(f"/api/v1/partner-contacts/{CONTACT_ID}", json={"promotedBy": "me"}).status_code in (400, 422)


def test_create_manual_contact(client):
    c, state = client
    r = c.post("/api/v1/partner-contacts", json={"fullName": "Sam Lee", "email": "SAM@acme.com", "metAt": "NRA 2026"})
    assert r.status_code == 201 and r.json()["source"] == "manual" and r.json()["scannedBy"] == "Admin@Innowi.com"
    assert state["created"][0][0]["email"] == "sam@acme.com"
    assert c.post("/api/v1/partner-contacts", json={"fullName": "Dupe", "email": "dupe@x.com"}).status_code == 409
    assert c.post("/api/v1/partner-contacts", json={"fullName": ""}).status_code in (400, 422)


def test_promote_creates_lead_once(client):
    c, state = client
    r = c.post(f"/api/v1/partner-contacts/{CONTACT_ID}/promote", json={"partnerType": "ISO / agent organization"})
    assert r.status_code == 200
    body = r.json()
    assert body["leadId"] and body["contact"]["promotedLeadId"] == body["leadId"] and body["contact"]["status"] == "potential_partner"
    assert state["promoted"] == [(CONTACT_ID, "ISO / agent organization", "Admin@Innowi.com")]
    # Second time: already promoted.
    assert c.post(f"/api/v1/partner-contacts/{CONTACT_ID}/promote", json={}).status_code == 409
    assert c.post(f"/api/v1/partner-contacts/{uuid.uuid4()}/promote", json={}).status_code == 404


def test_promote_needs_email(client):
    c, state = client
    state["contact"] = _contact(email=None)
    r = c.post(f"/api/v1/partner-contacts/{CONTACT_ID}/promote", json={})
    assert r.status_code == 400 and "e-mail" in r.text
    assert state["promoted"] == []
