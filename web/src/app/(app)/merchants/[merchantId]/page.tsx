import { redirect } from "next/navigation";

/** /merchants/[merchantId] → land on the Overview tab (Super App PRD §14.3: "Overview" is the workspace's first tab). */
export default async function MerchantIndexPage({
  params,
}: {
  params: Promise<{ merchantId: string }>;
}) {
  const { merchantId } = await params;
  redirect(`/merchants/${merchantId}/overview`);
}
