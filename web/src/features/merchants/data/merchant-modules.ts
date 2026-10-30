import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  UserCog,
  Users,
  Mail,
  Gift,
  Globe,
  Search,
  CreditCard,
  TrendingUp,
  Ticket,
  MapPin,
  Target,
} from "lucide-react";

export interface ModuleTabDef {
  id: string;
  label: string;
  icon: LucideIcon;
  /** true for modules that have real screens today (Overview, Merchant Profiling). */
  built: boolean;
  /** Route under /merchants/[id] for a built module; the others go to /modules/[id]. */
  path?: string;
}

/**
 * Merchant workspace modules — mirrors the prototype's per-merchant tab bar
 * (Overview · Profile · Customers · Email & SMS · Rewards · Website · SEO ·
 * GBP · Payments · Performance), grouped a little for this app's narrower nav
 * (Marketing, Web & Search). Only "Profiling" has real screens; every other
 * module routes to a "coming soon" page scoped to this merchant.
 *
 * Plain data (no "use client") so it can be imported from both the client
 * tab bar (`merchant-module-tabs.tsx`) and the server-rendered placeholder
 * route (`app/(app)/merchants/[merchantId]/modules/[moduleId]/page.tsx`)
 * without crossing a server/client module boundary.
 */
export const MERCHANT_MODULE_TABS: ModuleTabDef[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard, built: true, path: "overview" },
  { id: "profiling", label: "Profiling", icon: UserCog, built: true, path: "profile" },
  { id: "customers", label: "Customers", icon: Users, built: false },
  { id: "marketing", label: "Marketing", icon: Mail, built: false },
  { id: "rewards", label: "Rewards", icon: Gift, built: false },
  // The merchant's website: none / external / managed (features/websites).
  { id: "website", label: "Website", icon: Globe, built: true, path: "website" },
  // Search performance of the SEO sites linked to this merchant (features/seo).
  { id: "seo", label: "SEO", icon: Search, built: true, path: "seo" },
  // Google Business Profile listings linked to this merchant (features/gbp).
  { id: "gbp", label: "GBP", icon: MapPin, built: true, path: "gbp" },
  // Google Ads accounts linked to this merchant (features/ads).
  { id: "ads", label: "Google Ads", icon: Target, built: true, path: "ads" },
  // Ops CRM tickets for this merchant (features/tickets).
  { id: "tickets", label: "Tickets", icon: Ticket, built: true, path: "tickets" },
  // Monthly billing from the paid-marketing revenue report (features/payments).
  { id: "payments", label: "Payments", icon: CreditCard, built: true, path: "payments" },
  { id: "performance", label: "Performance", icon: TrendingUp, built: false },
];
