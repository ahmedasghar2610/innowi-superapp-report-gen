import { ReviewPage } from "@/features/report-gen/components/review-page";

/** /report-gen/[reportId] — review one merchant report: the draft on the left, approve / edit / delete / send on the right. */
export default async function Page({ params }: { params: Promise<{ reportId: string }> }) {
  const { reportId } = await params;
  return <ReviewPage id={reportId} />;
}
