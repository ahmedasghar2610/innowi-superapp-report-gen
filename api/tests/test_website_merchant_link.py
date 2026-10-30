"""Website <-> Merchant link: the pure rules (no DB) plus route registration."""
from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app
from app.models.enums import ContactRole
from app.models.profiling import Contact, Location, Merchant
from app.models.website import Website
from app.modules.websites import merchant_link as ml

client = TestClient(app)


def _merchant(**kw) -> Merchant:
    m = Merchant(id="m1", restaurant_name=kw.get("name", "Primo Cafe"))
    m.locations = []
    m.contacts = []
    if kw.get("location", True):
        m.locations.append(
            Location(id="l1", merchant_id="m1", address="12 Main St", city="Lancaster", state="CA", zip="93536",
                     hours="Mon–Sun 9–9", is_primary=True)
        )
    if kw.get("contact", True):
        m.contacts.append(Contact(id="c1", merchant_id="m1", role=ContactRole.OWNER, phone="(661) 555-0100",
                                  email="owner@primo.cafe"))
    return m


def _website(values: dict, **kw) -> Website:
    w = Website(id="web_1", slug="primo-cafe", name="Primo Cafe", values=values, status=kw.get("status", "draft"))
    w.merchant = None
    return w


# ------------------------------------------------------------ profile ----
def test_profile_values_and_governed_fields():
    m = _merchant()
    pv = ml.profile_values(m)
    assert pv["business.name"] == "Primo Cafe"
    assert pv["business.city"] == "Lancaster, CA 93536"
    assert pv["business.phone"] == "(661) 555-0100"
    assert set(ml.governed_fields(m)) == set(ml.PROFILE_FIELDS)

    bare = _merchant(location=False, contact=False)
    assert ml.governed_fields(bare) == ["business.name"]


def test_overlay_writes_profile_over_site_but_keeps_other_answers():
    m = _merchant()
    out = ml.overlay({"business": {"name": "Old Name", "phone": ""}, "hero": {"headline": "Hi"}}, m)
    assert out["business"]["name"] == "Primo Cafe"
    assert out["business"]["phone"] == "(661) 555-0100"
    assert out["hero"]["headline"] == "Hi"


# ---------------------------------------------------------- conflicts ----
def test_conflicts_only_where_both_sides_have_different_values():
    m = _merchant()
    w = _website({"business": {
        "name": "primo cafe",              # same, case-insensitive -> no conflict
        "phone": "661-555-0100",           # same digits -> no conflict
        "address": "99 Other Rd",          # differs -> conflict
        "city": "",                        # site empty -> no conflict
        "hours": "Mon–Fri 8–5",            # differs -> conflict
    }})
    got = {c.field: c for c in ml.conflicts(w, m)}
    assert set(got) == {"business.address", "business.hours"}
    assert got["business.address"].profileValue == "12 Main St"
    assert got["business.address"].websiteValue == "99 Other Rd"


# ---------------------------------------------------------------- link ----
class _FakeDb:
    async def commit(self): ...
    async def refresh(self, _obj): ...


import pytest


@pytest.mark.asyncio
async def test_link_never_changes_the_profile():
    m = _merchant()
    w = _website({"business": {"name": "Primo Cafe", "address": "99 Other Rd", "hours": "Mon–Fri 8–5",
                               "email": "hello@primo.cafe"}}, status="live")
    await ml.link(_FakeDb(), w, m, {"business.address": "website", "business.hours": "profile"})

    assert w.merchant_id == "m1"
    # "website" -> the site keeps its value, the Profile is untouched
    assert m.locations[0].address == "12 Main St"
    assert w.profile_overrides == {"business.address": {"value": "99 Other Rd", "base": "12 Main St"}}
    w.merchant = m
    assert ml.effective_values(w, m)["business"]["address"] == "99 Other Rd"
    # "profile" -> site shows the Profile value
    assert w.values["business"]["hours"] == "Mon–Sun 9–9"
    # empty on the site -> filled from the Profile
    assert w.values["business"]["city"] == "Lancaster, CA 93536"
    assert w.values["business"]["phone"] == "(661) 555-0100"
    # both have a value, no choice -> Profile shown
    assert w.values["business"]["email"] == "owner@primo.cafe"
    assert m.website_url.endswith("/primo-cafe")
    assert m.website_platform == "Innowi"


@pytest.mark.asyncio
async def test_link_does_not_fill_an_empty_profile_from_the_site():
    m = _merchant(location=False, contact=False)
    w = _website({"business": {"name": "Primo Cafe", "phone": "555-1234", "address": "1 Way", "hours": "9-5"}})
    await ml.link(_FakeDb(), w, m)
    assert m.locations == [] and m.contacts == []
    # the site keeps its own values for fields the Profile doesn't have
    assert w.values["business"]["phone"] == "555-1234" and w.values["business"]["address"] == "1 Way"
    assert m.website_url.endswith("/primo-cafe") and m.website_platform == "Innowi"


