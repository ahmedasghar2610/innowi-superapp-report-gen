"""
Websites module — the framework-free parts, ported from the standalone
website-api service's tests/test_websites.py.

That suite ran the full HTTP round-trip against a throwaway SQLite file. This
codebase's model lives in a Postgres schema and the rest of the suite is
deliberately DB-independent, so what is covered here is the logic that owns the
module's actual behaviour: slug generation, the server-derived summary, and the
camelCase mapping. The HTTP round-trip belongs in the integration suite, run
against a seeded Postgres.
"""
from __future__ import annotations

import datetime as dt

import pytest

from app.common.capabilities import has_capability
from app.models.enums import Role
from app.models.website import Website, website_id
from app.modules.websites.mappers import website_to_dto
from app.modules.websites.service import RESERVED_SLUGS, get_at, slugify, summarise
from app.schemas.website import CreateWebsiteDto, UpdateWebsiteDto, WebsiteStatus


# ------------------------------------------------------------------- slugs
@pytest.mark.parametrize(
    "name,expected",
    [
        ("Primo Cafe", "primo-cafe"),
        ("Primo Cafe & Bakery", "primo-cafe-bakery"),
        ("  Rosa  Pizza Co.  ", "rosa-pizza-co"),
        ("Café Zoë", "cafe-zoe"),          # accents are folded, not dropped
        ("!!!", "site"),                    # nothing usable left -> fallback
        ("", "site"),
        ("A" * 120, "a" * 60),              # capped at 60 characters
    ],
)
def test_slugify(name, expected):
    assert slugify(name) == expected


def test_slugify_never_returns_empty():
    for value in ["", "   ", "---", "###", None]:
        assert slugify(value)  # type: ignore[arg-type]


def test_reserved_slugs_cover_the_templates_own_paths():
    for path in ("api", "_next", "static", "images"):
        assert path in RESERVED_SLUGS


# --------------------------------------------------------------- summaries
def test_get_at_reads_dotted_paths():
    values = {"business": {"name": "Primo Cafe", "hours": {"mon": "8-5"}}}
    assert get_at(values, "business.name") == "Primo Cafe"
    assert get_at(values, "business.hours.mon") == "8-5"
    assert get_at(values, "business.missing") is None
    assert get_at(values, "nothing.at.all") is None
    # A non-dict partway down must not raise.
    assert get_at({"business": "a string"}, "business.name") is None


def test_summarise_derives_the_list_columns():
    values = {"business": {"name": " Primo Cafe ", "tagline": "Best diner", "email": "hi@primo.com"}}
    assert summarise(values) == {
        "name": "Primo Cafe",
        "tagline": "Best diner",
        "contact_email": "hi@primo.com",
    }


def test_summarise_falls_back_when_the_form_is_empty():
    assert summarise({}) == {"name": "Untitled website", "tagline": "", "contact_email": ""}


def test_summarise_ignores_a_client_supplied_name():
    """The server owns name/tagline/contactEmail so they can never drift."""
    values = {"name": "Client Chosen", "business": {"name": "Real Name"}}
    assert summarise(values)["name"] == "Real Name"


# ----------------------------------------------------------------- schemas
def test_input_dtos_reject_unknown_keys():
    with pytest.raises(Exception):
        CreateWebsiteDto(values={}, statuss="draft")  # type: ignore[call-arg]
    with pytest.raises(Exception):
        UpdateWebsiteDto(nots="typo")  # type: ignore[call-arg]


def test_create_defaults_to_in_creation_with_no_slug():
    dto = CreateWebsiteDto()
    assert dto.status is WebsiteStatus.IN_CREATION
    assert dto.slug is None
    assert dto.values == {}


def test_update_dto_distinguishes_absent_from_empty():
    """`values={}` clears the tree; omitting it leaves the tree alone."""
    assert "values" not in UpdateWebsiteDto(notes="x").model_dump(exclude_unset=True)
    assert UpdateWebsiteDto(values={}).model_dump(exclude_unset=True)["values"] == {}


# ------------------------------------------------------------------- model
def test_website_id_keeps_the_standalone_services_shape():
    generated = website_id()
    assert generated.startswith("web_")
    assert len(generated) == 20
    assert website_id() != website_id()


