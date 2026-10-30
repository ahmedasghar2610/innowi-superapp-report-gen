import type { AccessCriticality, AccessStatus, Id, ISODateString } from "./enums";

/**
 * Profile completeness & alerts — API_REFERENCE.md §4a.
 *
 * Both are derived server-side on every read; nothing here is stored state, so
 * these types describe a computed view, not a resource you can mutate. The way
 * to change any of it is to fill in the underlying data.
 */

/* ---- Completeness (PROF-02 / PROF-03) --------------------------------------- */

/** The six weighted sections the score rolls up from (§4a.1; `brand` since Step 5). */
export type CompletenessSectionKey =
  | "fields"
  | "files"
  | "connections"
  | "contacts"
  | "locations"
  | "brand";

export interface CompletenessSection {
  key: CompletenessSectionKey;
  label: string;
  /** The PRD requirement this section evidences, e.g. "PROF-01 §6.2". */
  requirement: string;
  weight: number;
  earned: number;
  available: number;
  /** Null when the section is not applicable — render "—", never 0%. */
  percent: number | null;
  /**
   * False when there is nothing to measure (e.g. no access checklist seeded).
   * Such sections are excluded from the overall percent rather than scoring 0,
   * so they must not be drawn as a failing bar.
   */
  applicable: boolean;
}

/** Which workspace tab resolves a missing item — drives the deep link. */
export type MissingItemArea = "PROFILE" | "FILES" | "CONTACTS" | "LOCATIONS" | "CONNECTIONS" | "BRAND";

/** REQUIRED items raise the Missing Information alert; RECOMMENDED only lower the score. */
export type MissingItemSeverity = "REQUIRED" | "RECOMMENDED";

export interface MissingItem {
  /** Stable machine key, `<kind>:<id>` — e.g. `field:googleAdsBudget`, `document:MENU`. */
  key: string;
  label: string;
  area: MissingItemArea;
  severity: MissingItemSeverity;
  /** Profile tab section, present only for profile fields. */
  group?: string;
}

export interface PendingConnection {
  id: Id;
  accessItem: string;
  criticality: AccessCriticality;
  status: AccessStatus;
  /** CRITICAL / CRITICAL_COMPLIANCE — the workbook gates go-live on these. */
  blocking: boolean;
}

/**
 * Data-quality roll-up across every registry field. Mirrors the confidence chip
 * taxonomy collapsed to four buckets for a summary row.
 */
/** A connected credential whose recorded expiry has passed. */
export interface ExpiredConnection {
  id: Id;
  accessItem: string;
  criticality: AccessCriticality;
  expiry: ISODateString;
  blocking: boolean;
}

/** A location flagged NAP-inconsistent (importer or editor). */
export interface NapConflict {
  locationId: Id;
  label: string;
  napStatus: string;
}

/** A field flagged by its attestation (OUTDATED / PLACEHOLDER), not by absence. */
export interface AttestationFlag {
  key: string;
  label: string;
  group: string;
  required: boolean;
  lastVerifiedAt: ISODateString | null;
  verifiedBy: string | null;
}

export interface ConfidenceBreakdown {
  confirmed: number;
  /** INFERRED — plausible, not confirmed by a person. */
  needsReview: number;
  unverified: number;
  outdated: number;
  /** Present but known not real — excluded from the score. */
  placeholder: number;
  missing: number;
}

/** GET /merchants/:id/completeness — also embedded as `completion` on /profile and /fields. */
export interface ProfileCompleteness {
  percent: number;
  /** Threshold at or above which the profile counts as complete (§6.4). */
  completeAtPct: number;
  isComplete: boolean;
  sections: CompletenessSection[];
  /** PROF-03 "Missing Information". */
  missingInformation: MissingItem[];
  /** PROF-03 "Missing Files". */
  missingFiles: MissingItem[];
  /** PROF-04 connections not yet Connected. */
  pendingConnections: PendingConnection[];
  confidence: ConfidenceBreakdown;
  /** Connected credentials past expiry (§22 `data.connection_expired`). */
  expiredConnections: ExpiredConnection[];
  /** Locations flagged NAP-inconsistent (§22 / M1-03). */
  napConflicts: NapConflict[];
  /** Fields marked OUTDATED (§22 `profile.outdated`). */
  outdatedFields: AttestationFlag[];
  /** Fields marked PLACEHOLDER — excluded from the score (§22 `profile.placeholder`). */
  placeholderFields: AttestationFlag[];
  /** Scored profile-field counts (excludes the Internal / Ops group). */
  fields: { total: number; filled: number };
  requiredMissingCount: number;
}

/* ---- Alerts (§6.4) ----------------------------------------------------------- */

/**
 * Alert types, namespaced to match the Issue type keys the Super App PRD §22
 * assigns to Customer Profiling — so these survive the move into the Issues
 * platform unchanged.
 */
export const PROFILE_ALERT_TYPE = [
  "profile.incomplete",
  "profile.missing_required",
  "profile.missing_files",
  "data.connection_pending",
  "profile.outdated",
  "profile.placeholder",
  "data.connection_expired",
  "data.nap_conflict",
] as const;
export type ProfileAlertType = (typeof PROFILE_ALERT_TYPE)[number];

export const PROFILE_ALERT_SEVERITY = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;
export type ProfileAlertSeverity = (typeof PROFILE_ALERT_SEVERITY)[number];

/** Workspace tab an alert deep-links to. */
export type ProfileAlertTargetTab =
  | "profile"
  | "documents"
  | "connections"
  | "contacts"
  | "locations"
  | "brand";

export interface AlertEvidence {
  label: string;
  source: string;
}

/**
 * One §6.4 alert, carrying the platform Issue chain: what happened (`summary`)
 * → `evidence` → `impact` → `recommendation`. `id` is deterministic
 * (`<merchantId>:<type>`), so it is stable across reads and safe as a React key.
 */
export interface ProfileAlert {
  id: string;
  dedupKey: string;
  merchantId: Id;
  module: string;
  type: ProfileAlertType;
  severity: ProfileAlertSeverity;
  /** The PRD's own name for this attention state, e.g. "Missing Files". */
  title: string;
  summary: string;
  evidence: AlertEvidence[];
  impact: string;
  recommendation: string;
  targetTab: ProfileAlertTargetTab;
  itemCount: number;
}

/** GET /merchants/:id/alerts */
export interface ProfileAlertsResponse {
  data: ProfileAlert[];
  total: number;
}
