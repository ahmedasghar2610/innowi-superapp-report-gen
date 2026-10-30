import type { Metadata } from "next";
import { EditMerchantDrawer } from "@/features/merchants/components/edit-merchant-drawer";

export const metadata: Metadata = {
  title: "Edit merchant — Innowi",
};

/**
 * Standalone /merchants/[merchantId]/edit — served on a hard load or refresh
 * (when the intercepting `@modal/(.)edit` route is bypassed). Renders the same
 * drawer, which loads the merchant itself; closing it falls back to the
 * workspace since there's no in-app history to pop.
 */
export default async function EditMerchantPage({
  params,
}: {
  params: Promise<{ merchantId: string }>;
}) {
  const { merchantId } = await params;
  return <EditMerchantDrawer merchantId={merchantId} />;
}
