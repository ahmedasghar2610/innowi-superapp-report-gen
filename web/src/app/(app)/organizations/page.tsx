import type { Metadata } from "next";
import { OrganizationsPage } from "@/features/deals/components/organizations-page";

export const metadata: Metadata = { title: "Organizations — Innowi" };

export default function OrganizationsRoute() {
  return <OrganizationsPage />;
}
