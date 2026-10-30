/** Merchant Reports (API modules/report_gen). Shapes mirror router.py DTOs. */

export type ReportStatus = "generating" | "draft" | "edited" | "approved" | "sent" | "failed" | "deleted";
export type SendMode = "dry-run" | "sandbox" | "live";

export interface PeriodDto {
  start: string;
  end: string;
  days: number;
  month: string;
  label: string;
}

export interface Metric {
  id: string;
  label: string;
  value: number | null;
  prev: number | null;
  change: number | null;
  unit: string;
  tag: string | null;
  reason: string | null;
  reasonText: string | null;
}

export interface MissingFigure {
  id: string;
  reason: string;
  text: string;
}

export interface Section {
  key: string;
  title: string;
  included: boolean;
  metrics: Metric[];
  tables: Record<string, unknown>;
  missing: MissingFigure[];
  /** One line under the section: the "not supplied" reason or a label footnote. */
  caption: string | null;
  dataThrough: string | null;
  sources: string[];
}

export interface HeadlineCard extends Metric {
  section: string;
}

export interface Recommendation {
  action: string;
  why: string;
  owner: string;
  target: string;
}

export interface Snapshot {
  payloadVersion: number;
  template: string;
  merchant: {
    id: string;
    name: string;
    cuisine: string | null;
    website: string | null;
    onlineOrdering: string | null;
    locationCount: number | null;
    goLiveDate: string | null;
    googleAdsBudget: number | null;
    city: string | null;
    state: string | null;
  };
  period: PeriodDto;
  previous: PeriodDto;
  services: string[];
  sectionOrder: string[];
  sections: Record<string, Section>;
  headline: HeadlineCard[];
  summary: string[];
  sectionNotes: Record<string, string>;
  recommendations: Recommendation[];
  bottomLine: string;
  sources: string[];
  dataThrough: Record<string, string>;
  missing: (MissingFigure & { section: string })[];
  generatedAt: string;
  /** Addressing only; never printed. */
  recipients: string[];
  edited?: { keys: string[] };
}

export interface UserRef {
  id: string;
  name: string;
}

export interface ReportRef {
  id: string;
  merchantId: string;
  template: string;
  status: ReportStatus;
  version: number;
  period: PeriodDto;
  generatedAt: string | null;
  approvedAt: string | null;
  sentAt: string | null;
  deletedAt: string | null;
  error: string | null;
  missingCount: number;
  dataThrough: Record<string, string>;
}

export interface HistoryRow {
  action: "generate" | "edit" | "approve" | "delete" | "send" | "send_failed";
  version: number;
  user: UserRef | null;
  at: string;
  note: string | null;
  detail: Record<string, unknown>;
}

export interface Report extends ReportRef {
  merchant: { id: string; name: string } | null;
  generatedBy: UserRef | null;
  approvedBy: UserRef | null;
  deletedBy: UserRef | null;
  snapshot: Snapshot | Record<string, never>;
  frozen: boolean;
  missing: (MissingFigure & { section: string })[];
  versions: { version: number; frozen: boolean; createdAt: string | null; createdById: string | null }[];
  history: HistoryRow[];
  defaultRecipients: string[];
  sendMode: SendMode;
  canManage: boolean;
  canApprove: boolean;
  /** Why this user cannot approve right now (four-eyes rule, wrong status), or null. */
  approveBlocked: string | null;
}

export interface SendOutcome {
  mode: SendMode;
  status: "dry_run" | "sent";
  recipients: string[];
  subject: string;
}

export interface QueueRow {
  merchant: { id: string; name: string; cuisine: string | null; locationCount: number | null };
  services: string[];
  links: { ads: number; seo: number };
  report: ReportRef | null;
}

export interface Queue {
  period: PeriodDto;
  merchants: QueueRow[];
  counts: Record<string, number>;
}

export interface ReportGenStatus {
  enabled: boolean;
  sendMode: SendMode;
  canManage: boolean;
  canApprove: boolean;
  counts: Record<string, number>;
}

export interface TextPatch {
  summary?: string[];
  sectionNotes?: Record<string, string>;
  recommendations?: Recommendation[];
  bottomLine?: string;
}
