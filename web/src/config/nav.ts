import type { LucideIcon } from "lucide-react";
import type { Capability } from "@/features/auth/capabilities";
import {
  LayoutGrid,
  Sparkles,
  Store,
  TriangleAlert,
  GitCompareArrows,
  FileChartColumn,
  Database,
  Milestone,
  Ticket,
  SquareKanban,
  CalendarDays,
  Video,
  UserCheck,
  Users,
  BookOpen,
  Search,
  MapPin,
  Globe,
  Target,
  Mail,
  Star,
  Sun,
  KanbanSquare,
  CircleDollarSign,
  Building2,
  CalendarCheck,
  LifeBuoy,
  Handshake,
  Building,
  BookUser,
  FileText,
  UsersRound,
  UserCog,
  Plug,
  History,
  RefreshCw,
  Tags,
  ChartColumn,
  Settings,
  UserMinus,
  Lightbulb,
} from "lucide-react";

/**
 * Live count shown as a pill on a nav entry. The sidebar resolves each key
 * (components/layout/sidebar.tsx → useNavBadges) and hides the pill when the
 * count is 0 or not loaded yet.
 */
export type NavBadgeKey = "issues" | "tickets-open" | "tickets-mine";

export interface NavLink {
  key: string;
  label: string;
  href: string;
  icon: LucideIcon;
  /** Capability required to see this entry (features/auth/capabilities.ts); omit for "everyone". */
  capability?: Capability;
  /** Highlight only on this exact path, not its children (e.g. /sales vs /sales/pipeline). */
  exact?: boolean;
  badge?: NavBadgeKey;
  /** Small grey tag for pages that are still placeholders (e.g. "Soon"). */
  tag?: string;
  /** Extra path prefixes that should also mark this entry active. */
  activeAlso?: string[];
}

export interface NavGroup {
  key: string;
  label: string;
  /** Capability required to see the whole group; items may narrow further with their own. */
  capability?: Capability;
  items: NavLink[];
  /** Shows a chevron; the open/closed state is remembered per browser. */
  collapsible?: boolean;
}

