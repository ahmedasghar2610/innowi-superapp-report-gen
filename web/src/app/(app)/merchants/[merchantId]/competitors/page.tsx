import { CompetitorsPanel } from "@/features/merchants/components/competitors/competitors-panel";

/**
 * /merchants/[merchantId]/competitors — competitor management: list, create,
 * edit and delete, live against the competitors API.
 */
export default async function CompetitorsTabPage({
  params,
}: {
  params: Promise<{ merchantId: string }>;
}) {
  const { merchantId } = await params;
  return <CompetitorsPanel merchantId={merchantId} />;
}
