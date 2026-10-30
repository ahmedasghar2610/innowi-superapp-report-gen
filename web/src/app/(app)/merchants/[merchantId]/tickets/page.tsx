import { MerchantTicketsPanel } from "@/features/tickets/components/merchant-tickets-panel";

/** /merchants/[merchantId]/tickets — this merchant's Ops CRM tickets. */
export default async function MerchantTicketsPage({ params }: { params: Promise<{ merchantId: string }> }) {
  const { merchantId } = await params;
  return <MerchantTicketsPanel merchantId={merchantId} />;
}
