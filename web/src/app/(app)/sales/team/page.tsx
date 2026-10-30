import type { Metadata } from "next";
import { TeamPage } from "@/features/sales/components/team-page";

export const metadata: Metadata = { title: "Sales team — Salesforce — Innowi" };

export default function TeamRoute() {
  return <TeamPage />;
}
