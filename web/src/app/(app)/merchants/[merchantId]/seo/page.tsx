import { MerchantSeoTab } from "@/features/seo/components/merchant-seo-tab";

/** /merchants/[merchantId]/seo — search performance of the SEO sites linked to this merchant. */
export default async function MerchantSeoPage({ params }: { params: Promise<{ merchantId: string }> }) {
  const { merchantId } = await params;
  return <MerchantSeoTab merchantId={merchantId} />;
}
