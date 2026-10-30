import type { Role } from "./types";

/**
 * Client mirror of the API's permission matrix (innowi-superapp-api
 * src/common/auth/capabilities.ts — Central PRD §17.1). Used ONLY to hide or
 * disable affordances so people are not shown buttons that will 403; the API
 * is the enforcement. Keep the two files identical.
 */
export type Capability =
  | "profile.view"
  | "profile.edit"
  | "merchant.create"
  | "merchant.delete"
  | "subscription.write"
  | "accountManager.assign"
  | "accountManager.manage"
  | "users.manage"
  | "audit.view"
  | "website.view"
  | "website.edit"
  | "website.delete"
  /** Make a site public (Live / Update required) or take it down (Inactive). */
  | "website.publish"
  /** Partner leads — applications from partners.innowi.com. */
  | "partners.view"
  /** Change a partner lead's status / owner and add notes. */
  | "partners.edit"
  /** Permanently delete a partner lead (admins). */
  | "partners.delete"
  /** Open the Sales screens (Salesforce data). Without sales.viewAll: own records only. */
  | "sales.view"
  /** See every salesperson's records and the Team screen. */
  | "sales.viewAll"
  /** Run the Salesforce sync and give salespeople logins. */
  | "sales.manage"
  /** Quote builder: see quotes and requests. */
  | "quotes.view"
  /** Send quote links to restaurants. */
  | "quotes.edit"
  /** Give a link special pricing (custom prices, % off). */
  | "quotes.discount"
  /** Edit the price list. */
  | "quotes.pricing"
  /** The home-screen AI assistant (everyone; what it can look up follows the other capabilities). */
  | "assistant.use"
  /** Roadmap: read it (everyone signed in). */
  | "churn.view"
  | "churn.manage"
  | "churn.import"
  | "organizations.view"
  | "organizations.manage"
  | "organizations.assign"
  | "deals.view"
  | "deals.manage"
  | "roadmap.view"
  /** Roadmap: plan phases and items and assign owners. Owners update their own items without it. */
  | "roadmap.manage"
  /** Ops CRM: see tickets, comment, work the ones assigned to you. */
  | "ticket.view"
  /** Ops CRM: create, edit, reassign and delete any ticket. Held by no role —
   *  granted per person (`user.grantedCapabilities`), today Aima and Maheen. */
  | "ticket.manage"
  /** Ops CRM Meetings (Fathom recordings and transcripts) — marketing staff only. */
  | "meetings.view"
  /** Settings: edit workspace details, SLA targets and projects (Admin). */
  | "settings.manage"
  /** Google Business Profile reports and reporting notes (all staff). */
  | "gbp.view"
  /** Connect the Google account, run a sync, link listings to merchants (managers). */
  | "gbp.manage"
  /** Google Ads reports and Analysis / Future Actions comments (all staff). */
  | "ads.view"
  /** Connect Google Ads, run a sync, link accounts to merchants, edit ticket inputs, archive (managers). */
  | "ads.manage"
  /** SEO pages and working findings (all staff). */
  | "seo.view"
  /** Connect Search Console & GA4, run a sync, site settings, tracked keywords, KPI targets (managers). */
  | "seo.manage"
  /** Sign off and send client SEO reports (managers, or granted to one person). */
  | "seo.approve"
  /** Ops CRM Library (team wiki): read pages (everyone, sales included). */
  | "library.view"
  /** Write Library pages (marketing staff). */
  | "library.edit"
  /** Delete Library pages (managers). */
  | "library.delete"
  /** Credentials vault: see which logins exist (marketing staff; never sales). */
  | "credentials.view"
  /** Reveal a stored secret — always logged (managers, or granted to one person). */
  | "credentials.reveal"
  /** Add, change and delete vault entries (managers). */
  | "credentials.manage"
  /** Requests: everyone sends ideas, bugs and complaints, sees everyone's and upvotes. */
  | "requests.view"
  | "requests.create"
  /** Review requests, approve them onto the roadmap or decline (no role: Super Admins + granted people). */
  | "requests.triage"
  /** Merchant Reports: open the queue and read drafts (all staff). */
  | "report_gen.view"
  /** Generate, edit and delete report drafts (all staff). */
  | "report_gen.manage"
  /** Approve and send merchant reports (managers, or granted to one person). */
  | "report_gen.approve";

