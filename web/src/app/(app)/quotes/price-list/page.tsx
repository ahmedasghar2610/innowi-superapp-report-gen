import type { Metadata } from "next";
import { PriceListPage } from "@/features/quotes/components/price-list-page";

export const metadata: Metadata = { title: "Price list — Innowi" };

export default function PriceListRoute() {
  return <PriceListPage />;
}
