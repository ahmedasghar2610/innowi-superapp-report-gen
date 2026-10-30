import type { Metadata } from "next";
import { Suspense } from "react";
import { SiteReportPrintPage } from "@/features/seo/components/site-report-print";

export const metadata: Metadata = {
  title: "SEO site report — Innowi",
};

/**
 * /seo-site/[siteId] — one site's scorecard laid out as a printable report,
 * outside the app shell. Opened in a new tab by the site page's PDF button
 * (`?print=1` opens the print dialog). Still behind login.
 */
export default async function Page({ params }: { params: Promise<{ siteId: string }> }) {
  const { siteId } = await params;
  return (
    <Suspense>
      <SiteReportPrintPage id={siteId} />
    </Suspense>
  );
}
