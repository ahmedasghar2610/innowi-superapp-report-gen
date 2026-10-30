import type { Metadata } from "next";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui";
import { LocationReportPage } from "@/features/gbp/components/location-report";

// The page swaps in the listing's name once it loads (LocationReportPage).
export const metadata: Metadata = {
  title: "Listing report — Google Business Profile — Innowi",
};

/** /web/gbp/[locationId] — one listing's report. */
export default async function Page({ params }: { params: Promise<{ locationId: string }> }) {
  const { locationId } = await params;
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <LocationReportPage id={locationId} />
    </Suspense>
  );
}
