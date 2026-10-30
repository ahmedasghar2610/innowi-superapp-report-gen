"""Port of profile-alert.catalog.ts."""
from __future__ import annotations

import enum
from dataclasses import dataclass, field

from app.modules.merchant_profiling.domain.profile_completeness_calculator import CompletenessResult, MissingItem
from app.modules.merchant_profiling.domain.profile_completeness_rules import PROFILE_ALERT_THRESHOLDS

SOURCE = "Merchant Profiling"


class ProfileAlertSeverity(str, enum.Enum):
    CRITICAL = "CRITICAL"
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"


class ProfileAlertType(str, enum.Enum):
    PROFILE_INCOMPLETE = "profile.incomplete"
    MISSING_INFORMATION = "profile.missing_required"
    MISSING_FILES = "profile.missing_files"
    CONNECTION_PENDING = "data.connection_pending"
    OUTDATED = "profile.outdated"
    PLACEHOLDER = "profile.placeholder"
    CONNECTION_EXPIRED = "data.connection_expired"
    NAP_CONFLICT = "data.nap_conflict"


@dataclass
class AlertEvidence:
    label: str
    source: str


@dataclass
class ProfileAlert:
    id: str
    dedupKey: str
    merchantId: str
    module: str
    type: ProfileAlertType
    severity: ProfileAlertSeverity
    title: str
    summary: str
    evidence: list[AlertEvidence]
    impact: str
    recommendation: str
    targetTab: str
    itemCount: int


SEVERITY_ORDER = {
    ProfileAlertSeverity.CRITICAL: 0,
    ProfileAlertSeverity.HIGH: 1,
    ProfileAlertSeverity.MEDIUM: 2,
    ProfileAlertSeverity.LOW: 3,
}


def _plural(n: int, one: str, many: str) -> str:
    return one if n == 1 else many


def _preview(items, n: int = 3) -> str:
    labels = [i.label if hasattr(i, "label") else i["label"] for i in items]
    head = labels[:n]
    rest = len(labels) - len(head)
    return f"{', '.join(head)} +{rest} more" if rest > 0 else ", ".join(head)


def _base(merchant_id: str, alert_type: ProfileAlertType) -> dict:
    dedup_key = f"{merchant_id}:{alert_type.value}"
    return {"id": dedup_key, "dedupKey": dedup_key, "merchantId": merchant_id, "module": "Customer Profiling", "type": alert_type}


def _area_counts(items: list[MissingItem]) -> list[str]:
    labels = {
        "PROFILE": "Profile information", "FILES": "Files", "CONTACTS": "Contacts",
        "LOCATIONS": "Locations", "CONNECTIONS": "Connections", "BRAND": "Brand profile",
    }
    counts: dict[str, int] = {}
    for item in items:
        counts[item.area] = counts.get(item.area, 0) + 1
    return [f"{n} in {labels[area]}" for area, n in counts.items()]


