import type { Metadata } from "next";
import { RequestsPage } from "@/features/requests/components/requests-page";

export const metadata: Metadata = { title: "Requests — Innowi" };

export default function RequestsRoute() {
  return <RequestsPage />;
}
