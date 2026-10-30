import type { BadgeTone } from "@/components/ui";
import type { PartnerLeadEvent, PartnerLeadStatus, PartnerTeamMember } from "./types";

export const STATUS_LABEL: Record<PartnerLeadStatus, string> = {
  new: "New",
  contacted: "Contacted",
  qualified: "Qualified",
  proposal: "Proposal sent",
  won: "Won",
  lost: "Lost",
  spam: "Spam",
};

export const STATUS_TONE: Record<PartnerLeadStatus, BadgeTone> = {
  new: "accent",
  contacted: "neutral",
  qualified: "neutral",
  proposal: "neutral",
  won: "success",
  lost: "outline",
  spam: "danger",
};

/**
 * Which button on partners.innowi.com the person clicked before applying.
 * Mirrors CTA_LABELS in the partner portal (innowi-nextjs/components/admin/AdminApp.tsx).
 */
const CTA_LABELS: Record<string, string> = {
  "nav-apply": "Header “Apply now”",
  "mobile-header-apply": "Mobile header “Apply”",
  "mobile-menu-apply": "Mobile menu",
  "hero-apply": "Hero “Apply to partner”",
  "calculator-apply": "Income calculator",
  "steps-apply": "“Three steps” section",
  "faq-call": "FAQ “Book a call”",
  "final-apply": "Bottom “Apply now”",
  "final-call": "Bottom “Book a discovery call”",
  "footer-apply": "Footer “Apply”",
  "footer-call": "Footer “Book a call”",
  "sticky-mobile-apply": "Mobile sticky button",
  "link-apply": "Direct link (#apply)",
  "link-apply-call": "Direct link (#apply-call)",
};

export function ctaLabel(cta: string | null | undefined): string {
  if (!cta || cta === "unknown") return "Unknown";
  if (CTA_LABELS[cta]) return CTA_LABELS[cta];
  if (cta.startsWith("card-")) return `Partner card: ${cta.slice(5)}`;
  return cta;
}

export function memberName(email: string | null | undefined, team: PartnerTeamMember[] | undefined): string {
  if (!email) return "Unassigned";
  return team?.find((m) => m.email === email)?.name || email;
}

/** One line of history, in plain words. */
export function describeEvent(e: PartnerLeadEvent, team: PartnerTeamMember[] | undefined): string {
  const d = (e.detail ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  switch (e.type) {
    case "created":
      return `Applied via ${ctaLabel(str(d.source_cta))}`;
    case "status": {
      const to = str(d.to) as PartnerLeadStatus;
      return `Status → ${STATUS_LABEL[to] ?? to}`;
    }
    case "assigned":
      return d.to ? `Assigned to ${memberName(str(d.to), team)}` : "Unassigned";
    case "notified": {
      const parts = [d.email ? "email" : "", d.teams ? "Teams" : ""].filter(Boolean);
      return parts.length ? `Team notified (${parts.join(" + ")})` : "Team notified";
    }
    case "assignee_notified":
      return `Owner notified${d.to ? ` (${memberName(str(d.to), team)})` : ""}`;
    case "reminder":
      return "Reminder sent — still unassigned";
    case "forwarded":
      return d.to ? `Forwarded to ${str(d.to)}` : "Forwarded";
    case "emailed":
      return "Emailed the applicant";
    default:
      return e.type.charAt(0).toUpperCase() + e.type.slice(1);
  }
}
