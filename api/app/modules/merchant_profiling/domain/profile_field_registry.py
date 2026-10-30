"""Port of profile-field.registry.ts — verbatim field list, order preserved."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from app.models.enums import AccountHealth, YesNo

ENTITY_TYPE_MERCHANT = "Merchant"
ADS_PAID_BY: tuple[str, ...] = ("Merchant", "Innowi")


@dataclass(frozen=True)
class ProfileFieldDef:
    key: str
    column: str
    label: str
    type: str
    group: str
    required: bool = False
    options: Optional[tuple[str, ...]] = None
    note: Optional[str] = None
    # False keeps a field out of the profile-completeness score (fields added
    # for one module, so adding them doesn't move every merchant's %).
    scored: bool = True


PROFILE_FIELDS: tuple[ProfileFieldDef, ...] = (
    ProfileFieldDef("restaurantName", "restaurant_name", "Restaurant Name (DBA)", "string", "Restaurant Information", required=True),
    ProfileFieldDef("merchantCode", "merchant_code", "Merchant ID", "string", "Restaurant Information",
                    note="The workbook's Merchant ID (e.g. M-001). Unique — the cross-reference back to the sheet."),
    ProfileFieldDef("legalName", "legal_name", "Legal Name", "string", "Restaurant Information"),
    ProfileFieldDef("cuisineCategory", "cuisine_category", "Cuisine / Category", "string", "Restaurant Information"),

    ProfileFieldDef("posSystem", "pos_system", "POS System", "string", "Business & Service"),
    ProfileFieldDef("alcoholLicense", "alcohol_license", "Alcohol License", "enum", "Business & Service",
                    options=tuple(v.value for v in YesNo)),
    ProfileFieldDef("dietaryCerts", "dietary_certs", "Dietary Certifications", "string", "Business & Service"),
    ProfileFieldDef("slowDayparts", "slow_dayparts", "Slow Days / Dayparts", "string", "Business & Service"),
    ProfileFieldDef("seasonalPeaks", "seasonal_peaks", "Seasonal Peaks", "string", "Business & Service"),
    ProfileFieldDef("locationCount", "location_count", "Number of Locations", "integer", "Business & Service"),

    ProfileFieldDef("websiteUrl", "website_url", "Website URL", "url", "Digital Profiles"),
    ProfileFieldDef("websitePlatform", "website_platform", "Website Platform", "string", "Digital Profiles"),
    ProfileFieldDef("onlineOrdering", "online_ordering", "Online Ordering", "string", "Digital Profiles"),
    ProfileFieldDef("customerListSource", "customer_list_source", "Customer List Source", "string", "Digital Profiles"),

    ProfileFieldDef("googleAdsBudget", "google_ads_budget", "Google Ads Budget", "decimal", "Marketing",
                    note="Master field — the Google Ads module reads this (ADS-02) and defines no budget of its own."),
    ProfileFieldDef("metaAdsBudget", "meta_ads_budget", "Meta Ads Budget", "decimal", "Marketing",
                    note="Master field — any Meta Ads module reads this rather than defining its own budget."),
    ProfileFieldDef("adsPaidBy", "ads_paid_by", "Ads Paid By", "enum", "Marketing",
                    options=ADS_PAID_BY, scored=False,
                    note="Who pays the Google Ads spend. Shown in the Ads module; informational only."),
    ProfileFieldDef("businessGoals", "business_goals", "Business Goals", "string", "Marketing"),
    ProfileFieldDef("targetAudience", "target_audience", "Target Audience", "string", "Marketing"),

    ProfileFieldDef("accountHealth", "account_health", "Account Health", "enum", "Internal / Ops",
                    options=tuple(v.value for v in AccountHealth)),
    ProfileFieldDef("nextAction", "next_action", "Next Action", "string", "Internal / Ops"),
    ProfileFieldDef("openBlockers", "open_blockers", "Open Blockers", "string", "Internal / Ops"),
    ProfileFieldDef("notes", "notes", "Notes", "string", "Internal / Ops"),
    ProfileFieldDef("onboardingDate", "onboarding_date", "Onboarding Date", "date", "Internal / Ops"),
    ProfileFieldDef("goLiveDate", "go_live_date", "Go-Live Date", "date", "Internal / Ops"),
    ProfileFieldDef("reportFrequency", "report_frequency", "Report Frequency", "string", "Internal / Ops"),
    ProfileFieldDef("reportRecipients", "report_recipients", "Report Recipients", "string", "Internal / Ops"),
)

PROFILE_FIELD_MAP: dict[str, ProfileFieldDef] = {f.key: f for f in PROFILE_FIELDS}
