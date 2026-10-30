import { DocumentsPanel } from "@/features/merchants/components/documents/documents-panel";

/**
 * /merchants/[merchantId]/documents — documents management (metadata only, no
 * file upload): list, create, edit and delete, live against the documents API.
 */
export default async function DocumentsTabPage({
  params,
}: {
  params: Promise<{ merchantId: string }>;
}) {
  const { merchantId } = await params;
  return <DocumentsPanel merchantId={merchantId} />;
}
