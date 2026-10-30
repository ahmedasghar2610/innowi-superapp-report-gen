import { ContactsPanel } from "@/features/merchants/components/contacts/contacts-panel";

/**
 * /merchants/[merchantId]/contacts — contacts management: list, create, edit
 * and delete, live against the contacts API.
 */
export default async function ContactsTabPage({
  params,
}: {
  params: Promise<{ merchantId: string }>;
}) {
  const { merchantId } = await params;
  return <ContactsPanel merchantId={merchantId} />;
}
