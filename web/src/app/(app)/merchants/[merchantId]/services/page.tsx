import { ServicesPanel } from "@/features/merchants/components/services/services-panel";

/**
 * /merchants/[merchantId]/services — services (entitlements) management: list,
 * add (activate), update and remove, live against the services API. The add
 * picker uses the temporary catalogue until GET /catalog/services ships.
 */
export default async function ServicesTabPage({
  params,
}: {
  params: Promise<{ merchantId: string }>;
}) {
  const { merchantId } = await params;
  return <ServicesPanel merchantId={merchantId} />;
}
