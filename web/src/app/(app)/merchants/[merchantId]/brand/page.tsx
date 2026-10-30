import { BrandProfilePanel } from "@/features/merchants/components/brand/brand-profile-panel";

/**
 * /merchants/[merchantId]/brand — the merchant's 1:1 brand profile as a single
 * inline form, live against the brand-profile API.
 */
export default async function BrandTabPage({
  params,
}: {
  params: Promise<{ merchantId: string }>;
}) {
  const { merchantId } = await params;
  return <BrandProfilePanel merchantId={merchantId} />;
}
