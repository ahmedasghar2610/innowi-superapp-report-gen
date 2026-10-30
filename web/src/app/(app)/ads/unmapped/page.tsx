import type { Metadata } from "next";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui";
import { UnmappedPage } from "@/features/ads/components/unmapped-page";

export const metadata: Metadata = {
  title: "Unmapped Accounts — Google Ads — Innowi",
};

/** /ads/unmapped — Google Ads accounts not linked to a merchant yet. */
export default function Page() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <UnmappedPage />
    </Suspense>
  );
}
