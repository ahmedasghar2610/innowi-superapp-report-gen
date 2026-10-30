"""
Port of profile-completeness.calculator.ts. Pure function: same input snapshot,
same result — no ORM/DB access here, so it is directly unit-testable exactly
like the original.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional

from app.models.enums import (
    AccessCriticality,
    AccessStatus,
    ContactRole,
    DocumentCategory,
    DocumentStatus,
    VerificationConfidence,
    YesNo,
)
from app.modules.merchant_profiling.domain.profile_field_registry import PROFILE_FIELDS
from app.modules.merchant_profiling.domain.profile_completeness_rules import (
    BLOCKING_CRITICALITIES,
    BRAND_FIELD_LABELS,
    COMPLETENESS_SECTIONS,
    CONNECTED_STATUSES,
    CONTACT_ROLE_LABELS,
    COUNTABLE_ASSET_STATUS,
    COUNTABLE_DOCUMENT_STATUS,
    LOCATION_FIELD_LABELS,
    NOT_APPLICABLE_STATUSES,
    OPTIONAL_FIELD_WEIGHT,
    RECOMMENDED_BRAND_FIELDS,
    RECOMMENDED_CONTACT_ROLES,
    RECOMMENDED_FILE_SLOTS,
    RECOMMENDED_LOCATION_FIELDS,
    REQUIRED_BRAND_FIELDS,
    REQUIRED_CONTACT_ROLES,
    REQUIRED_FIELD_WEIGHT,
    REQUIRED_FILE_SLOTS,
    REQUIRED_LOCATION_FIELDS,
    SCORED_FIELD_GROUPS,
)

BLOCKING_CRITICALITIES_SET = set(BLOCKING_CRITICALITIES)


# ---- Input dataclasses --------------------------------------------------------
@dataclass
class SnapshotDocument:
    category: DocumentCategory
    status: DocumentStatus


@dataclass
class SnapshotBrandAsset:
    type: str
    status: Optional[str]


@dataclass
class SnapshotLocation:
    id: str
    address: Optional[str]
    city: Optional[str]
    state: Optional[str]
    zip: Optional[str]
    hours: Optional[str]
    timezone: Optional[str]
    is_primary: bool
    nap_status: Optional[str]

    def __getitem__(self, key: str):
        return getattr(self, key)


@dataclass
class SnapshotContact:
    id: str
    role: ContactRole
    name: Optional[str]


@dataclass
class SnapshotConnection:
    id: str
    access_item: str
    criticality: AccessCriticality
    status: AccessStatus
    expiry: Optional[datetime]


@dataclass
class SnapshotBrand:
    brand_colors: Optional[str]
    brand_fonts: Optional[str]
    logo_vector: Optional[YesNo]
    photo_library_status: Optional[str]
    menu_format: Optional[str]
    signature_dishes: Optional[str]
    tone_of_voice: Optional[str]
    do_not_say: Optional[str]
    content_restrictions: Optional[str]

    _KEY_MAP = {
        "brandColors": "brand_colors",
        "brandFonts": "brand_fonts",
        "logoVector": "logo_vector",
        "photoLibraryStatus": "photo_library_status",
        "menuFormat": "menu_format",
        "signatureDishes": "signature_dishes",
        "toneOfVoice": "tone_of_voice",
        "doNotSay": "do_not_say",
        "contentRestrictions": "content_restrictions",
    }

    def __getitem__(self, camel_key: str):
        return getattr(self, self._KEY_MAP[camel_key])


@dataclass
class ProfileSnapshot:
    merchant: object  # a Merchant ORM row or any object with the registry's column attrs
    verifications: list  # list of FieldVerification-like objects with .field_name/.confidence/.verified_at/.verified_by
    documents: list[SnapshotDocument]
    locations: list[SnapshotLocation]
    contacts: list[SnapshotContact]
    connections: list[SnapshotConnection]
    brand: Optional[SnapshotBrand]
    brand_assets: list[SnapshotBrandAsset]


# ---- Output dataclasses --------------------------------------------------------
@dataclass
class MissingItem:
    key: str
    label: str
    area: str
    severity: str
    group: Optional[str] = None


@dataclass
class PendingConnection:
    id: str
    access_item: str
    criticality: AccessCriticality
    status: AccessStatus
    blocking: bool


@dataclass
class ExpiredConnection:
    id: str
    access_item: str
    criticality: AccessCriticality
    expiry: datetime
    blocking: bool


@dataclass
class NapConflict:
    location_id: str
    label: str
    nap_status: str


@dataclass
class CompletenessSectionResult:
    key: str
    label: str
    requirement: str
    weight: int
    earned: float
    available: float
    percent: Optional[int]
    applicable: bool


@dataclass
class ConfidenceBreakdown:
    confirmed: int = 0
    needs_review: int = 0
    unverified: int = 0
    outdated: int = 0
    placeholder: int = 0
    missing: int = 0


@dataclass
class AttestationFlag:
    key: str
    label: str
    group: str
    required: bool
    last_verified_at: Optional[datetime]
    verified_by: Optional[str]


@dataclass
class CompletenessResult:
    percent: int
    sections: list[CompletenessSectionResult]
    missing_information: list[MissingItem]
    missing_files: list[MissingItem]
    pending_connections: list[PendingConnection]
    confidence: ConfidenceBreakdown
    expired_connections: list[ExpiredConnection]
    nap_conflicts: list[NapConflict]
    outdated_fields: list[AttestationFlag]
    placeholder_fields: list[AttestationFlag]
    fields: dict  # {"total": int, "filled": int}


# ---- Helpers -------------------------------------------------------------------
def _is_blank(v: Optional[str]) -> bool:
    return v is None or (isinstance(v, str) and v.strip() == "")


def _field_has_value(merchant, field_def) -> bool:
    raw = getattr(merchant, field_def.column, None)
    if raw is None:
        return False
    if isinstance(raw, str):
        return raw.strip() != ""
    return True


def _field_is_filled(merchant, field_def, by_field: dict) -> bool:
    if not _field_has_value(merchant, field_def):
        return False
    v = by_field.get(field_def.key)
    return v is None or v.confidence != VerificationConfidence.PLACEHOLDER


def _flag_of(field_def, v) -> AttestationFlag:
    return AttestationFlag(
        key=field_def.key,
        label=field_def.label,
        group=field_def.group,
        required=bool(field_def.required),
        last_verified_at=v.verified_at,
        verified_by=v.verified_by,
    )


def _primary_location(locations: list[SnapshotLocation]) -> Optional[SnapshotLocation]:
    if not locations:
        return None
    for l in locations:
        if l.is_primary:
            return l
    return locations[0]


def _pct(earned: float, available: float) -> int:
    if available <= 0:
        return 0
    return round((earned / available) * 100)


# ---- Calculator ------------------------------------------------------------------
def calculate_completeness(snapshot: ProfileSnapshot, now: Optional[datetime] = None) -> CompletenessResult:
    now = now or datetime.now(timezone.utc)
    merchant = snapshot.merchant
    verifications = snapshot.verifications
    documents = snapshot.documents
    locations = snapshot.locations
    contacts = snapshot.contacts
    connections = snapshot.connections
    brand = snapshot.brand
    brand_assets = snapshot.brand_assets

    missing_information: list[MissingItem] = []
    missing_files: list[MissingItem] = []
    raw: dict[str, dict[str, float]] = {}
    by_field = {v.field_name: v for v in verifications}

    # --- Section: profile fields ---
    scored_fields = [f for f in PROFILE_FIELDS if f.group in SCORED_FIELD_GROUPS and f.scored]
    fields_earned = 0.0
    fields_available = 0.0
    filled_field_count = 0

    for f in scored_fields:
        weight = REQUIRED_FIELD_WEIGHT if f.required else OPTIONAL_FIELD_WEIGHT
        fields_available += weight
        if _field_is_filled(merchant, f, by_field):
            fields_earned += weight
            filled_field_count += 1
        else:
            is_placeholder = _field_has_value(merchant, f)
            missing_information.append(
                MissingItem(
                    key=f"field:{f.key}",
                    label=f"{f.label} (placeholder)" if is_placeholder else f.label,
                    area="PROFILE",
                    severity="REQUIRED" if f.required else "RECOMMENDED",
                    group=f.group,
                )
            )
    raw["fields"] = {"earned": fields_earned, "available": fields_available}

    # --- Section: files ---
    active_categories = {d.category for d in documents if d.status == COUNTABLE_DOCUMENT_STATUS}
    active_asset_types = {a.type for a in brand_assets if (a.status or COUNTABLE_ASSET_STATUS) == COUNTABLE_ASSET_STATUS}

    def slot_satisfied(slot) -> bool:
        return any(t in active_asset_types for t in slot.asset_types) or any(
            c in active_categories for c in slot.document_categories
        )

    files_earned = 0.0
    for slot in REQUIRED_FILE_SLOTS:
        if slot_satisfied(slot):
            files_earned += REQUIRED_FIELD_WEIGHT
        else:
            missing_files.append(MissingItem(key=f"file:{slot.key}", label=slot.label, area=slot.area, severity="REQUIRED"))
    for slot in RECOMMENDED_FILE_SLOTS:
        if slot_satisfied(slot):
            files_earned += OPTIONAL_FIELD_WEIGHT
        else:
            missing_files.append(MissingItem(key=f"file:{slot.key}", label=slot.label, area=slot.area, severity="RECOMMENDED"))
    raw["files"] = {
        "earned": files_earned,
        "available": len(REQUIRED_FILE_SLOTS) * REQUIRED_FIELD_WEIGHT + len(RECOMMENDED_FILE_SLOTS) * OPTIONAL_FIELD_WEIGHT,
    }

    # --- Section: connections ---
    applicable_connections = [c for c in connections if c.status not in NOT_APPLICABLE_STATUSES]
    pending_connections = [
        PendingConnection(
            id=c.id, access_item=c.access_item, criticality=c.criticality, status=c.status,
            blocking=c.criticality in BLOCKING_CRITICALITIES_SET,
        )
        for c in applicable_connections
        if c.status not in CONNECTED_STATUSES
    ]
    raw["connections"] = {
        "earned": len(applicable_connections) - len(pending_connections),
        "available": len(applicable_connections),
    }

    expired_connections = [
        ExpiredConnection(
            id=c.id, access_item=c.access_item, criticality=c.criticality, expiry=c.expiry,
            blocking=c.criticality in BLOCKING_CRITICALITIES_SET,
        )
        for c in applicable_connections
        if c.status in CONNECTED_STATUSES and c.expiry and c.expiry < now
    ]

    nap_conflicts = [
        NapConflict(
            location_id=l.id,
            label=", ".join(x for x in [l.address, l.city] if not _is_blank(x)) or ("Primary location" if l.is_primary else "Location"),
            nap_status=l.nap_status,
        )
        for l in locations
        if not _is_blank(l.nap_status)
    ]

    # --- Section: contacts ---
    named_roles = {c.role for c in contacts if not _is_blank(c.name)}
    contacts_earned = 0.0
    for role in REQUIRED_CONTACT_ROLES:
        if role in named_roles:
            contacts_earned += REQUIRED_FIELD_WEIGHT
        else:
            missing_information.append(MissingItem(key=f"contact:{role.value}", label=CONTACT_ROLE_LABELS[role], area="CONTACTS", severity="REQUIRED"))
    for role in RECOMMENDED_CONTACT_ROLES:
        if role in named_roles:
            contacts_earned += OPTIONAL_FIELD_WEIGHT
        else:
            missing_information.append(MissingItem(key=f"contact:{role.value}", label=CONTACT_ROLE_LABELS[role], area="CONTACTS", severity="RECOMMENDED"))
    raw["contacts"] = {
        "earned": contacts_earned,
        "available": len(REQUIRED_CONTACT_ROLES) * REQUIRED_FIELD_WEIGHT + len(RECOMMENDED_CONTACT_ROLES) * OPTIONAL_FIELD_WEIGHT,
    }

    # --- Section: locations ---
    location = _primary_location(locations)
    location_available = (
        REQUIRED_FIELD_WEIGHT
        + len(REQUIRED_LOCATION_FIELDS) * REQUIRED_FIELD_WEIGHT
        + len(RECOMMENDED_LOCATION_FIELDS) * OPTIONAL_FIELD_WEIGHT
    )
    location_earned = 0.0
    if not location:
        missing_information.append(MissingItem(key="location:any", label="At least one location", area="LOCATIONS", severity="REQUIRED"))
        for key in REQUIRED_LOCATION_FIELDS:
            missing_information.append(MissingItem(key=f"location:{key}", label=LOCATION_FIELD_LABELS[key], area="LOCATIONS", severity="REQUIRED"))
    else:
        location_earned += REQUIRED_FIELD_WEIGHT
        for key in REQUIRED_LOCATION_FIELDS:
            if not _is_blank(location[key]):
                location_earned += REQUIRED_FIELD_WEIGHT
            else:
                missing_information.append(MissingItem(key=f"location:{key}", label=LOCATION_FIELD_LABELS[key], area="LOCATIONS", severity="REQUIRED"))
        for key in RECOMMENDED_LOCATION_FIELDS:
            if not _is_blank(location[key]):
                location_earned += OPTIONAL_FIELD_WEIGHT
            else:
                missing_information.append(MissingItem(key=f"location:{key}", label=LOCATION_FIELD_LABELS[key], area="LOCATIONS", severity="RECOMMENDED"))
    raw["locations"] = {"earned": location_earned, "available": location_available}

    # --- Section: brand ---
    def brand_filled(key: str) -> bool:
        if not brand:
            return False
        v = brand[key]
        if key == "logoVector":
            return v == YesNo.YES
        return isinstance(v, str) and v.strip() != ""

    brand_earned = 0.0
    for key in REQUIRED_BRAND_FIELDS:
        if brand_filled(key):
            brand_earned += REQUIRED_FIELD_WEIGHT
        else:
            missing_information.append(MissingItem(key=f"brand:{key}", label=BRAND_FIELD_LABELS[key], area="BRAND", severity="REQUIRED"))
    for key in RECOMMENDED_BRAND_FIELDS:
        if brand_filled(key):
            brand_earned += OPTIONAL_FIELD_WEIGHT
        else:
            missing_information.append(MissingItem(key=f"brand:{key}", label=BRAND_FIELD_LABELS[key], area="BRAND", severity="RECOMMENDED"))
    raw["brand"] = {
        "earned": brand_earned,
        "available": len(REQUIRED_BRAND_FIELDS) * REQUIRED_FIELD_WEIGHT + len(RECOMMENDED_BRAND_FIELDS) * OPTIONAL_FIELD_WEIGHT,
    }

    # --- Weighted roll-up ---
    sections: list[CompletenessSectionResult] = []
    for meta in COMPLETENESS_SECTIONS:
        r = raw.get(meta.key, {"earned": 0.0, "available": 0.0})
        applicable = r["available"] > 0
        sections.append(
            CompletenessSectionResult(
                key=meta.key, label=meta.label, requirement=meta.requirement, weight=meta.weight,
                earned=r["earned"], available=r["available"],
                percent=_pct(r["earned"], r["available"]) if applicable else None,
                applicable=applicable,
            )
        )

    applicable_sections = [s for s in sections if s.applicable]
    total_weight = sum(s.weight for s in applicable_sections)
    if total_weight == 0:
        percent = 0
    else:
        percent = round(
            sum((s.earned / s.available) * s.weight for s in applicable_sections) / total_weight * 100
        )

    outdated_fields = [
        _flag_of(f, by_field[f.key])
        for f in PROFILE_FIELDS
        if by_field.get(f.key) and by_field[f.key].confidence == VerificationConfidence.OUTDATED and _field_has_value(merchant, f)
    ]
    placeholder_fields = [
        _flag_of(f, by_field[f.key])
        for f in PROFILE_FIELDS
        if by_field.get(f.key) and by_field[f.key].confidence == VerificationConfidence.PLACEHOLDER and _field_has_value(merchant, f)
    ]

    return CompletenessResult(
        percent=percent,
        sections=sections,
        missing_information=missing_information,
        missing_files=missing_files,
        pending_connections=pending_connections,
        confidence=_build_confidence(merchant, by_field),
        expired_connections=expired_connections,
        nap_conflicts=nap_conflicts,
        outdated_fields=outdated_fields,
        placeholder_fields=placeholder_fields,
        fields={"total": len(scored_fields), "filled": filled_field_count},
    )


def _build_confidence(merchant, by_field: dict) -> ConfidenceBreakdown:
    out = ConfidenceBreakdown()
    for f in PROFILE_FIELDS:
        if not _field_has_value(merchant, f):
            out.missing += 1
            continue
        v = by_field.get(f.key)
        conf = v.confidence if v else None
        if conf == VerificationConfidence.CONFIRMED:
            if v.verified_at:
                out.confirmed += 1
            else:
                out.unverified += 1
        elif conf == VerificationConfidence.INFERRED:
            out.needs_review += 1
        elif conf == VerificationConfidence.OUTDATED:
            out.outdated += 1
        elif conf == VerificationConfidence.PLACEHOLDER:
            out.placeholder += 1
        else:
            out.unverified += 1
    return out
