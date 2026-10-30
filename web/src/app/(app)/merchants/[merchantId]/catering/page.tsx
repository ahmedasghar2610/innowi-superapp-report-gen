import { CateringProfilePanel } from "@/features/merchants/components/catering/catering-profile-panel";

/**
 * /merchants/[merchantId]/catering — the merchant's 1:1 catering profile as a
 * single inline form, live against the catering-profile API.
 */
export default async function CateringTabPage({
  params,
}: {
  params: Promise<{ merchantId: string }>;
}) {
  const { merchantId } = await params;
  return <CateringProfilePanel merchantId={merchantId} />;
}
