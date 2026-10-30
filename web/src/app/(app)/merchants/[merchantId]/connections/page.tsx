import { ConnectionsPanel } from "@/features/merchants/components/connections/connections-panel";

/**
 * /merchants/[merchantId]/connections — access items (connections) management:
 * list, create, edit and delete, live against the connections API.
 */
export default async function ConnectionsTabPage({
  params,
}: {
  params: Promise<{ merchantId: string }>;
}) {
  const { merchantId } = await params;
  return <ConnectionsPanel merchantId={merchantId} />;
}
