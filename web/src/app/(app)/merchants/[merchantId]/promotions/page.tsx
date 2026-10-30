import { PromotionsPanel } from "@/features/merchants/components/promotions/promotions-panel";

/**
 * /merchants/[merchantId]/promotions — the master list of a merchant's
 * promotions/offers (PRD Appendix C-7 / PROF-01 §6.2.4): list, create, edit
 * and delete, live against the promotions API.
 */
export default async function PromotionsTabPage({
  params,
}: {
  params: Promise<{ merchantId: string }>;
}) {
  const { merchantId } = await params;
  return <PromotionsPanel merchantId={merchantId} />;
}
