import type { Metadata } from "next";
import { CustomerDetailPage } from "@/features/sales/components/detail-pages";

export const metadata: Metadata = { title: "Salesforce account — Innowi" };

export default async function CustomerRoute({ params }: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await params;
  return <CustomerDetailPage id={accountId} />;
}
