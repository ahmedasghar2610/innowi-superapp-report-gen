// The editor's /site endpoint (site name, language, Theme panel). "Detect
// from site" reads a cloned site's stylesheet in the Super App; here the
// theme comes from the brand colours and fonts in the website's form answers.
import { revalidatePath } from "next/cache";
import { handleSiteRequest } from "@/lib/site-builder/content-api";
import { withAdmin, json } from "@/lib/admin-route";

export const dynamic = "force-dynamic";

const family = (stack: string | undefined) => (stack || "").split(",")[0].replace(/["']/g, "").trim() || undefined;

async function handle(request: Request, ctx: { params: { slug: string } }) {
  const admin = await withAdmin(request, ctx);
  if (admin instanceof Response) return admin;

  if (request.method === "POST") {
    const body = (await request.clone().json().catch(() => ({}))) as { action?: string };
    if (body.action === "detect") {
      const b = admin.site.brand || {};
      const theme = {
        colors: { accent: b.secondary, foreground: b.textColor, linkColor: b.accent },
        typography: { headingFont: family(b.headingFont), bodyFont: family(b.bodyFont) },
      };
      const foundCount = [theme.colors.accent, theme.colors.foreground, theme.colors.linkColor, theme.typography.headingFont, theme.typography.bodyFont].filter(Boolean).length;
      return json({ ok: true, theme, foundCount });
    }
  }

  const res = await handleSiteRequest(admin.store, request);
  if (request.method === "PUT" && res.ok) revalidatePath(`/${admin.slug}`, "layout");
  return res;
}

export { handle as GET, handle as PUT, handle as POST };
