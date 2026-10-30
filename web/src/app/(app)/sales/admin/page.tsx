import type { Metadata } from "next";
import { SalesAdminPage } from "@/features/sales/components/sales-admin-page";

export const metadata: Metadata = { title: "Salesforce sync — Innowi" };

export default function SalesAdminRoute() {
  return <SalesAdminPage />;
}
