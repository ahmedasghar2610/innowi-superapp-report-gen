"""
The per-site /admin editor endpoints: password login, the site-scoped token,
and saving/reading/clearing the edited pages. No database — the website row is
an in-memory object and the session's commit/refresh are no-ops.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.common.deps import AuthenticatedUser
from app.common.security.jwt import create_access_token
from app.common.security.password import hash_password
from app.db.session import get_db
from app.main import app
from app.models.website import Website
from app.modules.websites import editor as editor_module
from app.schemas.website import UpdateWebsiteDto

PAGES = {"pages": {"/": {"title": "Home", "html": "<h1>Hi</h1>", "css": ""}}, "site": {"name": "Primo"}}


class FakeSession:
    async def commit(self):
        pass

    async def refresh(self, _obj):
        pass


@pytest.fixture
def site(monkeypatch):
    w = Website(id="web_1", slug="primo-cafe", name="Primo Cafe", values={}, status="live", notes="")
    w.admin_password_hash = hash_password("correct horse")
    w.editor_content = None
    w.editor_updated_at = None
    others = {"web_2": Website(id="web_2", slug="rosa", name="Rosa", values={}, status="draft", notes="")}
    others["web_2"].admin_password_hash = hash_password("another pass")

    async def resolve(_db, key):
        if key in ("web_1", "primo-cafe"):
            return w
        return next((o for o in others.values() if key in (o.id, o.slug)), None)

    monkeypatch.setattr(editor_module.service, "resolve", resolve)
    editor_module._site_login_throttle._fails.clear()

    async def fake_db():
        yield FakeSession()

    app.dependency_overrides[get_db] = fake_db
    yield w
    app.dependency_overrides.clear()


client = TestClient(app)


def login(slug="primo-cafe", password="correct horse"):
    return client.post(f"/api/v1/websites/{slug}/admin/login", json={"password": password})


def auth(token):
    return {"Authorization": f"Bearer {token}"}


def test_login_and_session(site):
    r = login()
    assert r.status_code == 200, r.text
    token = r.json()["token"]
    s = client.get("/api/v1/websites/primo-cafe/admin/session", headers=auth(token))
    assert s.status_code == 200
    assert s.json() == {"websiteId": "web_1", "slug": "primo-cafe", "name": "Primo Cafe", "via": "password"}


def test_wrong_password_and_throttle(site):
    assert login(password="nope").status_code == 401
    for _ in range(9):
        login(password="nope")
    assert login().status_code == 429  # even the right password waits


def test_no_password_means_editing_is_off(site):
    site.admin_password_hash = None
    assert login().status_code == 403


def test_token_only_opens_its_own_website(site):
    token = login().json()["token"]
    assert client.get("/api/v1/websites/rosa/admin/session", headers=auth(token)).status_code == 401
    assert client.put("/api/v1/websites/rosa/content", json=PAGES, headers=auth(token)).status_code == 401


def test_changing_the_password_signs_everyone_out(site):
    token = login().json()["token"]
    site.admin_password_hash = hash_password("a new password")
    assert client.get("/api/v1/websites/primo-cafe/admin/session", headers=auth(token)).status_code == 401


def test_site_token_is_not_a_staff_login(site):
    token = login().json()["token"]
    # Staff-only routes reject it outright.
    assert client.get("/api/v1/websites", headers=auth(token)).status_code == 401


def test_save_read_and_rebuild(site):
    token = login().json()["token"]
    assert client.get("/api/v1/websites/primo-cafe/content").status_code == 404
    r = client.put("/api/v1/websites/primo-cafe/content", json=PAGES, headers=auth(token))
    assert r.status_code == 200, r.text
    assert site.editor_content == PAGES and site.editor_updated_at is not None
    got = client.get("/api/v1/websites/primo-cafe/content")  # public
    assert got.status_code == 200 and got.json()["pages"]["/"]["html"] == "<h1>Hi</h1>"
    assert client.delete("/api/v1/websites/primo-cafe/content", headers=auth(token)).status_code == 204
    assert site.editor_content is None
    assert client.get("/api/v1/websites/primo-cafe/content").status_code == 404


def test_save_requires_home_page_and_auth(site):
    token = login().json()["token"]
    bad = {"pages": {"/about": {"title": "About", "html": ""}}, "site": {}}
    assert client.put("/api/v1/websites/primo-cafe/content", json=bad, headers=auth(token)).status_code == 400
    assert client.put("/api/v1/websites/primo-cafe/content", json=PAGES).status_code == 401


def test_staff_with_edit_rights_can_rebuild(site, monkeypatch):
    async def staff(_request, _credentials, _db):
        return AuthenticatedUser(id="u1", email="a@b.c", role="SUPER_ADMIN")

    monkeypatch.setattr(editor_module, "get_current_user", staff)
    staff_token, _ = create_access_token({"sub": "u1"})
    site.editor_content = PAGES
    r = client.delete("/api/v1/websites/primo-cafe/content", headers=auth(staff_token))
    assert r.status_code == 204, r.text


def test_admin_password_validation():
    with pytest.raises(ValueError):
        UpdateWebsiteDto(adminPassword="short")
    assert UpdateWebsiteDto(adminPassword="").adminPassword == ""
    assert UpdateWebsiteDto(adminPassword="long enough").adminPassword == "long enough"


# ------------------------------------------------ form <-> visual binding ----

BOUND_HOME = (
    '<h1 data-bind="hero.headline">Fresh pizza</h1>'
    '<p data-bind="hero.subtext">Since 1998</p>'
    '<section><p>Added in the editor</p></section>'
)


def test_visual_save_writes_back_and_form_changes_reach_the_page(site):
    site.values = {"hero": {"headline": "Fresh pizza", "subtext": "Since 1998"}, "business": {"name": "Primo Cafe"}}
    token = login().json()["token"]

    # First save: straight from the snapshot — nothing changed, nothing written back.
    body = {"pages": {"/": {"title": "Home", "html": BOUND_HOME, "css": ""}}, "site": {}}
    saved = client.put("/api/v1/websites/primo-cafe/content", json=body, headers=auth(token)).json()
    assert site.values["hero"]["subtext"] == "Since 1998"
    stamped = saved["pages"]["/"]["html"]
    assert "data-bind-t=" in stamped and "Added in the editor" in stamped

    # Edit the subtext in the visual editor and save: it lands in the form answers.
    edited = stamped.replace(">Since 1998<", ">Wood-fired since 1998<")
    body["pages"]["/"]["html"] = edited
    client.put("/api/v1/websites/primo-cafe/content", json=body, headers=auth(token))
    assert site.values["hero"]["subtext"] == "Wood-fired since 1998"

    # Change the headline in the form: the public read of the edited page shows it,
    # and the section added only in the visual editor is still there.
    site.values["hero"]["headline"] = "Fresh pizza, all day"
    page = client.get("/api/v1/websites/primo-cafe/content").json()["pages"]["/"]["html"]
    assert ">Fresh pizza, all day</h1>" in page and "Wood-fired since 1998" in page and "Added in the editor" in page


def test_unbound_pages_behave_as_before(site):
    token = login().json()["token"]
    client.put("/api/v1/websites/primo-cafe/content", json=PAGES, headers=auth(token))
    assert client.get("/api/v1/websites/primo-cafe/content").json()["pages"]["/"]["html"] == "<h1>Hi</h1>"


def test_visual_edit_of_hours_on_a_linked_site_stays_on_the_website(site):
    from app.models.enums import ContactRole
    from app.models.profiling import Contact, Location, Merchant

    m = Merchant(id="m1", restaurant_name="Primo Cafe")
    m.locations = [Location(id="l1", merchant_id="m1", address="1 Main St", city="Lancaster", state="CA", zip="93536",
                            hours="Mon–Fri 9am–5pm", is_primary=True)]
    m.contacts = [Contact(id="c1", merchant_id="m1", role=ContactRole.OWNER, phone="(661) 555-0100")]
    site.merchant, site.merchant_id = m, "m1"
    site.values = {"business": {"name": "Primo Cafe"}, "hero": {"headline": "Hi"}}
    token = login().json()["token"]

    home = '<p data-bind="business.hours">Mon–Fri 9am–5pm</p><h1 data-bind="hero.headline">Hi</h1>'
    body = {"pages": {"/": {"title": "Home", "html": home, "css": ""}}, "site": {}}
    stamped = client.put("/api/v1/websites/primo-cafe/content", json=body, headers=auth(token)).json()["pages"]["/"]["html"]
    assert "data-bind-profile" in stamped

    body["pages"]["/"]["html"] = stamped.replace(">Mon–Fri 9am–5pm<", ">Mon–Sun 9am–5pm<")
    client.put("/api/v1/websites/primo-cafe/content", json=body, headers=auth(token))
    assert m.locations[0].hours == "Mon–Fri 9am–5pm"          # Profile NOT changed
    assert site.profile_overrides["business.hours"] == {"value": "Mon–Sun 9am–5pm", "base": "Mon–Fri 9am–5pm"}
    page = client.get("/api/v1/websites/primo-cafe/content").json()["pages"]["/"]["html"]
    assert "Mon–Sun 9am–5pm" in page                           # the site shows its own value

    # The Profile's hours are edited later: the Profile wins on the site again.
    m.locations[0].hours = "Daily 8am–8pm"
    page = client.get("/api/v1/websites/primo-cafe/content").json()["pages"]["/"]["html"]
    assert "Daily 8am–8pm" in page and "Mon–Sun 9am–5pm" not in page


def test_unpublished_pages_are_hidden_from_the_public(site):
    token = login().json()["token"]
    client.put("/api/v1/websites/primo-cafe/content", json=PAGES, headers=auth(token))
    site.status = "under_review"
    assert client.get("/api/v1/websites/primo-cafe/content").status_code == 404          # anonymous
    assert client.get("/api/v1/websites/primo-cafe/content", headers=auth(token)).status_code == 200  # editor session
    from app.modules.websites.visibility import create_preview_token

    preview, _ = create_preview_token(site)
    assert client.get(f"/api/v1/websites/primo-cafe/content?preview={preview}").status_code == 200
    other, _ = create_preview_token(type("W", (), {"id": "web_2"})())
    assert client.get(f"/api/v1/websites/primo-cafe/content?preview={other}").status_code == 404  # other site's link
