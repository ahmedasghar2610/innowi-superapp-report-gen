import type { MetadataRoute } from "next";
import { isPublished } from "@/lib/content-store";
import { store } from "@/lib/site-store";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [site, pages] = await Promise.all([store.site(), store.list()]);
  const base = (site.canonicalOrigin || site.origin).replace(/\/+$/, "");
  const redirected = new Set((site.redirects || []).map((r) => r.from));
  const full = await Promise.all(pages.map((p) => store.get(p.path)));
  return pages
    .filter((page, i) => isPublished(page) && !redirected.has(page.path) && !/noindex/i.test(full[i]?.seo?.robots || ""))
    .map((page) => ({
      url: page.path === "/" ? `${base}/` : `${base}${page.path}`,
      lastModified: page.updatedAt ? new Date(page.updatedAt) : new Date(),
    }));
}
