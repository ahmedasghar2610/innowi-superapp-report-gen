"use client";

import { useRefetchOnFocus } from "@/hooks/use-refetch-on-focus";
import { queryKeys } from "@/lib/query/query-keys";
import { websiteKeys } from "@/features/websites/api/websites.queries";
import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SearchX } from "lucide-react";
import { Button, Card, ErrorState, Skeleton } from "@/components/ui";
import { useMerchant } from "@/features/merchants/api";
import { MerchantHeader } from "./merchant-header";
import { MerchantSummary } from "./merchant-summary";
import { ProfileCompletenessCard } from "./profile-completeness-card";
import { MerchantModuleTabs } from "./merchant-module-tabs";
import { MERCHANT_TABS, MerchantTabs } from "./merchant-tabs";

/**
 * Merchant Workspace shell (route: /merchants/[merchantId]). Fetches the
 * merchant once for the header + summary; the active tab renders as `children`.
 * Handles loading, not-found (404) and error states before showing content.
 *
 * Below the header sits the module row (Overview · Profiling · Customers ·
 * Marketing · Rewards · Website & SEO · Payments · Performance) mirroring the
 * prototype's per-merchant workspace. Overview is the landing tab. Profiling
 * has twelve sub-tabs (Profile · Brand · Keywords · Competitors · Catering ·
 * Contacts · Locations · Services · Documents · Promotions · Connections ·
 * History) rendered as a compact segmented control next to a "Profiling"
 * heading — a different visual language from the tabs above, so the two
 * levels read as a hierarchy. Every other module tab routes to a "coming
 * soon" page scoped to this merchant.
 */
export function MerchantWorkspaceShell({
  merchantId,
  children,
}: {
  merchantId: string;
  children: React.ReactNode;
}) {
  // Hours / phone edited in the site's visual editor (another tab) land on
  // this merchant's Profile — show them when the user comes back.
  useRefetchOnFocus([queryKeys.merchants.detail(merchantId), websiteKeys.forMerchant(merchantId)]);
  const { data: merchant, isPending, isError, error, refetch } = useMerchant(merchantId);
  const pathname = usePathname();
  // The Profiling sub-tabs belong to Profiling's own screens only — not to Website & SEO, GBP, Ads, Tickets…
  const base = `/merchants/${merchantId}`;
  const inProfilingModule = pathname === base || pathname === `${base}/edit` ||
    MERCHANT_TABS.some((t) => pathname === `${base}/${t.id}` || pathname.startsWith(`${base}/${t.id}/`));

  // Entering a merchant (from the directory, Data Quality, Home, search…)
  // should start at the top of the workspace. Tab links inside it use
  // `scroll={false}`, so this is the only scroll the workspace ever does —
  // once per merchant, never per tab.
  // It runs on mount and again when the merchant has loaded, because the
  // skeleton → content swap is when the layout takes its real height. Every
  // navigation INTO the workspace passes `scroll: false` and every tab link
  // inside it uses `scroll={false}`, so Next never scrolls the page segment.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [merchantId, isPending]);

  if (isPending) return <ShellSkeleton />;

  if (isError) {
    if (error.status === 404) {
      return (
        <Card>
          <div className="flex flex-col items-center px-5 py-14 text-center">
            <div className="mb-3.5 grid size-12 place-items-center rounded-[13px] bg-muted text-muted-foreground">
              <SearchX className="size-6" />
            </div>
            <p className="text-base font-semibold text-foreground">Merchant not found</p>
            <p className="mt-1 max-w-sm text-xs leading-4 text-muted-foreground">
              This merchant may have been deleted, or the link is out of date.
            </p>
            <Link href="/merchants" className="mt-4">
              <Button variant="default" size="sm">Back to merchants</Button>
            </Link>
          </div>
        </Card>
      );
    }
    return (
      <Card>
        <ErrorState title="Couldn't load this merchant" error={error} onRetry={() => refetch()} />
      </Card>
    );
  }

  return (
    <div>
      <MerchantHeader merchant={merchant} />
      <ProfileCompletenessCard merchantId={merchantId} />
      <MerchantSummary merchant={merchant} />
      <div className="mt-6">
        <MerchantModuleTabs merchantId={merchantId} />
      </div>
      {inProfilingModule && <MerchantTabs merchantId={merchantId} />}
      <div className={inProfilingModule ? "mt-4" : "mt-6"}>{children}</div>
    </div>
  );
}

function ShellSkeleton() {
  return (
    <div>
      <Skeleton className="mb-3 h-4 w-32" />
      <div className="flex items-start gap-4">
        <Skeleton className="size-14 rounded-xl" />
        <div className="flex-1">
          <Skeleton className="h-7 w-64" />
          <Skeleton className="mt-2 h-3.5 w-80" />
        </div>
        <Skeleton className="h-8 w-28 rounded-md" />
      </div>
      <Skeleton className="mt-4 h-16 w-full rounded-lg" />
      <Skeleton className="mt-4 h-28 w-full rounded-lg" />
      <Skeleton className="mt-6 h-9 w-full" />
      <div className="mt-5 flex items-center justify-between">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-9 w-72 rounded-lg" />
      </div>
      <Skeleton className="mt-4 h-48 w-full rounded-lg" />
    </div>
  );
}