# ------------------------------------------------------ website-only edits ----
def test_site_edit_is_kept_on_the_website_until_the_profile_changes():
    m = _merchant()
    w = _website({"business": {"name": "Primo Cafe"}})
    w.merchant_id, w.merchant = "m1", m

    changed = ml.record_site_edits(w, m, {"business.hours": "Mon–Sat 10–10", "business.phone": "661.555.0100"})
    assert changed == ["business.hours"]                       # phone: same digits -> no change
    assert m.locations[0].hours == "Mon–Sun 9–9"               # Profile untouched
    assert ml.effective_values(w, m)["business"]["hours"] == "Mon–Sat 10–10"

    # Profile edited later -> the Profile wins again
    m.locations[0].hours = "Mon–Sun 8–8"
    assert ml.active_overrides(w, m) == {}
    assert ml.effective_values(w, m)["business"]["hours"] == "Mon–Sun 8–8"


def test_site_edit_back_to_the_profile_value_clears_it():
    m = _merchant()
    w = _website({})
    w.merchant = m
    ml.record_site_edits(w, m, {"business.name": "Primo Cafe & Bar"})
    assert ml.active_overrides(w, m) == {"business.name": "Primo Cafe & Bar"}
    ml.record_site_edits(w, m, {"business.name": "Primo Cafe"})
    assert ml.active_overrides(w, m) == {} and w.profile_overrides == {}


def test_site_edit_of_a_field_the_profile_lacks_is_not_an_override():
    m = _merchant(contact=False)
    w = _website({})
    assert ml.record_site_edits(w, m, {"business.phone": "555-9999"}) == []
    assert not w.profile_overrides


@pytest.mark.asyncio
async def test_unlink_keeps_what_the_site_showed():
    m = _merchant()
    w = _website({"business": {"name": "Primo Cafe", "hours": "old"}})
    await ml.link(_FakeDb(), w, m)
    w.merchant = m
    ml.record_site_edits(w, m, {"business.hours": "Site only 10–4"})
    await ml.unlink(_FakeDb(), w)
    assert w.values["business"]["hours"] == "Site only 10–4"
    assert w.values["business"]["phone"] == "(661) 555-0100"
    assert w.profile_overrides == {}


@pytest.mark.asyncio
async def test_unlink_clears_merchant_url_only_when_it_pointed_at_this_site():
    m = _merchant()
    w = _website({"business": {"name": "Primo Cafe"}}, status="live")
    await ml.link(_FakeDb(), w, m)
    w.merchant = m
    await ml.unlink(_FakeDb(), w)
    assert w.merchant_id is None and m.website_url is None

    m.website_url = "https://theirs.example"
    w.merchant_id, w.merchant = "m1", m
    await ml.unlink(_FakeDb(), w)
    assert m.website_url == "https://theirs.example"


# --------------------------------------------------------------- routes ----
def test_link_routes_registered():
    schema = app.openapi()
    paths = {(m.upper(), path) for path, ops in schema["paths"].items() for m in ops}
    for expected in [
        ("GET", "/api/v1/websites/{key}/merchant-suggestions"),
        ("GET", "/api/v1/websites/{key}/link-preview"),
        ("POST", "/api/v1/websites/{key}/link"),
        ("DELETE", "/api/v1/websites/{key}/link"),
        ("POST", "/api/v1/websites/{key}/merchant"),
        ("GET", "/api/v1/merchants/{merchant_id}/websites"),
        ("GET", "/api/v1/merchants/{merchant_id}/website-prefill"),
    ]:
        assert expected in paths, expected


def test_link_routes_require_auth():
    assert client.get("/api/v1/websites/web_x/merchant-suggestions").status_code == 401
    assert client.post("/api/v1/websites/web_x/link", json={"merchantId": "m1"}).status_code == 401
    assert client.get("/api/v1/merchants/m1/websites").status_code == 401


def test_write_to_profile_saves_only_real_changes():
    m = _merchant()
    changed = ml.write_to_profile(m, {
        "business.phone": "661.555.0100",            # same digits -> no change
        "business.hours": "Mon–Sun 9–10",            # changed
        "business.city": "Palmdale, CA 93550",       # split into city / state / zip
        "business.email": "",                        # empty -> ignored
        "hero.headline": "not a Profile field",      # ignored
    })
    assert sorted(changed) == ["business.city", "business.hours"]
    loc = m.locations[0]
    assert (loc.hours, loc.city, loc.state, loc.zip) == ("Mon–Sun 9–10", "Palmdale", "CA", "93550")
    assert m.contacts[0].email == "owner@primo.cafe"


class _RecordingDb(_FakeDb):
    def __init__(self):
        self.added = []

    def add(self, obj):
        self.added.append(obj)
        if getattr(obj, "id", None) is None:
            obj.id = f"id{len(self.added)}"

    async def flush(self): ...


@pytest.mark.asyncio
async def test_merchant_from_website_records_its_source():
    db = _RecordingDb()
    w = _website({"business": {"name": "Primo Cafe"}})
    m = await ml.merchant_from_website(db, w)
    assert (m.source, m.source_detail) == ("WEBSITE", "/primo-cafe")
