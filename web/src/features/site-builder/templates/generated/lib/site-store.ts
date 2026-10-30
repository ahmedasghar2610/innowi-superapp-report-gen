// Single content store for the generated site.
//
// content/pages.json and content/site.json are also imported here so webpack
// inlines a snapshot into the server build. Managed hosts (Hostinger "Deploy
// Web App") run the site from a folder that contains only the build output, so
// without this every page would 404. On disk the JSON files always win; the
// first save from /admin writes the full content back to content/.
import { createContentStore, type PagesFile, type SiteFile } from "@/lib/content-store";
import pagesSnapshot from "@/content/pages.json";
import siteSnapshot from "@/content/site.json";

export const store = createContentStore(process.cwd(), {
  pages: pagesSnapshot as unknown as PagesFile,
  site: siteSnapshot as unknown as SiteFile,
});
