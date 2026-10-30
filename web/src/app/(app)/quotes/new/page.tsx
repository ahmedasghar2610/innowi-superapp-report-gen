import type { Metadata } from "next";
import { NewLinkPage } from "@/features/quotes/components/new-link-page";

export const metadata: Metadata = { title: "New quote link — Innowi" };

export default function NewQuoteLinkRoute() {
  return <NewLinkPage />;
}
