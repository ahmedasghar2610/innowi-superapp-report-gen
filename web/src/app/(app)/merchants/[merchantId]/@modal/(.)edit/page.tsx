import { EditMerchantDrawer } from "@/features/merchants/components/edit-merchant-drawer";

/**
 * Intercepted route: /merchants/[merchantId]/edit opened from within the
 * workspace. Renders the Edit drawer over the current page (the workspace stays
 * mounted, and the merchant is already in the query cache). Closing the drawer
 * `router.back()`s to the workspace.
 */
export default async function InterceptedEditMerchantPage({
  params,
}: {
  params: Promise<{ merchantId: string }>;
}) {
  const { merchantId } = await params;
  return <EditMerchantDrawer merchantId={merchantId} />;
}
