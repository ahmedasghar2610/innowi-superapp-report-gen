import { MenuPanel } from "@/features/merchants/components/menu/menu-panel";

/**
 * /merchants/[merchantId]/menu — the merchant's menu (items, prices, photos)
 * extracted from their Innowi Online Ordering page.
 */
export default async function MenuTabPage({ params }: { params: Promise<{ merchantId: string }> }) {
  const { merchantId } = await params;
  return <MenuPanel merchantId={merchantId} />;
}
