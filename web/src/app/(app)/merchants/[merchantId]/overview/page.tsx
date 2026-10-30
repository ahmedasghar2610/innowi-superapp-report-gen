import { MerchantOverviewPanel } from "@/features/merchants/components/overview/merchant-overview-panel";

/** /merchants/[merchantId]/overview — the workspace landing tab. */
export default async function OverviewTabPage({ params }: { params: Promise<{ merchantId: string }> }) {
  const { merchantId } = await params;
  return <MerchantOverviewPanel merchantId={merchantId} />;
}
