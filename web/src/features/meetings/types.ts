import type { TicketStatus } from "@/features/tickets/types";

/** Ops CRM meetings from Fathom — mirror app/schemas/meetings.py. */

export interface Attendee {
  name: string;
  email: string | null;
  isExternal: boolean;
  userId: string | null;
  spoke: boolean;
}

export interface MeetingSummary {
  id: string;
  title: string;
  source: "FATHOM" | "DEMO";
  startedAt: string | null;
  endedAt: string | null;
  durationMinutes: number | null;
  merchant: { id: string; name: string } | null;
  project: { id: string; name: string } | null;
  recordedBy: string | null;
  attendees: Attendee[];
  hasSummary: boolean;
  actions: { open: number; ticket: number; dismissed: number };
  fathomUrl: string | null;
}

export interface TicketMini {
  key: string;
  title: string;
  status: TicketStatus;
}

export type ActionItemStatus = "OPEN" | "TICKET" | "DISMISSED";

export interface ActionItem {
  id: string;
  description: string;
  assigneeName: string | null;
  assigneeEmail: string | null;
  assignee: { id: string; name: string; email: string } | null;
  recordingTimestamp: string | null;
  playbackUrl: string | null;
  status: ActionItemStatus;
  ticket: TicketMini | null;
  decidedBy: string | null;
  decidedAt: string | null;
}

export interface TranscriptLine {
  speaker: string;
  email: string | null;
  text: string;
  timestamp: string | null;
}

export interface MeetingDetail extends MeetingSummary {
  summary: string | null;
  transcript: TranscriptLine[];
  actionItems: ActionItem[];
  linkedTickets: TicketMini[];
  shareUrl: string | null;
  callUrl: string | null;
  merchantMatch: "auto" | "manual" | null;
  canManage: boolean;
}

export interface MeetingListQuery {
  merchantId?: string;
  search?: string;
  mine?: boolean;
  openActions?: boolean;
  page?: number;
  limit?: number;
}

export interface FathomStatus {
  apiKeySet: boolean;
  webhookSecretSet: boolean;
  webhookPath: string;
  lastSyncAt: string | null;
  lastWebhookAt: string | null;
  lastError: string | null;
  meetings: number;
  openActions: number;
  canSync: boolean;
}

export interface UpdateMeetingInput {
  merchantId?: string | null;
  projectId?: string | null;
  summary?: string | null;
}
