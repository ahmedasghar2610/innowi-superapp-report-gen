import { notFound } from "next/navigation";
import { normalizePath } from "@/lib/site-builder/content-store";
import { getEditedContent } from "@/lib/editor";
import { getSite } from "@/lib/sites";
import { buildMetadata } from "@/lib/metadata";
import EditedPage from "@/components/EditedPage";
import { PreviewBanner, comingSoonMetadata } from "@/components/ComingSoon";

const accessOf = (searchParams) => (searchParams?.preview ? { preview: String(searchParams.preview) } : undefined);

/*
 * /<slug>/<page> — extra pages added in the /admin editor. A template-mode
 * site has only its home page, so anything here 404s until pages are added.
 */
export const dynamicParams = true;

function pagePath(parts) {
  return normalizePath(`/${(parts || []).map(decodeURIComponent).join("/")}`);
}

export async function generateMetadata({ params, searchParams }) {
  const access = accessOf(searchParams);
  const site = await getSite(params.slug, access);
  if (site?.restricted) return comingSoonMetadata(site);
  const content = site && (await getEditedContent(site.slug, { access }));
  const page = content?.pages[pagePath(params.path)];
  if (!page) return {};
  return { ...buildMetadata(site), title: page.title, description: page.description || undefined };
}

export default async function EditedSubPage({ params, searchParams }) {
  const access = accessOf(searchParams);
  const site = await getSite(params.slug, access);
  if (!site || site.restricted) notFound();
  const content = await getEditedContent(site.slug, { access });
  const path = pagePath(params.path);
  if (!content?.pages[path] || path === "/") notFound();
  return (
    <>
      {site.published === false && <PreviewBanner status={site.status} />}
      <EditedPage site={site} content={content} path={path} base={`/${site.slug}`} />
    </>
  );
}
