"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import { BarChart3, Brain, Construction, FileChartColumn, GitCompareArrows, Gauge, Newspaper, Settings2 } from "lucide-react";
import { Skeleton } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import { useSeoStatus } from "../api";
import { ConnectionStrip } from "./connection";
import { CrawlerStrip } from "./crawler";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Also active on these path prefixes. */
  also?: string[];
  /** UI preview only — no backend yet. */
  preview?: boolean;
}

/** Built tabs. On-hold modules are reached from the "On hold" tab (seo-on-hold.tsx). */
export const SEO_NAV: NavItem[] = [
  { href: "/web/seo", label: "Command", icon: Gauge, also: ["/web/seo/sites"] },
  { href: "/web/seo/intelligence", label: "Intelligence", icon: Brain },
  { href: "/web/seo/blogs", label: "Blog Impact", icon: Newspaper },
  { href: "/web/seo/reports", label: "Reports", icon: FileChartColumn },
  { href: "/web/seo/kpis", label: "KPI Studio", icon: BarChart3 },
  { href: "/web/seo/compare", label: "Compare", icon: GitCompareArrows },
  { href: "/web/seo/site-settings", label: "Site settings", icon: Settings2 },
  { href: "/web/seo/on-hold", label: "On hold", icon: Construction },
];

function isActive(pathname: string, item: NavItem): boolean {
  if (item.href === "/web/seo") return pathname === "/web/seo" || (item.also ?? []).some((p) => pathname.startsWith(p));
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/**
 * /web/seo/* — page title, the data-source strip and the module's tab bar
 * (same underline tabs as the merchant workspace), then the open page.
 */
export function SeoShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const status = useSeoStatus();

  // A single report is a document: no module header, strip or tabs above it (the breadcrumb leads back).
  if (/^\/web\/seo\/reports\/[^/]+/.test(pathname)) return <div className="flex min-w-0 flex-col gap-5">{children}</div>;

  return (
    <div className="flex flex-col gap-5">
      <div className="print:hidden">
        <h1 className="text-2xl font-semibold tracking-[-0.011em] text-foreground">SEO</h1>
        <p className="mt-1 text-table text-muted-foreground">
          Search performance, technical health and client reporting for every website — from Search Console, GA4, PageSpeed and the GBP and Ads modules. Read-only: nothing
          here changes a website or a Google account.
        </p>
      </div>
      <div className="flex flex-col gap-2 print:hidden">
        {status.data ? <ConnectionStrip status={status.data} /> : <Skeleton className="h-14 w-full" />}
        <CrawlerStrip />
      </div>
      <nav className="flex gap-5 overflow-x-auto border-b border-border print:hidden" aria-label="SEO sections">
        {SEO_NAV.map((item) => {
          const active = isActive(pathname, item);
          return (
            <Link
              key={item.href}
              href={item.href}
              scroll={false}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex shrink-0 items-center gap-1.5 whitespace-nowrap py-3 text-sm font-medium transition-colors",
                active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <item.icon className="size-4" />
              {item.label}
              {item.preview && <span className="rounded bg-muted px-1 text-[10px] font-semibold uppercase text-muted-foreground">Preview</span>}
              {active && <span className="absolute inset-x-0 -bottom-px h-[2px] rounded-full bg-primary" />}
            </Link>
          );
        })}
      </nav>
      <div className="flex min-w-0 flex-col gap-5">{children}</div>
    </div>
  );
}
