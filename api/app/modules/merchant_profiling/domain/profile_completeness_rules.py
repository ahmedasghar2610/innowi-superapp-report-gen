"""Port of profile-completeness.rules.ts verbatim."""
from __future__ import annotations

from dataclasses import dataclass

from app.models.enums import AccessCriticality, AccessStatus, ContactRole, DocumentCategory, DocumentStatus


@dataclass(frozen=True)
class CompletenessSectionMeta:
    key: str
    label: str
    weight: int
    requirement: str


COMPLETENESS_SECTIONS: tuple[CompletenessSectionMeta, ...] = (
    CompletenessSectionMeta("fields", "Profile information", 35, "PROF-01 §6.2"),
    CompletenessSectionMeta("files", "Brand assets & files", 15, "PROF-01 §6.2.5"),
    CompletenessSectionMeta("connections", "Platform connections", 20, "PROF-04"),
    CompletenessSectionMeta("contacts", "Key contacts", 10, "Super App §22"),
    CompletenessSectionMeta("locations", "Location details", 10, "PROF-01 §6.2.1"),
    CompletenessSectionMeta("brand", "Brand profile", 10, "PROF-01 §6.2.5"),
)

SCORED_FIELD_GROUPS: tuple[str, ...] = ("Restaurant Information", "Business & Service", "Digital Profiles", "Marketing")

REQUIRED_FIELD_WEIGHT = 2
OPTIONAL_FIELD_WEIGHT = 1


@dataclass(frozen=True)
class FileSlot:
    key: str
    label: str
    asset_types: tuple[str, ...]
    document_categories: tuple[DocumentCategory, ...]
    area: str


REQUIRED_FILE_SLOTS: tuple[FileSlot, ...] = (
    FileSlot("MENU", "Menu file", ("MENU",), (DocumentCategory.MENU,), "FILES"),
    FileSlot("LOGO", "Logo", ("LOGO",), (DocumentCategory.BRAND,), "BRAND"),
)

RECOMMENDED_FILE_SLOTS: tuple[FileSlot, ...] = (
    FileSlot("IMAGES", "Images (dishes, interior)", ("IMAGE",), (), "BRAND"),
    FileSlot("BRAND_GUIDELINES", "Brand guidelines", ("BRAND_GUIDELINES",), (), "BRAND"),
)

COUNTABLE_ASSET_STATUS = "ACTIVE"
COUNTABLE_DOCUMENT_STATUS = DocumentStatus.ACTIVE

CONNECTED_STATUSES: tuple[AccessStatus, ...] = (AccessStatus.RECEIVED, AccessStatus.VERIFIED)
NOT_APPLICABLE_STATUSES: tuple[AccessStatus, ...] = (AccessStatus.NA,)
BLOCKING_CRITICALITIES: tuple[AccessCriticality, ...] = (AccessCriticality.CRITICAL, AccessCriticality.CRITICAL_COMPLIANCE)

REQUIRED_CONTACT_ROLES: tuple[ContactRole, ...] = (ContactRole.OWNER, ContactRole.BILLING)
RECOMMENDED_CONTACT_ROLES: tuple[ContactRole, ...] = (ContactRole.MARKETING, ContactRole.CONTENT_APPROVER)

CONTACT_ROLE_LABELS: dict[ContactRole, str] = {
    ContactRole.OWNER: "Owner contact",
    ContactRole.MARKETING: "Marketing contact",
    ContactRole.CONTENT_APPROVER: "Content approver",
    ContactRole.BILLING: "Billing contact",
    ContactRole.CATERING: "Catering contact",
}

REQUIRED_LOCATION_FIELDS: tuple[str, ...] = ("address", "city", "state", "zip")
RECOMMENDED_LOCATION_FIELDS: tuple[str, ...] = ("hours", "timezone")

LOCATION_FIELD_LABELS: dict[str, str] = {
    "address": "Street address",
    "city": "City",
    "state": "State",
    "zip": "ZIP code",
    "hours": "Business hours",
    "timezone": "Time zone",
}

REQUIRED_BRAND_FIELDS: tuple[str, ...] = ("brandColors", "toneOfVoice", "logoVector")
RECOMMENDED_BRAND_FIELDS: tuple[str, ...] = (
    "brandFonts", "signatureDishes", "doNotSay", "contentRestrictions", "photoLibraryStatus", "menuFormat",
)

BRAND_FIELD_LABELS: dict[str, str] = {
    "brandColors": "Brand colours",
    "toneOfVoice": "Tone of voice",
    "logoVector": "Vector logo on file",
    "brandFonts": "Brand fonts",
    "signatureDishes": "Signature dishes",
    "doNotSay": "Do-not-say list",
    "contentRestrictions": "Content restrictions",
    "photoLibraryStatus": "Photo library status",
    "menuFormat": "Menu format",
}

PROFILE_ALERT_THRESHOLDS = {"completeAtPct": 80, "criticalBelowPct": 50}
