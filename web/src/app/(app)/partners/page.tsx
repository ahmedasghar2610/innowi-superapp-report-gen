import type { Metadata } from "next";
import { PartnerLeadsPage } from "@/features/partners/components/partner-leads-page";

export const metadata: Metadata = {
  title: "Partner leads — Innowi",
};

export default function PartnersRoute() {
  return <PartnerLeadsPage />;
}
