import { CreateMerchantDrawer } from "@/features/merchants/components/create-merchant-drawer";

/**
 * Intercepted route: /merchants/new opened from within the app. Renders the
 * Create Merchant drawer over the current page (the underlying list/workspace
 * stays mounted). Closing the drawer `router.back()`s to that page.
 */
export default function InterceptedNewMerchantPage() {
  return <CreateMerchantDrawer />;
}
