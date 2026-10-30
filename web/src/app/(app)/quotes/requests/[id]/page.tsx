import type { Metadata } from "next";
import { RequestPage } from "@/features/quotes/components/request-page";

export const metadata: Metadata = { title: "Quote request — Innowi" };

export default async function QuoteRequestRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RequestPage id={id} />;
}
