import type { Metadata } from "next";
import { CreateMerchantDrawer } from "@/features/merchants/components/create-merchant-drawer";

export const metadata: Metadata = {
  title: "New merchant — Innowi",
};

/**
 * Standalone /merchants/new — served on a hard load or refresh (when the
 * intercepting `@modal/(.)new` route is bypassed). Renders the same drawer;
 * closing it falls back to /merchants since there's no in-app history to pop.
 */
export default function NewMerchantPage() {
  return <CreateMerchantDrawer />;
}
