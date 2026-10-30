import type { BadgeTone } from "@/components/ui";
import type { CameFrom, DealEventKind, DealStage, DeployedBy, HiredBy, OrganizationKind, OrganizationStatus, PartnerStage } from "./types";

export { MERCHANT_STATUS_LABEL, MERCHANT_STATUS_TONE, formatDay, money } from "@/features/churn/labels";

export const STAGE_LABEL: Record<DealStage, string> = {
  NEW: "New",
  DEMO_BOOKED: "Demo booked",
  DEMO_DONE: "Demo done",
  QUOTE_SENT: "Quote sent",
  ORDER_FORM_SIGNED: "Order form signed",
  PROCESSOR_SETUP: "Processor setup",
  MENU: "Menu",
  READY_TO_DEPLOY: "Ready to deploy",
  DEPLOYED: "Deployed",
  LIVE: "Live",
  LOST: "Lost",
};

/** Sales steps are neutral/accent, onboarding steps warning, the end states success/danger. */
export const STAGE_TONE: Record<DealStage, BadgeTone> = {
  NEW: "neutral",
  DEMO_BOOKED: "accent",
  DEMO_DONE: "accent",
  QUOTE_SENT: "accent",
  ORDER_FORM_SIGNED: "warning",
  PROCESSOR_SETUP: "warning",
  MENU: "warning",
  READY_TO_DEPLOY: "warning",
  DEPLOYED: "warning",
  LIVE: "success",
  LOST: "danger",
};

/** Which part of the journey a stage belongs to — the board groups columns by this. */
export function stagePhase(stage: DealStage): "sales" | "onboarding" | "done" {
  if (stage === "LIVE" || stage === "LOST") return "done";
  if (stage === "NEW" || stage === "DEMO_BOOKED" || stage === "DEMO_DONE" || stage === "QUOTE_SENT") return "sales";
  return "onboarding";
}

export const ORG_KIND_LABEL: Record<OrganizationKind, string> = {
  PARTNER_ISO: "ISO",
  PARTNER_AGENT: "Agent",
  PARTNER_RESELLER: "Reseller",
  CONTRACTOR: "Contractor",
  OTHER: "Other",
};

export const ORG_KIND_TONE: Record<OrganizationKind, BadgeTone> = {
  PARTNER_ISO: "accent",
  PARTNER_AGENT: "accent",
  PARTNER_RESELLER: "accent",
  CONTRACTOR: "warning",
  OTHER: "neutral",
};

export const ORG_STATUS_LABEL: Record<OrganizationStatus, string> = {
  PROSPECT: "Prospect",
  ACTIVE: "Active",
  INACTIVE: "Inactive",
};

export const ORG_STATUS_TONE: Record<OrganizationStatus, BadgeTone> = {
  PROSPECT: "neutral",
  ACTIVE: "success",
  INACTIVE: "outline",
};

export const DEPLOYED_BY_LABEL: Record<DeployedBy, string> = { INNOWI: "Innowi (1st party)", CONTRACTOR: "Contractor (3rd party)" };
export const HIRED_BY_LABEL: Record<HiredBy, string> = { INNOWI: "Hired by Innowi", PARTNER: "Hired by the partner" };

export const EVENT_LABEL: Record<DealEventKind, string> = {
  CREATED: "Deal created",
  STAGE_CHANGED: "Stage changed",
  NOTE: "Note",
  QUOTE_LINKED: "Quote linked",
  QUOTE_EXECUTED: "Quote signed by both parties",
  OWNER_CHANGED: "Owner changed",
};

export const QUOTE_STATUS_LABEL: Record<string, string> = {
  REQUESTED: "Requested",
  PROPOSED: "Proposed",
  ACCEPTED: "Accepted",
  SIGNED: "Signed by client",
  EXECUTED: "Executed",
  DECLINED: "Declined",
  CLOSED: "Closed",
};

export const QUOTE_STATUS_TONE: Record<string, BadgeTone> = {
  REQUESTED: "accent",
  PROPOSED: "accent",
  ACCEPTED: "success",
  SIGNED: "warning",
  EXECUTED: "success",
  DECLINED: "danger",
  CLOSED: "outline",
};

/** "2026-10-30T18:00:00Z" → the value a datetime-local input wants (viewer's zone). */
export function toLocalInput(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The reverse: a datetime-local value → ISO (UTC) for the API. */
export function fromLocalInput(v: string): string | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

// ─── the partner ladder ──────────────────────────────────────────────────
export const PARTNER_STAGE_LABEL: Record<PartnerStage, string> = {
  NEW: "New",
  DEMO_SCHEDULED: "Demo scheduled",
  DEMO_HELD: "Demo held",
  NDA_SENT: "NDA sent",
  NDA_SIGNED: "NDA signed",
  AGREEMENT_SENT: "Agreement sent",
  AGREEMENT_SIGNED: "Agreement signed",
  COLLATERAL_SENT: "Collateral sent",
  IU_ENROLLED: "IU enrollment",
  CERTIFIED: "Certified",
  NOT_INTERESTED: "Not interested",
};

/** Early steps neutral, paperwork accent, Innowi University warning-free success at the end. */
export const PARTNER_STAGE_TONE: Record<PartnerStage, BadgeTone> = {
  NEW: "neutral",
  DEMO_SCHEDULED: "accent",
  DEMO_HELD: "accent",
  NDA_SENT: "accent",
  NDA_SIGNED: "accent",
  AGREEMENT_SENT: "warning",
  AGREEMENT_SIGNED: "warning",
  COLLATERAL_SENT: "warning",
  IU_ENROLLED: "warning",
  CERTIFIED: "success",
  NOT_INTERESTED: "outline",
};

export const CAME_FROM_LABEL: Record<CameFrom, string> = {
  ELAVON: "Elavon",
  BMO: "BMO",
  DIRECT: "Direct",
  CONFERENCE: "Conference",
  INBOUND_PARTNER: "Inbound · Partner",
  INBOUND_SUPPORT: "Inbound · Support",
  INBOUND_GENERIC: "Inbound · Generic",
};

/** Where the pick list in the drawer explains each option. */
export const CAME_FROM_HINT: Record<CameFrom, string> = {
  ELAVON: "An Elavon partner manager introduced them",
  BMO: "Through BMO Payment Solutions",
  DIRECT: "Someone at Innowi reached out",
  CONFERENCE: "Met at a conference or trade show",
  INBOUND_PARTNER: "Applied on partners.innowi.com",
  INBOUND_SUPPORT: "Came in through the support line",
  INBOUND_GENERIC: "Any other inbound (website, e-mail, call)",
};

export function cameFromLabel(v: CameFrom | null | undefined): string {
  return v ? CAME_FROM_LABEL[v] : "Not set";
}
