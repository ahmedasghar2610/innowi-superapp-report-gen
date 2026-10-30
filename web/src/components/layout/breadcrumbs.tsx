"use client";

import { Fragment } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { useMerchant } from "@/features/merchants/api";
import { MERCHANT_MODULE_TABS } from "@/features/merchants/data/merchant-modules";
import { NAV_GROUPS } from "@/config/nav";
import { useOrganizationDetail } from "@/features/deals/queries";

const LABELS: Record<string, string> = {
  merchants: "Merchants",
  "command-center": "Command Center",
  issues: "Issues",
  marketing: "Marketing",
  "email-sms": "Email & SMS",
  rewards: "Rewards",
  web: "Web & Search",
  website: "Website",
  seo: "SEO",
  gbp: "GBP",
  payments: "Payments",
  performance: "Performance",
  settings: "Settings",
  changes: "Changes",
  reports: "Reports",
  orders: "Orders",
  guests: "Guests",
  ads: "Ads",
  unmapped: "Unmapped accounts",
  "monthly-report": "Monthly report",
  reviews: "Reviews",
  "data-quality": "Data Quality",
  "audit-log": "Audit Log",
  sales: "Sales",
  pipeline: "Salesforce pipeline",
  deals: "Deals",
  customers: "Salesforce accounts",
  visits: "Visits",
  cases: "Salesforce cases",
  insights: "Analysis",
  team: "Team",
  admin: "Salesforce sync",
  "ops-crm": "Ops CRM",
  "data-setup": "Data setup",
  new: "New",
  edit: "Edit",
  quotes: "Quotes",
  "price-list": "Price list",
  roadmap: "Roadmap",
  churn: "Churned accounts",
  organizations: "Organizations",
  requests: "Requests",
};

/** Labels for segments under /ops (Ops CRM). Checked first so e.g.
 *  /ops/reports reads "Team reports", not the top-level "Reports". */
const OPS_LABELS: Record<string, string> = {
  ops: "Ops CRM",
  tickets: "Tickets",
  board: "Board",
  calendar: "Calendar",
  meetings: "Meetings",
  "my-work": "Assigned to me",
  hub: "Ops Hub",
  library: "Library",
  reports: "Team reports",
  integrations: "Integrations",
  credentials: "Credentials vault",
};

/** Labels for segments under /web/seo. */
const SEO_LABELS: Record<string, string> = {
  kpis: "KPI Studio",
  "on-hold": "On hold",
  "site-settings": "Site settings",
  edit: "Page editor",
  crawl: "Full-site crawl",
};

const prettify = (s: string) =>
  LABELS[s] ??
  // Record references (R-1004, Q261018-DBDJ …) read as written.
  (/^[A-Z]+\d*-[A-Z0-9]+$/.test(s) ? s : s.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()));

/**
 * URL folders that have no page of their own. They never become links, and the ones in SKIP
 * are left out of the trail altogether (the menu item before them already covers them).
 */
const NO_PAGE = new Set(["/web", "/marketing", "/sales"]);
const SKIP = new Set(["/web/seo/sites", "/web/website/studio"]);

/** Sidebar groups that are only headings (no page) — shown as plain text. Ops CRM has its own page. */
const GROUP_HREF: Record<string, string | undefined> = { "ops-crm": "/ops" };

/**
 * The sidebar entry a path belongs to (longest matching href), so the trail starts the way the
 * menu reads: "Marketing > SEO", "Ops CRM > Tickets", "Admin > Team members".
 */
function navMatch(path: string) {
  let best: { group: (typeof NAV_GROUPS)[number]; label: string; href: string } | undefined;
  for (const group of NAV_GROUPS)
    for (const item of group.items) {
      if (item.href === "/" || !(path === item.href || path.startsWith(item.href + "/"))) continue;
      if (!best || item.href.length > best.href.length) best = { group, label: item.label, href: item.href };
    }
  return best;
}

interface Crumb {
  /** Stable React key — distinct from `href` so a merchant crumb and a
   *  same-named tab crumb (e.g. both pointing under .../profile) never collide. */
  key: string;
  /** Omitted for a crumb that has no page (a sidebar group heading). */
  href?: string;
  label: string;
  loading?: boolean;
  /** A path segment with no page of its own (e.g. /web): shown as text, not a link. */
  noLink?: boolean;
}

/**
 * Auto-derives a breadcrumb from the pathname. Feature screens can render their
 * own crumb (e.g. a merchant name) instead of relying on this default.
 *
 * `/merchants/:id/...` is special-cased: the raw id segment is replaced with
 * the merchant's name (reusing the same TanStack Query cache the workspace
 * shell already populated, so this doesn't trigger an extra request), and a
 * `/modules/:moduleId` pair collapses into a single crumb using that module's
 * label instead of showing "Modules" followed by a raw id.
 */