// Access levels — keep identical to the API's app/common/capabilities.py:
//   Admin: everything · Marketing Manager: sees everything (partner leads read-only)
//   Marketing Executive: marketing only · Sales Executive: partner leads / sales only (own Salesforce records)
//   Sales Manager: what a Sales Executive has, plus every salesperson's Salesforce records
const STAFF: readonly Role[] = ["ADMIN", "MARKETING_MANAGER", "MARKETING_EXECUTIVE"];
const SALES_VIEW: readonly Role[] = ["ADMIN", "MARKETING_MANAGER", "SALES_MANAGER", "SALES_EXECUTIVE"];
const SALES_EDIT: readonly Role[] = ["ADMIN", "SALES_MANAGER", "SALES_EXECUTIVE"];
const SALES_SEE_ALL: readonly Role[] = ["ADMIN", "MARKETING_MANAGER", "SALES_MANAGER"];
const MANAGERS: readonly Role[] = ["ADMIN", "MARKETING_MANAGER"];
const ADMINS: readonly Role[] = ["ADMIN"];
const EVERYONE: readonly Role[] = ["ADMIN", "MARKETING_MANAGER", "MARKETING_EXECUTIVE", "SALES_MANAGER", "SALES_EXECUTIVE"];

export const CAPABILITIES: Readonly<Record<Capability, readonly Role[]>> = {
  "profile.view": STAFF,
  "profile.edit": STAFF,
  "merchant.create": MANAGERS,
  "merchant.delete": ADMINS,
  "subscription.write": MANAGERS,
  "accountManager.assign": MANAGERS,
  "accountManager.manage": MANAGERS,
  "users.manage": ADMINS,
  "audit.view": MANAGERS,
  "website.view": STAFF,
  "website.edit": STAFF,
  "website.delete": MANAGERS,
  "website.publish": MANAGERS,
  "partners.view": SALES_VIEW,
  "partners.edit": SALES_EDIT,
  "partners.delete": ADMINS,
  "sales.view": SALES_VIEW,
  "sales.viewAll": SALES_SEE_ALL,
  "sales.manage": ADMINS,
  "quotes.view": SALES_VIEW,
  "quotes.edit": SALES_VIEW,
  "quotes.discount": ["ADMIN", "MARKETING_MANAGER", "SALES_MANAGER"],
  "quotes.pricing": ADMINS,
  "assistant.use": ["ADMIN", "MARKETING_MANAGER", "MARKETING_EXECUTIVE", "SALES_MANAGER", "SALES_EXECUTIVE"],
  "roadmap.view": EVERYONE,
  "roadmap.manage": ADMINS,
  // Churned accounts (win-back list): everyone reads, sales + managers work it, managers import.
  "churn.view": EVERYONE,
  "churn.manage": SALES_VIEW,
  "churn.import": ["ADMIN", "MARKETING_MANAGER", "SALES_MANAGER"],
  "organizations.view": EVERYONE,
  "organizations.manage": SALES_VIEW,
  "organizations.assign": ["ADMIN", "SALES_MANAGER"],
  "deals.view": EVERYONE,
  "deals.manage": SALES_VIEW,
  // Ops CRM (Shayan, 2026-10-19): sales roles also see tickets and the Library, never the vault.
  "ticket.view": EVERYONE,
  "ticket.manage": [],
  "meetings.view": STAFF,
  "settings.manage": ADMINS,
  "gbp.view": STAFF,
  "gbp.manage": MANAGERS,
  "ads.view": STAFF,
  "ads.manage": MANAGERS,
  "seo.view": STAFF,
  "seo.manage": MANAGERS,
  "seo.approve": MANAGERS,
  "library.view": EVERYONE,
  "library.edit": STAFF,
  "library.delete": MANAGERS,
  "credentials.view": STAFF,
  "credentials.reveal": MANAGERS,
  "credentials.manage": MANAGERS,
  "requests.view": EVERYONE,
  "requests.create": EVERYONE,
  "requests.triage": [],
  "report_gen.view": STAFF,
  "report_gen.manage": STAFF,
  "report_gen.approve": MANAGERS,
};

/** Capabilities that can be granted to one person on top of their role
 *  (API: common/capabilities.USER_GRANTABLE). */
export const USER_GRANTABLE: readonly Capability[] = [
  "ticket.manage",
  "credentials.reveal",
  "seo.approve",
  "requests.triage",
  "organizations.assign",
  "report_gen.approve",
];

/**
 * True when `role` holds `capability`, or it was granted to this person
 * (`grants` = `user.grantedCapabilities`). SUPER_ADMIN holds everything; no
 * role holds nothing, grants included.
 */
export function hasCapability(
  role: Role | undefined | null,
  capability: Capability,
  grants?: readonly string[] | null,
): boolean {
  if (!role) return false;
  if (role === "SUPER_ADMIN") return true;
  if (CAPABILITIES[capability].includes(role)) return true;
  // The sales roles never get into the credentials vault, whatever is granted (API: GRANT_BLOCKED).
  if (capability === "credentials.reveal" && (role === "SALES_MANAGER" || role === "SALES_EXECUTIVE")) return false;
  return USER_GRANTABLE.includes(capability) && !!grants?.includes(capability);
}
