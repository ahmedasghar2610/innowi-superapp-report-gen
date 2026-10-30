import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import { normalizePath } from "@/lib/site-builder/content-store";
import { adminCookie, buildSnapshot, EDITOR_ENABLED, getEditedContent, selfOrigin } from "@/lib/editor";
import { getSite } from "@/lib/sites";
import EditedPage from "@/components/EditedPage";

/*
 * What the editor's iframe shows: the stored page, or — before the first save
 * — the template page as editable HTML. `?path=` picks the page.
 */
export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

export default async function EditorPreview({ params, searchParams }) {
  if (!EDITOR_ENABLED) notFound();
  const token = cookies().get(adminCookie(params.slug))?.value;
  const site = await getSite(params.slug, { token });
  if (!site || site.restricted) notFound();

  const path = normalizePath(String(searchParams?.path || "/"));
  let content = await getEditedContent(site.slug, { fresh: true, access: { token } });
  if (!content) {
    const h = headers();
    const origin = selfOrigin(`${h.get("x-forwarded-proto") || "http"}://${h.get("host")}`);
    content = await buildSnapshot(site, origin, token);
  }
  if (!content.pages[path]) notFound();
  return <EditedPage site={site} content={content} path={path} preview />;
}
