import type { Metadata } from "next";
import { DealDetailPage } from "@/features/sales/components/detail-pages";

export const metadata: Metadata = { title: "Salesforce deal — Innowi" };

export default async function DealRoute({ params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await params;
  return <DealDetailPage id={dealId} />;
}
