import { HistoryPanel } from "@/features/audit/components/history-panel";

/**
 * /merchants/[merchantId]/history — this restaurant's change history
 * (PRD §22, "Profile tab › History"), backed by GET /merchants/:id/history.
 */
export default async function HistoryTabPage({
  params,
}: {
  params: Promise<{ merchantId: string }>;
}) {
  const { merchantId } = await params;
  return <HistoryPanel merchantId={merchantId} />;
}
