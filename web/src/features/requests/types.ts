/** Requests — mirror app/schemas/requests.py in the API. */

export type RequestType = "FEATURE" | "IMPROVEMENT" | "BUG" | "COMPLAINT" | "DATA" | "PROCESS";
export type RequestArea =
  | "SALES"
  | "PARTNERS"
  | "SUPPORT"
  | "OPERATIONS"
  | "MARKETING"
  | "PAYMENTS"
  | "REPORTING"
  | "PLATFORM"
  | "OTHER";
export type Urgency = "LOW" | "NORMAL" | "HIGH" | "BLOCKING";
export type RequestStatus =
  | "NEW"
  | "UNDER_REVIEW"
  | "NEEDS_INFO"
  | "APPROVED"
  | "IN_PROGRESS"
  | "SHIPPED"
  | "DECLINED"
  | "DUPLICATE";
export type TriageStatus = Exclude<RequestStatus, "NEW" | "APPROVED">;
export type StatusFilter = "open" | "approved" | "closed" | "all" | RequestStatus;
export type SortKey = "top" | "new" | "updated";

export interface Person {
  id: string | null;
  name: string;
  email: string;
}

export interface RequestRow {
  id: string;
  number: number;
  ref: string;
  type: RequestType;
  area: RequestArea;
  urgency: Urgency;
  title: string;
  status: RequestStatus;
  requester: Person;
  votes: number;
  votedByMe: boolean;
  comments: number;
  mine: boolean;
  roadmapItemId: string | null;
  createdAt: string;
  statusChangedAt: string;
}

export interface RequestCounts {
  open: number;
  closed: number;
  new: number;
  needsInfo: number;
  approved: number;
  shipped: number;
  mine: number;
}

export interface RequestList {
  data: RequestRow[];
  counts: RequestCounts;
  canTriage: boolean;
}

export interface RequestComment {
  id: string;
  author: Person;
  body: string;
  createdAt: string;
}

export interface RequestEvent {
  id: string;
  kind: "CREATED" | "EDITED" | "STATUS" | "ROADMAP";
  fromStatus: RequestStatus | null;
  toStatus: RequestStatus | null;
  note: string | null;
  actor: string | null;
  createdAt: string;
}

export interface RoadmapLink {
  id: string;
  title: string;
  status: string;
  phaseName: string;
  targetDate: string | null;
}

export interface RequestDetail extends RequestRow {
  details: string;
  why: string | null;
  whoAffected: string | null;
  links: string | null;
  decisionNote: string | null;
  duplicateOf: string | null;
  roadmapItem: RoadmapLink | null;
  triagedByEmail: string | null;
  voters: string[];
  commentList: RequestComment[];
  events: RequestEvent[];
  canEdit: boolean;
  canTriage: boolean;
  updatedAt: string;
}

export interface RequestInput {
  type: RequestType;
  area: RequestArea;
  urgency: Urgency;
  title: string;
  details: string;
  why?: string | null;
  whoAffected?: string | null;
  links?: string | null;
}

export interface RequestQuery {
  status?: StatusFilter;
  type?: RequestType;
  area?: RequestArea;
  mine?: boolean;
  q?: string;
  sort?: SortKey;
}

export interface StatusChangeInput {
  status: TriageStatus;
  note?: string | null;
  duplicateOf?: string | null;
}

export interface ApproveInput {
  itemId?: string;
  phaseId?: string;
  title?: string;
  roadmapArea?: "SALES" | "MERCHANTS" | "MARKETING" | "PLATFORM";
  priority?: "HIGH" | "NORMAL" | "LOW";
  ownerId?: string | null;
  targetDate?: string | null;
  note?: string | null;
}
