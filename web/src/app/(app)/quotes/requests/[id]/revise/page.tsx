import type { Metadata } from "next";
import { RevisePage } from "@/features/quotes/components/revise-page";

export const metadata: Metadata = { title: "Counter-offer — Innowi" };

export default async function QuoteReviseRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RevisePage id={id} />;
}