def build_profile_alerts(merchant_id: str, merchant_name: str, completeness: CompletenessResult) -> list[ProfileAlert]:
    alerts: list[ProfileAlert] = []

    required_info = [i for i in completeness.missing_information if i.severity == "REQUIRED"]
    missing_files = [i for i in completeness.missing_files if i.severity == "REQUIRED"]
    pending = completeness.pending_connections
    blocking = [p for p in pending if p.blocking]

    # --- Restaurant Profile Incomplete ---
    if completeness.percent < PROFILE_ALERT_THRESHOLDS["completeAtPct"]:
        critical = completeness.percent < PROFILE_ALERT_THRESHOLDS["criticalBelowPct"]
        evidence = [AlertEvidence(f"Profile completion {completeness.percent}%", SOURCE)] + [
            AlertEvidence(f"{s.label} {s.percent}%", SOURCE) for s in completeness.sections if s.applicable and s.percent is not None and s.percent < 100
        ]
        alerts.append(
            ProfileAlert(
                **_base(merchant_id, ProfileAlertType.PROFILE_INCOMPLETE),
                severity=ProfileAlertSeverity.HIGH if critical else ProfileAlertSeverity.MEDIUM,
                title="Restaurant Profile Incomplete",
                summary=f"{merchant_name}'s profile is {completeness.percent}% complete, below the {PROFILE_ALERT_THRESHOLDS['completeAtPct']}% threshold.",
                evidence=evidence,
                impact="Every consuming module reads this profile (§5.2). Gaps here surface as missing data in Website, GBP, Ads, Email & SMS and SEO rather than as an error anyone can act on.",
                recommendation="Open the Profile tab and complete the sections scoring below 100%.",
                targetTab="profile",
                itemCount=len(required_info) + len(missing_files),
            )
        )

    # --- Missing Information ---
    if required_info:
        all_brand = all(i.area == "BRAND" for i in required_info)
        alerts.append(
            ProfileAlert(
                **_base(merchant_id, ProfileAlertType.MISSING_INFORMATION),
                severity=ProfileAlertSeverity.HIGH,
                title="Missing Information",
                summary=f"{len(required_info)} required profile {_plural(len(required_info), 'item is', 'items are')} still empty.",
                evidence=[AlertEvidence(_preview(required_info), SOURCE)] + [AlertEvidence(l, SOURCE) for l in _area_counts(required_info)],
                impact="Required identity data is what downstream modules bind to. Until it is present the merchant cannot be marked Ready and module data reads as Not Available.",
                recommendation=f"Capture {_preview(required_info, 2)} on the {'Brand' if all_brand else 'Profile'} tab, then verify each field so it carries a confidence attestation.",
                targetTab="brand" if all_brand else "profile",
                itemCount=len(required_info),
            )
        )

    # --- Missing Files ---
    if missing_files:
        all_brand = all(i.area == "BRAND" for i in missing_files)
        alerts.append(
            ProfileAlert(
                **_base(merchant_id, ProfileAlertType.MISSING_FILES),
                severity=ProfileAlertSeverity.MEDIUM,
                title="Missing Files",
                summary=f"{len(missing_files)} required {_plural(len(missing_files), 'file is', 'files are')} not uploaded.",
                evidence=[AlertEvidence(_preview(missing_files), SOURCE)],
                impact="Brand assets (§6.2.5) are the build input for Website, GBP photos and every campaign creative. Without them design and content work cannot start.",
                recommendation=f"Upload {_preview(missing_files, 2)} on the {'Brand' if all_brand else 'Documents'} tab.",
                targetTab="brand" if all_brand else "documents",
                itemCount=len(missing_files),
            )
        )

    # --- Platform Connection Pending ---
    if pending:
        pending_labels = [type("X", (), {"label": p.access_item})() for p in pending]
        summary = (
            f"{len(blocking)} critical {_plural(len(blocking), 'connection is', 'connections are')} still pending ({len(pending)} pending in total)."
            if blocking
            else f"{len(pending)} platform {_plural(len(pending), 'connection is', 'connections are')} still pending."
        )
        evidence = [AlertEvidence(_preview(pending_labels), SOURCE)]
        if blocking:
            evidence.append(AlertEvidence(f"{len(blocking)} flagged go-live blocking", SOURCE))
        alerts.append(
            ProfileAlert(
                **_base(merchant_id, ProfileAlertType.CONNECTION_PENDING),
                severity=ProfileAlertSeverity.HIGH if blocking else ProfileAlertSeverity.MEDIUM,
                title="Platform Connection Pending",
                summary=summary,
                evidence=evidence,
                impact="A pending credential blocks the service that depends on it — the workbook gates go-live on exactly these items (an SMS package cannot launch without 10DLC registration and documented consent).",
                recommendation=f"Chase {_preview(pending_labels, 2)} and set each to Received or Verified once granted.",
                targetTab="connections",
                itemCount=len(pending),
            )
        )

    # --- Expired connections ---
    expired = completeness.expired_connections
    if expired:
        blocking_expired = [e for e in expired if e.blocking]
        alerts.append(
            ProfileAlert(
                **_base(merchant_id, ProfileAlertType.CONNECTION_EXPIRED),
                severity=ProfileAlertSeverity.HIGH if blocking_expired else ProfileAlertSeverity.MEDIUM,
                title="Connection Expired",
                summary=f"{len(expired)} connected {_plural(len(expired), 'credential has', 'credentials have')} passed {_plural(len(expired), 'its', 'their')} renewal date.",
                evidence=[AlertEvidence(f"{e.access_item} — expired {e.expiry.date().isoformat()}", SOURCE) for e in expired[:3]],
                impact="Access that used to work will start failing silently — syncs stop, posts stop publishing — and it reads as Connected until someone notices.",
                recommendation=f"Renew {_preview([type('X', (), {'label': e.access_item})() for e in expired], 2)} and update the expiry date on the Connections tab.",
                targetTab="connections",
                itemCount=len(expired),
            )
        )

    # --- NAP conflict ---
    nap = completeness.nap_conflicts
    if nap:
        alerts.append(
            ProfileAlert(
                **_base(merchant_id, ProfileAlertType.NAP_CONFLICT),
                severity=ProfileAlertSeverity.HIGH,
                title="NAP Conflict",
                summary=f"{len(nap)} {_plural(len(nap), 'location has', 'locations have')} inconsistent name / address / phone data across sources.",
                evidence=[AlertEvidence(f"{n.label}: {n.nap_status}", SOURCE) for n in nap[:3]],
                impact="Conflicting NAP is the single biggest local-ranking penalty and the first thing GBP verification trips on. Every module that publishes the address inherits the conflict.",
                recommendation="Confirm the canonical address and hours with the owner, correct the Location, then clear its NAP status.",
                targetTab="locations",
                itemCount=len(nap),
            )
        )

    # --- Placeholder values ---
    placeholders = completeness.placeholder_fields
    if placeholders:
        required = [f for f in placeholders if f.required]
        alerts.append(
            ProfileAlert(
                **_base(merchant_id, ProfileAlertType.PLACEHOLDER),
                severity=ProfileAlertSeverity.HIGH if required else ProfileAlertSeverity.MEDIUM,
                title="Placeholder Values",
                summary=f"{len(placeholders)} {_plural(len(placeholders), 'field holds', 'fields hold')} a placeholder instead of real data.",
                evidence=[AlertEvidence(_preview(placeholders), SOURCE)] + ([AlertEvidence(f"{len(required)} required", SOURCE)] if required else []),
                impact="A placeholder is not data. These fields are excluded from the completion score and must not be published to any downstream module (GLB-01).",
                recommendation=f"Replace {_preview(placeholders, 2)} with the real value and verify it, or clear the field so it reads as missing.",
                targetTab="profile",
                itemCount=len(placeholders),
            )
        )

    # --- Outdated attestations ---
    outdated = completeness.outdated_fields
    if outdated:
        evidence = [AlertEvidence(_preview(outdated), SOURCE)]
        evidence += [
            AlertEvidence(f"{f.label} last confirmed {f.last_verified_at.date().isoformat()}", SOURCE)
            for f in outdated if f.last_verified_at
        ][:2]
        alerts.append(
            ProfileAlert(
                **_base(merchant_id, ProfileAlertType.OUTDATED),
                severity=ProfileAlertSeverity.MEDIUM,
                title="Outdated Information",
                summary=f"{len(outdated)} {_plural(len(outdated), 'field was', 'fields were')} marked outdated and {_plural(len(outdated), 'needs', 'need')} re-verification.",
                evidence=evidence,
                impact="Downstream modules keep consuming the stale value (NAP drift on GBP, wrong hours on the website) until someone re-confirms it.",
                recommendation=f"Re-check {_preview(outdated, 2)} with the owner and mark {_plural(len(outdated), 'it', 'them')} Confirmed, or correct the value.",
                targetTab="profile",
                itemCount=len(outdated),
            )
        )

    return sorted(alerts, key=lambda a: SEVERITY_ORDER[a.severity])
