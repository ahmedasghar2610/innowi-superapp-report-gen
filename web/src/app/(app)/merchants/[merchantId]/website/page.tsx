import { MerchantWebsiteTab } from "@/features/websites/components/merchant-website-tab";

/** /merchants/[merchantId]/website — this merchant's website: none / external / managed. */
export default async function MerchantWebsitePage({ params }: { params: Promise<{ merchantId: string }> }) {
  const { merchantId } = await params;
  return <MerchantWebsiteTab merchantId={merchantId} />;
}
