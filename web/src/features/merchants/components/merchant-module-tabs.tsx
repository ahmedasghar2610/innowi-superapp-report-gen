"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils/cn";
import { MERCHANT_MODULE_TABS } from "@/features/merchants/data/merchant-modules";

/**
 * Primary module navigation for the merchant workspace — mirrors the
 * prototype's per-merchant tab bar (Overview · Profile · Customers ·
 * Email & SMS · Rewards · Website · SEO · GBP · Payments · Performance).
 * Classic full-width underline tabs, so this reads unambiguously as *the*
 * page-level navigation. Only "Profiling" has real screens; every other
 * module routes to a "coming soon" page scoped to this merchant.
 */
export function MerchantModuleTabs({ merchantId }: { merchantId: string }) {
  const pathname = usePathname();

  return (
    <div className="flex gap-5 overflow-x-auto border-b border-border" role="tablist" aria-label="Merchant modules">
      {MERCHANT_MODULE_TABS.map((mod) => {
        const base = `/merchants/${merchantId}`;
        const href = mod.built ? `${base}/${mod.path}` : `${base}/modules/${mod.id}`;
        // Built modules own their own path; Profiling is everything else that
        // isn't a placeholder module (its screens live at several sub-paths).
        const builtPaths = MERCHANT_MODULE_TABS.filter((m) => m.built && m.id !== "profiling").map((m) => `${base}/${m.path}`);
        const active =
          mod.built && mod.id !== "profiling"
            ? pathname === `${base}/${mod.path}` || pathname.startsWith(`${base}/${mod.path}/`)
            : mod.id === "profiling"
              ? !pathname.includes("/modules/") && !builtPaths.some((p) => pathname === p || pathname.startsWith(`${p}/`))
              : pathname.startsWith(`${base}/modules/${mod.id}`);
        const Icon = mod.icon;
        return (
          <Link
            key={mod.id}
            href={href}
            // Keep the viewport where it is: the workspace header above this
            // bar stays mounted, and Next would otherwise scroll the changed
            // page segment into view — i.e. jump past the header on every tab.
            scroll={false}
            role="tab"
            aria-selected={active}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative flex shrink-0 items-center gap-1.5 whitespace-nowrap py-3 text-sm font-medium transition-colors",
              active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-4" />
            {mod.label}
            {active && <span className="absolute inset-x-0 -bottom-px h-[2px] rounded-full bg-primary" />}
          </Link>
        );
      })}
    </div>
  );
}
