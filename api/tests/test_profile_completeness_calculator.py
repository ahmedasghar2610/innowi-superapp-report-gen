"""
Port of profile-completeness.service.spec.ts's calculator tests (PC-U-01..11
and the fullSnapshot 100%-score case). Pure unit tests against the domain
layer — no DB, no FastAPI — mirroring the original's approach exactly.
"""
from __future__ import annotations

import datetime as dt
import types

import pytest

from app.models.enums import (
    AccessCriticality,
    AccessStatus,
    ContactRole,
    DocumentCategory,
    DocumentStatus,
)
from app.modules.merchant_profiling.domain.profile_completeness_calculator import (
    ProfileSnapshot,
    SnapshotBrand,
    SnapshotBrandAsset,
    SnapshotConnection,
    SnapshotContact,
    SnapshotDocument,
    SnapshotLocation,
    calculate_completeness,
)
from app.modules.merchant_profiling.domain.profile_completeness_rules import PROFILE_ALERT_THRESHOLDS


def bare_merchant(**over):
    defaults = dict(
        id="m1", restaurant_name="Kabob Fusion", merchant_code=None, legal_name=None, cuisine_category=None,
        website_url=None, website_platform=None, online_ordering=None, pos_system=None, customer_list_source=None,
        google_ads_budget=None, meta_ads_budget=None, business_goals=None, target_audience=None,
        slow_dayparts=None, seasonal_peaks=None, alcohol_license=None, dietary_certs=None,
        location_count=None, report_frequency=None, report_recipients=None,
        account_health=None, profile_completion_pct=None, next_action=None, open_blockers=None, notes=None,
        onboarding_date=None, go_live_date=None, account_manager_id=None,
    )
    defaults.update(over)
    return types.SimpleNamespace(**defaults)


def make_snapshot(**over) -> ProfileSnapshot:
    defaults = dict(
        merchant=bare_merchant(), verifications=[], documents=[], locations=[], contacts=[],
        connections=[], brand=None, brand_assets=[],
    )
    defaults.update(over)
    return ProfileSnapshot(**defaults)


def full_brand() -> SnapshotBrand:
    return SnapshotBrand(
        brand_colors="Red-#B40314", brand_fonts="Brother", logo_vector=__import__("app.models.enums", fromlist=["YesNo"]).YesNo.YES,
        photo_library_status="Good", menu_format="On-site PDF", signature_dishes="Chapli Kabob",
        tone_of_voice="Warm, family", do_not_say="No alcohol references", content_restrictions="Halal compliance must be accurate",
    )


def conn(id_, status, criticality=AccessCriticality.CRITICAL, expiry=None):
    return SnapshotConnection(id=id_, access_item=f"Item {id_}", criticality=criticality, status=status, expiry=expiry)


def full_snapshot() -> ProfileSnapshot:
    return make_snapshot(
        merchant=bare_merchant(
            legal_name="Kabob Fusion LLC", cuisine_category="Mediterranean / Halal",
            website_url="https://orderkabobfusion.com", website_platform="WordPress",
            online_ordering="Innowi direct", pos_system="Innowi", customer_list_source="POS export",
            google_ads_budget=300.00, meta_ads_budget=150.00, business_goals="Grow direct orders",
            target_audience="Local families, students", slow_dayparts="Weekday afternoons",
            seasonal_peaks="Ramadan", alcohol_license=__import__("app.models.enums", fromlist=["YesNo"]).YesNo.NO,
            dietary_certs="Halal", merchant_code="M-001",
            location_count=1,
        ),
        brand=full_brand(),
        documents=[
            SnapshotDocument(category=DocumentCategory.MENU, status=DocumentStatus.ACTIVE),
            SnapshotDocument(category=DocumentCategory.BRAND, status=DocumentStatus.ACTIVE),
        ],
        brand_assets=[
            SnapshotBrandAsset(type="IMAGE", status="ACTIVE"),
            SnapshotBrandAsset(type="BRAND_GUIDELINES", status="ACTIVE"),
        ],
        locations=[
            SnapshotLocation(
                id="l1", address="41986 Fremont Blvd", city="Fremont", state="CA", zip="94538",
                hours="Mon-Sun 11:00-22:00", timezone="America/Los_Angeles", is_primary=True, nap_status=None,
            )
        ],
        contacts=[
            SnapshotContact(id="c1", role=ContactRole.OWNER, name="Milaad"),
            SnapshotContact(id="c2", role=ContactRole.BILLING, name="Ali"),
            SnapshotContact(id="c3", role=ContactRole.MARKETING, name="Maha"),
            SnapshotContact(id="c4", role=ContactRole.CONTENT_APPROVER, name="Tariq"),
        ],
    )


