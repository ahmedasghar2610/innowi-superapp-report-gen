import type { Metadata } from "next";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui";
import { MonthlyReportPage } from "@/features/ads/components/monthly-report-page";

export const metadata: Metadata = {
  title: "Monthly report — Google Ads — Innowi",
};

/** /ads/monthly-report?month=YYYY-MM — the old sheet's MonthlyReport tab. */
export default function Page() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <MonthlyReportPage />
    </Suspense>
  );
}
