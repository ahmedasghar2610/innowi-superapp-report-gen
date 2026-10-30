import { KeywordsPanel } from "@/features/merchants/components/keywords/keywords-panel";

/**
 * /merchants/[merchantId]/keywords — keyword management: list (grouped by
 * type), create, edit and delete, live against the keywords API.
 */
export default async function KeywordsTabPage({
  params,
}: {
  params: Promise<{ merchantId: string }>;
}) {
  const { merchantId } = await params;
  return <KeywordsPanel merchantId={merchantId} />;
}
