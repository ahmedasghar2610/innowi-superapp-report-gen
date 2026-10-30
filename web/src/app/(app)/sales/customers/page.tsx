import type { Metadata } from "next";
import { CustomersPage } from "@/features/sales/components/list-pages";

export const metadata: Metadata = { title: "Salesforce accounts — Innowi" };

export default function CustomersRoute() {
  return <CustomersPage />;
}
