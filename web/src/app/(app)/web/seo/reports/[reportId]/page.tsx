import { ReportPage } from "@/features/seo/components/report-page";

/** /web/seo/reports/[reportId] — one client report: preview, sign-off, send. */
export default async function Page({ params }: { params: Promise<{ reportId: string }> }) {
  const { reportId } = await params;
  return <ReportPage id={reportId} />;
}