/**
 * Left navigation:
 *
 *   Overview   Assistant · Command Center · Merchants · Churned accounts · Issues · Changes · Reports · Data Quality · Roadmap · Requests
 *   Ops CRM    Tickets · Assigned to me · Board · Calendar · Meetings · Ops Hub · Library · Team reports
 *   Marketing  SEO · GBP · Website · Ads · Email & SMS · Reviews
 *   Sales      Deals · Quotes
 *   Partners   Organizations · Partner leads · Network
 *   Salesforce (read-only)
 *              My Day · Salesforce pipeline · Salesforce deals · Salesforce accounts · Visits ·
 *              Salesforce cases · Case analysis · Sales team
 *   Admin      Team members · Integrations · Audit Log · Salesforce sync · Price list
 *
 * Each entry names the capability it needs, so every role only sees what it
 * can open (the API enforces the same rules). Not in the menu but still
 * reachable by URL: Orders, Guests, Payments.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    key: "overview",
    label: "Overview",
    items: [
      { key: "assistant", label: "Assistant", href: "/", icon: Sparkles, capability: "assistant.use", exact: true },
      { key: "home", label: "Command Center", href: "/command-center", icon: LayoutGrid, capability: "profile.view" },
      { key: "merchants", label: "Merchants", href: "/merchants", icon: Store, capability: "profile.view" },
      { key: "churn", label: "Churned accounts", href: "/churn", icon: UserMinus, capability: "churn.view" },
      { key: "issues", label: "Issues", href: "/issues", icon: TriangleAlert, badge: "issues", capability: "profile.view" },
      { key: "changes", label: "Changes", href: "/changes", icon: GitCompareArrows, capability: "profile.view" },
      { key: "reports", label: "Reports", href: "/reports", icon: FileChartColumn, capability: "profile.view" },
      { key: "data-quality", label: "Data Quality", href: "/data-quality", icon: Database, capability: "profile.view" },
      { key: "roadmap", label: "Roadmap", href: "/roadmap", icon: Milestone, capability: "roadmap.view" },
      { key: "requests", label: "Requests", href: "/requests", icon: Lightbulb, capability: "requests.view" },
    ],
  },
  {
    key: "ops-crm",
    label: "Ops CRM",
    capability: "ticket.view",
    collapsible: true,
    items: [
      { key: "ops-tickets", label: "Tickets", href: "/ops/tickets", icon: Ticket, badge: "tickets-open" },
      { key: "ops-my-work", label: "Assigned to me", href: "/ops/my-work", icon: UserCheck, badge: "tickets-mine" },
      { key: "ops-board", label: "Board", href: "/ops/board", icon: SquareKanban },
      { key: "ops-calendar", label: "Calendar", href: "/ops/calendar", icon: CalendarDays },
      { key: "ops-meetings", label: "Meetings", href: "/ops/meetings", icon: Video, capability: "meetings.view" },
      { key: "ops-hub", label: "Ops Hub", href: "/ops/hub", icon: Users },
      { key: "ops-library", label: "Library", href: "/ops/library", icon: BookOpen, capability: "library.view" },
      { key: "ops-reports", label: "Team reports", href: "/ops/reports", icon: FileChartColumn },
    ],
  },
  {
    key: "marketing",
    label: "Marketing",
    collapsible: true,
    items: [
      { key: "seo", label: "SEO", href: "/web/seo", icon: Search, capability: "seo.view" },
      { key: "gbp", label: "GBP", href: "/web/gbp", icon: MapPin, capability: "gbp.view" },
      { key: "website", label: "Website", href: "/web/website", icon: Globe, capability: "profile.view" },
      { key: "ads", label: "Ads", href: "/ads", icon: Target, capability: "ads.view" },
      { key: "email-sms", label: "Email & SMS", href: "/marketing/email-sms", icon: Mail, capability: "profile.view", tag: "Soon" },
      { key: "reviews", label: "Reviews", href: "/reviews", icon: Star, capability: "profile.view", tag: "Soon" },
      // Merchant Reports (features/report-gen). Shown only when the API's REPORT_GEN_ENABLED flag is mirrored here.
      ...(process.env.NEXT_PUBLIC_REPORT_GEN_ENABLED === "true"
        ? [{ key: "report-gen", label: "Merchant Reports", href: "/report-gen", icon: FileChartColumn, capability: "report_gen.view" as const }]
        : []),
    ],
  },
  {
    // The Super App's own sales records: deals (each one creates or points at a
    // merchant) and the quotes sent with them.
    key: "sales",
    label: "Sales",
    items: [
      { key: "deals", label: "Deals", href: "/deals", icon: KanbanSquare, capability: "deals.view" },
      { key: "quotes", label: "Quotes", href: "/quotes", icon: FileText, capability: "quotes.view" },
    ],
  },
  {
    // One partner ladder: a business card (Network) or an application from
    // partners.innowi.com (Partner leads) leads to an Organization — the one
    // record per ISO, agent, reseller or contractor.
    key: "partners",
    label: "Partners",
    items: [
      { key: "organizations", label: "Organizations", href: "/organizations", icon: Building, capability: "organizations.view" },
      { key: "partners", label: "Partner leads", href: "/partners", icon: Handshake, exact: true, capability: "partners.view" },
      { key: "partner-network", label: "Network", href: "/partners/network", icon: BookUser, capability: "partners.view" },
    ],
  },
  {
    // A read-only copy of Innowi's Salesforce (features/sales), kept until the
    // switch-over. Nothing here is a Super App record: the names say
    // "Salesforce" wherever they could be mistaken for Merchants or Deals.
    // Executives see only their own Salesforce records; the API enforces that.
    key: "salesforce",
    label: "Salesforce (read-only)",
    collapsible: true,
    items: [
      { key: "sales-day", label: "My Day", href: "/sales", icon: Sun, exact: true, capability: "sales.view" },
      { key: "sales-pipeline", label: "Salesforce pipeline", href: "/sales/pipeline", icon: KanbanSquare, capability: "sales.view" },
      { key: "sales-deals", label: "Salesforce deals", href: "/sales/deals", icon: CircleDollarSign, capability: "sales.view" },
      { key: "sales-customers", label: "Salesforce accounts", href: "/sales/customers", icon: Building2, capability: "sales.view" },
      { key: "sales-visits", label: "Visits", href: "/sales/visits", icon: CalendarCheck, capability: "sales.view" },
      { key: "sales-cases", label: "Salesforce cases", href: "/sales/cases", icon: LifeBuoy, exact: true, capability: "sales.view" },
      { key: "sales-case-insights", label: "Case analysis", href: "/sales/cases/insights", icon: ChartColumn, capability: "sales.view" },
      { key: "sales-team", label: "Sales team", href: "/sales/team", icon: UsersRound, capability: "sales.viewAll" },
    ],
  },
  {
    key: "admin",
    label: "Admin",
    items: [
      { key: "team-members", label: "Team members", href: "/team-members", icon: UserCog, capability: "users.manage", activeAlso: ["/settings/team"] },
      { key: "ops-integrations", label: "Integrations", href: "/ops/integrations", icon: Plug, capability: "profile.view", activeAlso: ["/settings/integrations"] },
      { key: "audit-log", label: "Audit Log", href: "/audit-log", icon: History, capability: "audit.view" },
      { key: "sales-admin", label: "Salesforce sync", href: "/sales/admin", icon: RefreshCw, capability: "sales.manage" },
      { key: "price-list", label: "Price list", href: "/quotes/price-list", icon: Tags, capability: "quotes.pricing" },
    ],
  },
];

/** Pinned above the account row. Empty: Integrations and Audit Log live in the
 *  Admin group. The sidebar hides an empty list. */
export const NAV_BOTTOM: NavLink[] = [];

export const NAV_FOOTER: NavLink = {
  key: "settings",
  label: "Settings",
  href: "/settings",
  icon: Settings,
};