# PC-U-01
def test_empty_merchant_scores_low_and_reports_missing():
    r = calculate_completeness(make_snapshot())
    assert r.percent >= 0
    assert r.percent < PROFILE_ALERT_THRESHOLDS["criticalBelowPct"]
    assert any(i.area == "CONTACTS" for i in r.missing_information)
    assert any(i.area == "LOCATIONS" for i in r.missing_information)
    required_file_keys = sorted(f.key for f in r.missing_files if f.severity == "REQUIRED")
    assert required_file_keys == ["file:LOGO", "file:MENU"]


# PC-U-02
def test_restaurant_name_required_but_always_present():
    r = calculate_completeness(make_snapshot())
    assert not any(i.key == "field:restaurantName" for i in r.missing_information)


# PC-U-03
def test_internal_ops_fields_excluded_from_score():
    before = calculate_completeness(make_snapshot()).percent
    after = calculate_completeness(
        make_snapshot(merchant=bare_merchant(notes="call back", next_action="chase menu"))
    ).percent
    assert after == before
    assert not any(i.group == "Internal / Ops" for i in calculate_completeness(make_snapshot()).missing_information)


# PC-U-04
def test_budget_fields_scored():
    missing = [i.key for i in calculate_completeness(make_snapshot()).missing_information]
    assert "field:googleAdsBudget" in missing
    assert "field:metaAdsBudget" in missing

    filled = calculate_completeness(make_snapshot(merchant=bare_merchant(google_ads_budget=300.00, meta_ads_budget=150.00)))
    assert "field:googleAdsBudget" not in [i.key for i in filled.missing_information]
    assert filled.percent > calculate_completeness(make_snapshot()).percent


# PC-U-05
def test_zero_budget_counts_as_filled():
    r = calculate_completeness(make_snapshot(merchant=bare_merchant(google_ads_budget=0)))
    assert "field:googleAdsBudget" not in [i.key for i in r.missing_information]


# PC-U-06
def test_uploading_required_file_closes_gap():
    r = calculate_completeness(make_snapshot(documents=[SnapshotDocument(category=DocumentCategory.MENU, status=DocumentStatus.ACTIVE)]))
    required = [f.key for f in r.missing_files if f.severity == "REQUIRED"]
    assert required == ["file:LOGO"]


# PC-U-07
def test_archived_document_does_not_satisfy():
    r = calculate_completeness(make_snapshot(documents=[SnapshotDocument(category=DocumentCategory.MENU, status=DocumentStatus.ARCHIVED)]))
    assert "file:MENU" in [f.key for f in r.missing_files]


# PC-U-08
def test_connections_pending_and_na_excluded():
    r = calculate_completeness(
        make_snapshot(
            connections=[
                conn("a", AccessStatus.VERIFIED),
                conn("b", AccessStatus.RECEIVED),
                conn("c", AccessStatus.REQUESTED),
                conn("d", AccessStatus.NOT_REQUESTED, AccessCriticality.MEDIUM),
                conn("e", AccessStatus.NA),
            ]
        )
    )
    assert sorted(p.id for p in r.pending_connections) == ["c", "d"]
    section = next(s for s in r.sections if s.key == "connections")
    assert section.available == 4
    assert section.earned == 2
    assert [p.id for p in r.pending_connections if p.blocking] == ["c"]


