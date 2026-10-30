import { MerchantPaymentsTab } from "@/features/payments/components/merchant-payments-tab";

/** /merchants/[merchantId]/payments — monthly billing from the revenue report, checked against the Profile. */
export default async function MerchantPaymentsPage({ params }: { params: Promise<{ merchantId: string }> }) {
  const { merchantId } = await params;
  return <MerchantPaymentsTab merchantId={merchantId} />;
}
