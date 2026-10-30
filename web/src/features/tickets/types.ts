/**
 * Ops CRM ticket types — mirror innowi-superapp-api-fastapi app/schemas/ops.py.
 * Enum values are the API's (UPPER_CASE); labels live in ./labels.ts.
 */

export type TicketType = "MARKETING" | "DESIGN" | "WEBSITE" | "INTERNAL";
export type TicketPriority = "URGENT" | "HIGH" | "MEDIUM" | "LOW";
export type TicketStatus = "NEW" | "IN_PROGRESS" | "AWAITING_MERCHANT" | "IN_REVIEW" | "DONE";
export type TicketRequestType = "NEW_REQUEST" | "UPDATE" | "QUERY" | "ISSUE";
export type TicketSource = "MANUAL" | "EMAIL" | "MODULE" | "MEETING";
export type TicketEventKind =
  | "CREATED"
  | "STATUS_CHANGED"
  | "ASSIGNED"
  | "PRIORITY_CHANGED"
  | "DUE_DATE_CHANGED"
  | "UPDATED"
  | "SUBTASK_ADDED"
  | "SUBTASK_COMPLETED"
  | "SUBTASK_REOPENED"
  | "SUBTASK_REMOVED"
  | "ATTACHMENT_ADDED"
  | "ATTACHMENT_REMOVED";

export interface TicketAttachment {
  id: string;
  fileName: string;
  contentType: string | null;
  sizeBytes: number;
  isImage: boolean;
  uploadedBy: PersonRef | null;
  createdAt: string;
  /** API path; open with api.fileUrl(). */
  downloadPath: string;
  canDelete: boolean;
}

export interface WatchersResponse {
  data: PersonRef[];
  watching: boolean;
}

export type NotificationKind =
  | "ASSIGNED"
  | "STATUS_CHANGED"
  | "COMMENTED"
  | "MENTIONED"
  | "SLA_AT_RISK"
  | "SLA_BREACHED"
  | "RESPONSE_OVERDUE"
  | "REQUEST_NEW"
  | "REQUEST_UPDATED";

export interface AppNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string | null;
  ticketKey: string | null;
  /** Where a notice that isn't about a ticket opens (e.g. "/requests/R-1004"). */
  link?: string | null;
  actor: string | null;
  read: boolean;
  createdAt: string;
}

export interface PersonRef {
  id: string;
  name: string;
  email: string;
}

export interface Person extends PersonRef {
  role: string;
  canManageTickets: boolean;
}

export interface Project {
  id: string;
  name: string;
  archived: boolean;
  position: number;
}

export interface TicketCategory {
  name: string;
  subCategories: string[];
}

export interface TicketTypeSpec {
  type: TicketType;
  label: string;
  description: string;
  categories: TicketCategory[];
}

export interface TicketCatalog {
  types: TicketTypeSpec[];
  sla: SlaPolicy[];
}

export interface Subtask {
  id: string;
  title: string;
  done: boolean;
  position: number;
  doneAt: string | null;
  createdAt: string;
}

export type SlaState = "on_track" | "at_risk" | "breached" | "paused" | "met";

/** SLA clock — weekdays only; resolution pauses while Awaiting Merchant. */
export interface TicketSla {
  state: SlaState;
  responseState: "pending" | "met" | "breached";
  responseDueAt: string;
  firstResponseAt: string | null;
  resolutionDueAt: string;
  /** Business seconds left to resolve; negative once breached. */
  remainingSeconds: number;
  targetResponseHours: number;
  targetResolutionHours: number;
}

export interface SlaPolicy {
  priority: TicketPriority;
  responseHours: number;
  resolutionHours: number;
}

