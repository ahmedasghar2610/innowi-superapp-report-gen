import type { Metadata } from "next";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui";
import { AccountPage } from "@/features/ads/components/account-page";

// The page swaps in the restaurant's name once it loads (AccountPage).
export const metadata: Metadata = {
  title: "Restaurant — Google Ads — Innowi",
};

/** /ads/[accountId] — one restaurant's Google Ads page. */
export default async function Page({ params }: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await params;
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <AccountPage id={accountId} />
    </Suspense>
  );
}
