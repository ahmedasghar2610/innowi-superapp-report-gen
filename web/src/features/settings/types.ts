import type { AuthUser, Role, UserStatus } from "@/features/auth/types";
import type { TicketPriority } from "@/features/tickets/types";

/** Settings types — mirror app/modules/settings/schemas.py in the API. */

export type StartPage = "home" | "tickets" | "my-work";

export type NotificationEvent =
  | "assigned"
  | "mentioned"
  | "statusChanged"
  | "watching"
  | "slaAtRisk"
  | "slaBreached"
  | "dailyDigest"
  | "requests";

export type NotificationChannel = "inApp" | "email" | "teams";

export type Channels = Record<NotificationChannel, boolean>;

export interface Preferences {
  startPage: StartPage;
  notifications: Record<NotificationEvent, Channels>;
}

export interface ManagedUser extends AuthUser {
  grantedCapabilities: string[];
  lastLoginAt: string | null;
  createdAt: string;
}

export interface MySettings {
  user: ManagedUser;
  preferences: Preferences;
  passwordChangedAt: string | null;
}

export interface UpdateMySettingsInput {
  firstName?: string;
  lastName?: string;
  preferences?: Partial<Preferences>;
}

export interface Session {
  id: string;
  ip: string | null;
  userAgent: string | null;
  device: string;
  createdAt: string;
  expiresAt: string;
}

export interface Workspace {
  companyName: string;
  supportEmail: string;
  timezone: string;
  /** Monday = 0 … Sunday = 6. */
  workDays: number[];
  officeHours: { start: string; end: string };
  dateFormat: "D MMM YYYY" | "MM/DD/YYYY" | "DD/MM/YYYY" | "YYYY-MM-DD";
  weekStartsOn: "monday" | "sunday";
}

export interface WorkspaceResponse {
  workspace: Workspace;
  ticketPrefix: string;
  timezones: string[];
  canEdit: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface SlaTarget {
  priority: TicketPriority;
  responseHours: number;
  resolutionHours: number;
}

export interface SlaSettings {
  targets: (SlaTarget & { defaultResponseHours: number; defaultResolutionHours: number })[];
  atRiskShare: number;
  timezone: string;
  workDays: number[];
  isDefault: boolean;
  canEdit: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

export type IntegrationStatus = "connected" | "configured" | "attention" | "not_connected" | "logged_only" | "planned";

export interface Integration {
  key: string;
  name: string;
  description: string;
  status: IntegrationStatus;
  statusText: string;
  usedFor: string[];
  envKeys: string[];
  nextStep: string | null;
}

export interface CreateUserInput {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
  role: Role;
}

export interface UpdateUserInput {
  firstName?: string;
  lastName?: string;
  role?: Role;
  status?: UserStatus;
  grantedCapabilities?: string[];
}

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export const NOTIFICATION_EVENTS: { key: NotificationEvent; label: string; hint: string }[] = [
  { key: "assigned", label: "A ticket is assigned to me", hint: "Including reassignments to you." },
  { key: "mentioned", label: "Someone @mentions me", hint: "In a ticket comment." },
  { key: "statusChanged", label: "My ticket changes status", hint: "When someone else moves a ticket you own." },
  { key: "watching", label: "Tickets I own or watch get activity", hint: "A new comment, or a watched ticket changes status." },
  { key: "slaAtRisk", label: "My ticket's SLA is at risk", hint: "Less than a quarter of the resolution time left." },
  { key: "slaBreached", label: "My ticket breaches its SLA", hint: "Resolution or first-response target missed." },
  { key: "dailyDigest", label: "Daily digest", hint: "One summary at the start of the working day." },
  {
    key: "requests",
    label: "Requests",
    hint: "Replies and decisions on requests you sent, upvoted or commented on (and new requests, if you triage them).",
  },
];

export const CHANNEL_LABEL: Record<NotificationChannel, string> = {
  inApp: "In the app",
  email: "Email",
  teams: "Teams message",
};

/** Capabilities an admin can give one person on top of their role
 *  (API: common/capabilities.USER_GRANTABLE). */
export const GRANTABLE: { key: string; label: string; short: string; hint: string }[] = [
  { key: "ticket.manage", label: "Create & manage tickets", short: "Tickets", hint: "Create, edit, reassign and delete any ticket." },
  { key: "credentials.reveal", label: "Reveal logins", short: "Logins", hint: "See passwords in the credentials vault (always logged). Never for sales roles." },
  { key: "seo.approve", label: "Approve SEO reports", short: "SEO sign-off", hint: "Sign off and send client SEO reports." },
  {
    key: "requests.triage",
    label: "Triage requests",
    short: "Requests triage",
    hint: "Gets every new request; reviews, approves onto the roadmap, or declines.",
  },
  {
    key: "organizations.assign",
    label: "Assign partners",
    short: "Assign partners",
    hint: "Hands partners and an ISO's agents to salespeople. Admins and Sales Managers have it already.",
  },
];

export const ROLE_HINT: Record<Role, string> = {
  SUPER_ADMIN: "Everything, including other admins.",
  ADMIN: "Everything except Super Admin accounts. Manages people and settings.",
  MARKETING_MANAGER: "Merchants, websites, library; reveals logins.",
  MARKETING_EXECUTIVE: "Day-to-day work: tickets assigned to them, library, merchants.",
  SALES_MANAGER: "Sales screens for every salesperson; sees tickets and the library (no logins vault).",
  SALES_EXECUTIVE: "Their own sales records and partner leads; sees tickets and the library (no logins vault).",
};
