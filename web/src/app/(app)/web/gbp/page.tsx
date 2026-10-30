import type { Metadata } from "next";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui";
import { GbpPage } from "@/features/gbp/components/gbp-page";

export const metadata: Metadata = {
  title: "Google Business Profile — Innowi",
};

/** /web/gbp — Google Business Profile reporting across every listing.
 *  Suspense: the page reads the date range from the URL (useSearchParams). */
export default function Page() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <GbpPage />
    </Suspense>
  );
}
