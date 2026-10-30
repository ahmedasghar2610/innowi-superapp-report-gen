import type { Metadata } from "next";
import { LinkPage } from "@/features/quotes/components/link-page";

export const metadata: Metadata = { title: "Quote link — Innowi" };

export default async function QuoteLinkRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <LinkPage id={id} />;
}
