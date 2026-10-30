import { ProfilePanel } from "@/features/merchants/components/profile/profile-panel";

/**
 * /merchants/[merchantId]/profile — the server-driven profile fields.
 * Resolves the route param and hands it to the client panel, which fetches the
 * field registry and renders each field with inline edit + confidence chips.
 */
export default async function ProfileTabPage({
  params,
}: {
  params: Promise<{ merchantId: string }>;
}) {
  const { merchantId } = await params;
  return <ProfilePanel merchantId={merchantId} />;
}
