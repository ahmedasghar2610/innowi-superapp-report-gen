import { LocationsPanel } from "@/features/merchants/components/locations/locations-panel";

/**
 * /merchants/[merchantId]/locations — locations management: list, create, edit
 * and delete, live against the locations API.
 */
export default async function LocationsTabPage({
  params,
}: {
  params: Promise<{ merchantId: string }>;
}) {
  const { merchantId } = await params;
  return <LocationsPanel merchantId={merchantId} />;
}
