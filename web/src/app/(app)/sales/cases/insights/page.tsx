import { Suspense } from "react";
import type { Metadata } from "next";
import { CaseInsightsPage } from "@/features/sales/components/case-insights-page";

export const metadata: Metadata = { title: "Case analysis — Salesforce — Innowi" };

export default function CaseInsightsRoute() {
  return (
    <Suspense fallback={null}>
      <CaseInsightsPage />
    </Suspense>
  );
}