export function Breadcrumbs() {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);

  const merchantId = segments[0] === "merchants" && segments[1] ? segments[1] : undefined;
  const { data: merchant } = useMerchant(merchantId);
  const orgId = segments[0] === "organizations" && segments[1] ? segments[1] : undefined;
  const { data: org } = useOrganizationDetail(orgId);

  if (segments.length === 0) {
    return <span className="text-sm font-normal text-foreground">Home</span>;
  }

  const crumbs = buildCrumbs(segments, merchant?.restaurantName, org?.name);

  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
      {crumbs.map((crumb, i) => {
        const isLast = i === crumbs.length - 1;
        return (
          <Fragment key={crumb.key}>
            {i > 0 && <ChevronRight className="size-4 text-muted-foreground" />}
            {isLast || crumb.noLink ? (
              <span
                className={
                  crumb.loading
                    ? "inline-block h-3.5 w-24 animate-pulse rounded bg-accent"
                    : isLast
                      ? "truncate font-normal text-foreground"
                      : "truncate"
                }
              >
                {crumb.loading ? "" : crumb.label}
              </span>
            ) : crumb.href ? (
              <Link href={crumb.href} className="truncate hover:text-foreground">
                {crumb.label}
              </Link>
            ) : (
              <span className="truncate">{crumb.label}</span>
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}

function buildCrumbs(segments: string[], merchantName: string | undefined, orgName?: string): Crumb[] {
  // /quotes/links/:id and /quotes/requests/:id: there is no "links" or
  // "requests" page, so skip that segment and name the record instead of its id.
  if (segments[0] === "quotes" && (segments[1] === "links" || segments[1] === "requests") && segments[2]) {
    return [
      { key: "quotes", href: "/quotes", label: "Quotes" },
      { key: "record", href: "/" + segments.join("/"), label: segments[1] === "links" ? "Quote link" : "Request" },
    ];
  }

  // Not a /merchants/:id/... route — default segment-by-segment trail.
  if (!(segments[0] === "merchants" && segments[1] && segments[1] !== "new")) {
    const inOps = segments[0] === "ops";
    const inSeo = segments[0] === "web" && segments[1] === "seo";
    const path = "/" + segments.join("/");
    const nav = navMatch(path);
    const covered = nav ? nav.href.split("/").filter(Boolean).length : 0;
    const lead: Crumb[] = [];
    if (nav) {
      if (nav.group.key !== "overview")
        lead.push({ key: "group", href: GROUP_HREF[nav.group.key], label: nav.group.label });
      lead.push({ key: "item", href: nav.href, label: nav.label });
    }
    const rest = segments
      .map((seg, i) => ({ seg, i, href: "/" + segments.slice(0, i + 1).join("/") }))
      .filter(({ i, href }) => i >= covered && !SKIP.has(href));
    return [...lead, ...rest.map(({ seg, i, href }) => ({
      key: seg + i,
      href: NO_PAGE.has(href) ? undefined : href,
      // Ticket keys ("OPS-1042") are shown as-is, not prettified to "OPS 1042".
      label:
        (inOps && OPS_LABELS[seg]) ||
        (inOps && /^ops-\d+$/i.test(seg)
          ? seg.toUpperCase()
          : // A Library page id isn't readable; the page shows its own title.
            inOps && segments[i - 1] === "library"
            ? "Page"
            : inOps && segments[i - 1] === "meetings"
              ? "Meeting"
              : // A GBP listing id isn't readable; the page shows the listing name.
                segments[0] === "web" && segments[i - 1] === "gbp"
                ? "Listing report"
                : // SEO site / report ids aren't readable; the page shows the site name.
                  inSeo && i === 3 && segments[2] === "sites"
                  ? "Scorecard"
                  : inSeo && i === 3 && segments[2] === "reports"
                    ? "Report"
                    : inSeo && SEO_LABELS[seg]
                      ? SEO_LABELS[seg]
                : // A Google Ads account id isn't readable either; the page shows the restaurant name.
                  segments[0] === "ads" && i === 1 && seg !== "unmapped" && seg !== "monthly-report"
                  ? "Restaurant"
                  : // A Website studio id isn't readable; the studio shows the site name.
                    segments[0] === "web" && segments[i - 1] === "studio"
                    ? "Studio"
                    : // /organizations/<id>: the page shows the organization's name.
                      segments[0] === "organizations" && i === 1
                      ? orgName ?? "Organization"
                      : // /sales/deals/<Salesforce id> — show a word, not a raw 18-character id.
                      segments[0] === "sales" && i === 2 && !(seg in LABELS)
                      ? "Details"
                      : // /settings/team is "Team & access"; /sales/team stays "Team".
                        segments[0] === "settings" && seg === "team"
                        ? "Team & access"
                        : prettify(seg)),
    }))];
  }

  const merchantId = segments[1];
  const crumbs: Crumb[] = [
    { key: "merchants", href: "/merchants", label: "Merchants" },
    { key: "merchant", href: `/merchants/${merchantId}/profile`, label: merchantName ?? "", loading: !merchantName },
  ];

  const rest = segments.slice(2); // e.g. ["profile"] · ["modules", "marketing"] · ["edit"]
  if (rest.length === 0) return crumbs;

  if (rest[0] === "modules" && rest[1]) {
    const mod = MERCHANT_MODULE_TABS.find((m) => m.id === rest[1]);
    crumbs.push({
      key: "module",
      href: `/merchants/${merchantId}/modules/${rest[1]}`,
      label: mod?.label ?? prettify(rest[1]),
    });
    return crumbs;
  }

  crumbs.push({
    key: "tab",
    href: `/merchants/${merchantId}/${rest[0]}`,
    label: prettify(rest[0]),
  });
  return crumbs;
}
