import type { Metadata } from "next";
import { QuotesPage } from "@/features/quotes/components/quotes-page";

export const metadata: Metadata = { title: "Quotes — Innowi" };

export default function QuotesRoute() {
  return <QuotesPage />;
}
