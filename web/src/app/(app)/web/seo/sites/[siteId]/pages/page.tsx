import { PagesPage } from "@/features/seo/components/pages-page";

/** /web/seo/sites/[siteId]/pages — every page of the site (read-only). */
export default async function Page({ params }: { params: Promise<{ siteId: string }> }) {
  const { siteId } = await params;
  return <PagesPage id={siteId} />;
}
