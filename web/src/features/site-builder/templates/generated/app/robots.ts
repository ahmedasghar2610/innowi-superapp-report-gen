import type { MetadataRoute } from "next";
import { store } from "@/lib/site-store";

export const dynamic = "force-dynamic";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const site = await store.site();
  const base = (site.canonicalOrigin || site.origin).replace(/\/+$/, "");
  const disallow = ["/admin", "/api/"];
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow },
      // AI answer engines are welcome (pSEO playbook). Crawlers not named here
      // already follow the "*" rule above, which allows the same pages.
      { userAgent: ["GPTBot", "PerplexityBot", "Google-Extended"], allow: "/", disallow },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
