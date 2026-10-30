import type { Metadata } from "next";
import { CasesPage } from "@/features/sales/components/list-pages";

export const metadata: Metadata = { title: "Salesforce cases — Innowi" };

export default function CasesRoute() {
  return <CasesPage />;
}
