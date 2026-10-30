import type { Metadata } from "next";
import { DealsPage } from "@/features/deals/components/deals-page";

export const metadata: Metadata = { title: "Deals — Innowi" };

export default function DealsRoute() {
  return <DealsPage />;
}