def test_website_lives_in_the_marketing_schema():
    assert Website.__table__.schema == "marketing"
    assert Website.__table__.name == "website"
    # `values` is reserved in SQL, so the column is named differently.
    assert Website.__table__.c.values_json.name == "values_json"


# ------------------------------------------------------------------ mapper
def test_mapper_emits_camel_case():
    now = dt.datetime(2026, 9, 16, 12, 0, tzinfo=dt.timezone.utc)
    row = Website(
        id="web_0123456789abcdef", slug="primo-cafe", name="Primo Cafe", tagline="Best diner",
        contact_email="hi@primo.com", status="live", values={"business": {"name": "Primo Cafe"}},
        notes="", created_at=now, updated_at=now,
    )
    dumped = website_to_dto(row).model_dump(mode="json")
    assert dumped["contactEmail"] == "hi@primo.com"
    assert dumped["createdAt"].startswith("2026-09-16")
    assert dumped["status"] == "live"
    assert dumped["values"] == {"business": {"name": "Primo Cafe"}}


def test_mapper_tolerates_nulls_from_older_rows():
    row = Website(id="web_1", slug="s", name="n", tagline=None, contact_email=None,
                  status="draft", values=None, notes=None,
                  created_at=dt.datetime.now(dt.timezone.utc), updated_at=dt.datetime.now(dt.timezone.utc))
    dto = website_to_dto(row)
    assert dto.tagline == "" and dto.contactEmail == "" and dto.notes == "" and dto.values == {}


# ------------------------------------------------------------ capabilities
def test_website_capability_matrix():
    for role in (Role.ADMIN, Role.MARKETING_MANAGER, Role.MARKETING_EXECUTIVE):
        assert has_capability(role, "website.view") is True
        assert has_capability(role, "website.edit") is True

    # Deleting takes a published URL offline, so it stops at manager.
    assert has_capability(Role.MARKETING_EXECUTIVE, "website.delete") is False
    assert has_capability(Role.MARKETING_MANAGER, "website.delete") is True
    assert has_capability(Role.SUPER_ADMIN, "website.delete") is True
    assert has_capability(None, "website.view") is False


# ---------------------------------------------------------------- status
def test_legacy_status_values_are_mapped():
    from app.schemas.website import is_public

    assert CreateWebsiteDto(status="draft").status is WebsiteStatus.IN_CREATION
    assert UpdateWebsiteDto(status="in_review").status is WebsiteStatus.UNDER_REVIEW
    now = dt.datetime.now(dt.timezone.utc)
    old = Website(id="web_1", slug="s", name="n", status="draft", values={}, created_at=now, updated_at=now)
    assert website_to_dto(old).status is WebsiteStatus.IN_CREATION
    assert is_public("live") and is_public("update_required")
    assert not any(is_public(s) for s in ("in_creation", "under_review", "inactive", "draft"))


def test_restricted_record_hides_the_content():
    now = dt.datetime.now(dt.timezone.utc)
    row = Website(id="web_1", slug="s", name="Primo", status="under_review", values={"business": {"phone": "1"}},
                  notes="secret", created_at=now, updated_at=now)
    dto = website_to_dto(row, restricted=True)
    assert dto.restricted and not dto.published and dto.values == {} and dto.notes == ""
    assert website_to_dto(row).published is False


def test_publish_right_is_needed_to_go_public_or_take_down():
    from fastapi import HTTPException

    from app.common.deps import AuthenticatedUser
    from app.modules.websites.router import _require_publish_right

    exec_ = AuthenticatedUser(id="u", email="e", role="MARKETING_EXECUTIVE")
    manager = AuthenticatedUser(id="u", email="e", role="MARKETING_MANAGER")
    _require_publish_right(exec_, current="in_creation", new="under_review")      # working states: fine
    _require_publish_right(exec_, current="live", new="update_required")          # both public: fine
    for current, new in (("under_review", "live"), ("live", "in_creation"), ("in_creation", "inactive")):
        with pytest.raises(HTTPException) as err:
            _require_publish_right(exec_, current=current, new=new)
        assert err.value.status_code == 403 and "publish permission" in err.value.detail
        _require_publish_right(manager, current=current, new=new)
