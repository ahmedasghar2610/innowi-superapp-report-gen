import { CrawlPage } from "@/features/seo/components/crawl-page";

/** /web/seo/sites/[siteId]/crawl — the newest imported Screaming Frog crawl: issues and every crawled URL. */
export default async function Page({ params, searchParams }: { params: Promise<{ siteId: string }>; searchParams: Promise<{ issue?: string }> }) {
  const { siteId } = await params;
  const { issue } = await searchParams;
  return <CrawlPage siteId={siteId} initialIssue={issue} />;
}
