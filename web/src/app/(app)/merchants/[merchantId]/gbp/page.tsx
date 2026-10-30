import { MerchantGbpTab } from "@/features/gbp/components/merchant-gbp-tab";

/** /merchants/[merchantId]/gbp — this merchant's Google Business Profile listings. */
export default async function MerchantGbpPage({ params }: { params: Promise<{ merchantId: string }> }) {
  const { merchantId } = await params;
  return <MerchantGbpTab merchantId={merchantId} />;
}
