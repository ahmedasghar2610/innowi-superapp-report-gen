import { SitePage } from "@/features/seo/components/site-page";

/** /web/seo/sites/[siteId] — one site's scorecard. */
export default async function Page({ params }: { params: Promise<{ siteId: string }> }) {
  const { siteId } = await params;
  return <SitePage id={siteId} />;
}
