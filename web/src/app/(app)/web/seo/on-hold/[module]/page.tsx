import { OnHoldModulePage } from "@/features/seo/components/on-hold-page";

/** /web/seo/on-hold/[module] — under-construction page for one on-hold module. */
export default async function Page({ params }: { params: Promise<{ module: string }> }) {
  const { module: slug } = await params;
  return <OnHoldModulePage slug={slug} />;
}
