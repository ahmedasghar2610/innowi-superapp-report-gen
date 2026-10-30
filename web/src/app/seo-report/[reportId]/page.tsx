import type { Metadata } from "next";
import { Suspense } from "react";
import { ReportPreviewPage } from "@/features/seo/components/report-preview-page";

export const metadata: Metadata = {
  title: "SEO report — Innowi",
};

/**
 * /seo-report/[reportId] — full-page client preview of one SEO report, outside
 * the app shell (no sidebar), opened in a new tab from the report review page.
 * Still behind login (middleware guards every non-public path).
 */
export default async function Page({ params }: { params: Promise<{ reportId: string }> }) {
  const { reportId } = await params;
  return (
    <Suspense>
      <ReportPreviewPage id={reportId} />
    </Suspense>
  );
}
