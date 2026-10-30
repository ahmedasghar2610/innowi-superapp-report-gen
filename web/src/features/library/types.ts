/** Ops CRM Library + credentials vault — mirror app/schemas/library.py. */
import type { PersonRef } from "@/features/tickets/types";

export type LibrarySection = "COMPANY" | "PROCESS" | "TEMPLATE" | "MERCHANT";

export interface LibraryPageSummary {
  id: string;
  title: string;
  section: LibrarySection;
  parentId: string | null;
  merchant: { id: string; name: string } | null;
  version: number;
  position: number;
  updatedAt: string;
}

export interface LibraryPage extends LibraryPageSummary {
  /** Markdown */
  body: string;
  owner: PersonRef | null;
  updatedBy: PersonRef | null;
  createdAt: string;
  childCount: number;
  canDelete: boolean;
  /** Tickets that link this page (newest first). */
  linkedTickets?: { key: string; title: string; status: string }[];
}

export interface LibraryVersion {
  version: number;
  title: string;
  body: string;
  editedBy: PersonRef | null;
  createdAt: string;
}

export interface CreateLibraryPageInput {
  title: string;
  section: LibrarySection;
  parentId?: string | null;
  merchantId?: string | null;
  body?: string;
}

export interface UpdateLibraryPageInput {
  title?: string;
  body?: string;
  section?: LibrarySection;
  parentId?: string | null;
  merchantId?: string | null;
  ownerId?: string | null;
  baseVersion?: number;
}

export interface Credential {
  id: string;
  label: string;
  username: string | null;
  url: string | null;
  notes: string | null;
  merchant: { id: string; name: string } | null;
  updatedAt: string;
}

export interface CredentialsResponse {
  data: Credential[];
  canReveal: boolean;
  canManage: boolean;
  configured: boolean;
}

export interface CredentialInput {
  label: string;
  username?: string | null;
  url?: string | null;
  notes?: string | null;
  secret?: string;
  merchantId?: string | null;
}

export interface CredentialLogEntry {
  id: string;
  action: "CREATED" | "UPDATED" | "REVEALED" | "DELETED";
  credentialLabel: string;
  user: PersonRef | null;
  userEmail: string | null;
  reason: string | null;
  createdAt: string;
}

export const SECTION_LABEL: Record<LibrarySection, string> = {
  COMPANY: "Company",
  PROCESS: "Processes & SOPs",
  TEMPLATE: "Templates",
  MERCHANT: "Merchants",
};
export const SECTION_ORDER: LibrarySection[] = ["COMPANY", "PROCESS", "TEMPLATE", "MERCHANT"];
