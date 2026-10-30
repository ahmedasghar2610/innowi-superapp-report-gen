import type { Metadata } from "next";
import { OrganizationPage } from "@/features/deals/components/organization-page";

export const metadata: Metadata = { title: "Organization — Innowi" };

export default async function OrganizationRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OrganizationPage id={id} />;
}