export interface Ticket {
  id: string;
  /** "OPS-1042" */
  key: string;
  number: number;
  title: string;
  description: string | null;
  type: TicketType;
  category: string;
  subCategory: string | null;
  requestType: TicketRequestType;
  priority: TicketPriority;
  status: TicketStatus;
  source: TicketSource;
  project: { id: string; name: string };
  /** null = internal work */
  merchant: { id: string; name: string } | null;
  /** null only when the assignee's account was deleted */
  assignee: PersonRef | null;
  createdBy: PersonRef | null;
  /** "YYYY-MM-DD" */
  dueDate: string | null;
  isOverdue: boolean;
  completedAt: string | null;
  sla: TicketSla | null;
  subtaskCount: number;
  subtasksDone: number;
  commentCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface TicketDetail extends Ticket {
  /** The meeting this ticket was made from, if any. */
  meeting?: { id: string; title: string } | null;
  subtasks: Subtask[];
  viewer: { canManage: boolean; canWork: boolean; watching?: boolean };
  watchers?: PersonRef[];
  attachments?: TicketAttachment[];
  merchantInfo?: MerchantInfo | null;
  libraryLinks?: LibraryLinkRef[];
  librarySuggestions?: LibraryLinkRef[];
}

export interface TicketCounts {
  total: number;
  byType: Record<TicketType, number>;
}

export type CommentVisibility = "INTERNAL" | "MERCHANT";

export interface ActivityItem {
  kind: "comment" | "event";
  id: string;
  createdAt: string;
  actor: PersonRef | null;
  body?: string | null;
  /** Comments: INTERNAL (team only) or MERCHANT (shared with the merchant). */
  visibility?: CommentVisibility | null;
  mentions?: PersonRef[];
  event?: TicketEventKind | null;
  data?: Record<string, unknown> | null;
}

export type TicketView = "open" | "done" | "all";
export type TicketSort = "priority" | "due" | "updated" | "created";

/** GET /ops/tickets query. Empty values are dropped by the client's serializer. */
export interface TicketListQuery {
  view?: TicketView;
  /** comma-separated statuses; overrides `view` */
  status?: string;
  type?: TicketType;
  /** comma-separated priorities */
  priority?: string;
  projectId?: string;
  /** user id, "me" or "none" */
  assigneeId?: string;
  /** merchant id or "none" (internal) */
  merchantId?: string;
  search?: string;
  overdue?: boolean;
  /** Only tickets the signed-in user watches. */
  watching?: boolean;
  /** Open tickets past their SLA (resolution or first response). */
  slaBreached?: boolean;
  /** Due-date range, YYYY-MM-DD (Calendar). */
  dueFrom?: string;
  dueTo?: string;
  /** Done within this range, YYYY-MM-DD (Calendar). */
  completedFrom?: string;
  completedTo?: string;
  sort?: TicketSort;
  page?: number;
  limit?: number;
}

export type TicketCountsQuery = Omit<TicketListQuery, "type" | "sort" | "page" | "limit">;

export interface CreateTicketInput {
  title: string;
  description?: string | null;
  type: TicketType;
  category: string;
  subCategory?: string | null;
  requestType: TicketRequestType;
  priority: TicketPriority;
  projectId: string;
  merchantId?: string | null;
  assigneeId: string;
  dueDate?: string | null;
  subtasks?: string[];
  /** Made from a meeting's action item (Ops CRM → Meetings). */
  actionItemId?: string | null;
}

/** PATCH body — send only what changes. Assignees may send `status` only. */
export type UpdateTicketInput = Partial<Omit<CreateTicketInput, "subtasks" | "actionItemId">> & { status?: TicketStatus };

/** GET /ops/reports */
export interface TeamReport {
  window: { days: number; from: string; to: string };
  kpis: {
    open: number;
    openByType: Record<TicketType, number>;
    urgent: number;
    high: number;
    overdue: number;
    overdueShare: number;
    slaBreachedOpen: number;
    resolutionSla: { met: number; total: number };
    responseSla: { met: number; total: number };
    created: number;
    resolved: number;
    medianResolutionHours: number | null;
    medianResolutionHoursPrevious: number | null;
  };
  weekly: { weekStart: string; created: number; closed: number }[];
  byAssignee: { id: string | null; name: string; open: number; overdue: number; urgentHigh: number }[];
  byProject: { id: string; name: string; open: number }[];
  topCategories: { type: TicketType; category: string; count: number }[];
  bySource: { source: TicketSource; count: number }[];
}

export interface TeamReportQuery {
  days?: number;
  type?: TicketType;
  projectId?: string;
}

export interface MerchantInfo {
  contact: { name: string | null; email: string | null; phone: string | null; role: string } | null;
  plan: { name: string; status: string } | null;
  services: string[];
}

export interface LibraryLinkRef {
  id: string;
  title: string;
  section: string;
  merchant: string | null;
}

export interface CommentInput {
  body: string;
  visibility?: CommentVisibility;
  mentions?: string[];
}

export interface SavedView {
  id: string;
  name: string;
  filters: Record<string, string | boolean | number>;
  createdAt: string;
}

export interface CatchUpItem {
  kind: "assigned" | "urgent" | "mention" | "changed" | "meeting";
  title: string;
  text: string;
  href: string;
  at: string;
  by: string | null;
}

export interface CatchUp {
  since: string;
  counts: { assigned: number; urgent: number; mentions: number; changed: number; meetings: number; actionItems: number };
  items: CatchUpItem[];
}
