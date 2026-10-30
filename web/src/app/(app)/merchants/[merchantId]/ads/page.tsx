import { MerchantAdsTab } from "@/features/ads/components/merchant-ads-tab";

/** /merchants/[merchantId]/ads — this merchant's Google Ads accounts. */
export default async function MerchantAdsPage({ params }: { params: Promise<{ merchantId: string }> }) {
  const { merchantId } = await params;
  return <MerchantAdsTab merchantId={merchantId} />;
}
