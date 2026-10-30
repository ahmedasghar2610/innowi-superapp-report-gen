import type { Metadata } from "next";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui";
import { AdsPage } from "@/features/ads/components/ads-page";

export const metadata: Metadata = {
  title: "Google Ads — Innowi",
};

/** /ads — Google Ads portfolio (replaces the n8n workflow + Google Sheet).
 *  Suspense: the page reads the period from the URL (useSearchParams). */
export default function Page() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <AdsPage />
    </Suspense>
  );
}
