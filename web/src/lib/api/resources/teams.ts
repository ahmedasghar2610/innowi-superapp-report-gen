import { api } from "../client";

/** Ops CRM ↔ Microsoft Teams through the Power Automate flow (api/app/modules/ops/teams_router.py). */
export interface TeamsStatus {
  configured: boolean;
  emailConfigured: boolean;
  myMicrosoftEmail: string;
  timezone: string;
  digestHour: number;
  canManage: boolean;
}

export interface TeamsResult {
  ok: boolean;
  detail: string;
}

export interface TeamsMeetingInput {
  subject: string;
  text?: string;
  /** ISO with offset */
  start: string;
  durationMinutes: number;
  attendeeIds: string[];
  ticketKey?: string;
}

export interface BusyBlock {
  start: string;
  end: string;
  status: string;
}

export interface PersonAvailability {
  id: string;
  name: string;
  email: string;
  role: string;
  onLeave: boolean;
  leaveMessage: string | null;
  leaveUntil: string | null;
  busyNow: boolean;
  busyUntil: string | null;
  nextBusy: BusyBlock[];
  today: BusyBlock[];
  openTickets: number;
  overdue: number;
  urgent: number;
  known: boolean;
  hasCalendar: boolean;
}

export interface TeamAvailability {
  configured: boolean;
  timezone: string;
  updatedAt: string | null;
  stale: boolean;
  hasSchedule: boolean;
  people: PersonAvailability[];
}

export interface CalendarPerson {
  name: string;
  email: string;
}

/** Ops Calendar item from Teams / Outlook / Fathom (GET /ops/teams/calendar). */
export interface CalendarEvent {
  id: string;
  kind: "meeting" | "busy" | "leave" | "recording";
  title: string;
  start: string | null;
  end: string | null;
  /** All-day items (leave), YYYY-MM-DD */
  day: string | null;
  people: CalendarPerson[];
  ticketKey: string | null;
  ticketTitle: string | null;
  location: string | null;
  note: string | null;
  link: string | null;
}

export interface TeamCalendar {
  timezone: string;
  updatedAt: string | null;
  hasSchedule: boolean;
  events: CalendarEvent[];
}

export const teams = {
  calendar(start: string, end: string, mine: boolean): Promise<TeamCalendar> {
    return api.get<TeamCalendar>("/ops/teams/calendar", { start, end, mine });
  },
  availability(): Promise<TeamAvailability> {
    return api.get<TeamAvailability>("/ops/teams/availability");
  },
  status(): Promise<TeamsStatus> {
    return api.get<TeamsStatus>("/ops/teams/status");
  },
  test(target: "me" | "channel"): Promise<TeamsResult> {
    return api.post<TeamsResult>("/ops/teams/test", { target });
  },
  digest(): Promise<TeamsResult> {
    return api.post<TeamsResult>("/ops/teams/digest", {});
  },
  meeting(input: TeamsMeetingInput): Promise<TeamsResult> {
    return api.post<TeamsResult>("/ops/teams/meeting", input);
  },
};