# PC-U-09
def test_section_not_applicable_when_nothing_to_measure():
    r = calculate_completeness(make_snapshot())
    section = next(s for s in r.sections if s.key == "connections")
    assert section.applicable is False
    assert section.percent is None

    complete = calculate_completeness(full_snapshot())
    assert next(s for s in complete.sections if s.key == "connections").applicable is False
    assert complete.percent == 100


# PC-U-10
def test_fully_populated_profile_scores_100():
    assert calculate_completeness(full_snapshot()).percent == 100


# PC-U-10b
def test_brand_section_scored_and_lists_gaps():
    r = calculate_completeness(make_snapshot())
    brand = next(s for s in r.sections if s.key == "brand")
    assert brand.applicable is True
    assert brand.percent == 0
    assert brand.weight == 10
    brand_items = [i for i in r.missing_information if i.area == "BRAND"]
    keys = {i.key for i in brand_items}
    assert {"brand:brandColors", "brand:toneOfVoice", "brand:logoVector"} <= keys
    assert len([i for i in brand_items if i.severity == "REQUIRED"]) == 3
    assert len([i for i in brand_items if i.severity == "RECOMMENDED"]) == 6


# PC-U-10c
def test_logo_vector_no_is_not_satisfied():
    from app.models.enums import YesNo

    brand_no = full_brand()
    brand_no.logo_vector = YesNo.NO
    r = calculate_completeness(make_snapshot(brand=brand_no))
    assert any(i.key == "brand:logoVector" for i in r.missing_information)

    with_yes = calculate_completeness(make_snapshot(brand=full_brand()))
    assert next(s for s in with_yes.sections if s.key == "brand").percent == 100


# PC-U-10e
def test_file_slots_satisfied_by_assets_or_legacy_docs_not_archived():
    none = calculate_completeness(make_snapshot())
    assert sorted(i.key for i in none.missing_files) == sorted(["file:MENU", "file:LOGO", "file:IMAGES", "file:BRAND_GUIDELINES"])
    assert sorted(i.key for i in none.missing_files if i.severity == "REQUIRED") == ["file:LOGO", "file:MENU"]

    via_assets = calculate_completeness(
        make_snapshot(brand_assets=[SnapshotBrandAsset(type="MENU", status="ACTIVE"), SnapshotBrandAsset(type="LOGO", status="ACTIVE")])
    )
    assert len([i for i in via_assets.missing_files if i.severity == "REQUIRED"]) == 0

    via_legacy = calculate_completeness(
        make_snapshot(
            documents=[
                SnapshotDocument(category=DocumentCategory.MENU, status=DocumentStatus.ACTIVE),
                SnapshotDocument(category=DocumentCategory.BRAND, status=DocumentStatus.ACTIVE),
            ]
        )
    )
    assert len([i for i in via_legacy.missing_files if i.severity == "REQUIRED"]) == 0

    archived = calculate_completeness(make_snapshot(brand_assets=[SnapshotBrandAsset(type="LOGO", status="ARCHIVED")]))
    assert any(i.key == "file:LOGO" for i in archived.missing_files)


# PC-U-10f
def test_missing_file_deep_links():
    r = calculate_completeness(make_snapshot())
    assert next(i for i in r.missing_files if i.key == "file:LOGO").area == "BRAND"
    assert next(i for i in r.missing_files if i.key == "file:MENU").area == "FILES"


# PC-U-10d
def test_section_weights_sum_to_100():
    r = calculate_completeness(full_snapshot())
    assert sum(s.weight for s in r.sections) == 100
    assert [s.key for s in r.sections] == ["fields", "files", "connections", "contacts", "locations", "brand"]


# PC-U-11
def test_primary_location_is_measured():
    r = calculate_completeness(
        make_snapshot(
            locations=[
                SnapshotLocation(id="l2", address=None, city=None, state=None, zip=None, hours=None, timezone=None, is_primary=False, nap_status=None),
                SnapshotLocation(id="l1", address="123 Main", city="Fremont", state="CA", zip="94538", hours="9-5", timezone="America/Los_Angeles", is_primary=True, nap_status=None),
            ]
        )
    )
    assert not any(i.key.startswith("location:") for i in r.missing_information)
