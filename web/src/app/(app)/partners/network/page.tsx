import type { Metadata } from "next";
import { PartnerContactsPage } from "@/features/partners/contacts/components/partner-contacts-page";

export const metadata: Metadata = {
  title: "Partner network — Innowi",
};

export default function PartnerNetworkRoute() {
  return <PartnerContactsPage />;
}
