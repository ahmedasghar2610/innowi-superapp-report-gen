import { notFound } from "next/navigation";
import { getSite, listSlugs } from "@/lib/sites";
import { buildMetadata } from "@/lib/metadata";
import SitePage from "@/components/SitePage";
import EditedPage from "@/components/EditedPage";
import { getEditedContent } from "@/lib/editor";
import ComingSoon, { PreviewBanner, comingSoonMetadata } from "@/components/ComingSoon";

/** `?preview=` — a signed link from the Super App that shows a site before it's public. */
const accessOf = (searchParams) => (searchParams?.preview ? { preview: String(searchParams.preview) } : undefined);

/*
 * /<slug> renders one website.
 *
 * The slug is the key the Website Intake API stores against each record, so a
 * site filled in through the Super App is live here the moment it is saved —
 * no rebuild, no file to add. A JSON file dropped in data/sites/ still works
 * too; see lib/sites.js.
 */

// Sites are created in the app at runtime, so a slug that wasn't known at
// build time must still render (it 404s only when the API doesn't have it).
export const dynamicParams = true;

export async function generateStaticParams() {
  const slugs = await listSlugs();
  return slugs.map((slug) => ({ slug }));
}

export async function generateMetadata({ params, searchParams }) {
  const access = accessOf(searchParams);
  const site = await getSite(params.slug, access);
  if (site?.restricted) return comingSoonMetadata(site);
  const home = site && (await getEditedContent(site.slug, { access }))?.pages["/"];
  const meta = { ...buildMetadata(site), ...(site && site.published === false ? { robots: { index: false, follow: false } } : {}) };
  // A page edited in /admin carries its own title/description (Page tab).
  return home ? { ...meta, title: home.title || meta.title, description: home.description || meta.description } : meta;
}

export default async function SiteBySlug({ params, searchParams }) {
  const access = accessOf(searchParams);
  const site = await getSite(params.slug, access);
  if (!site) notFound();
  if (site.restricted) return <ComingSoon site={site} />;
  const banner = site.published === false ? <PreviewBanner status={site.status} /> : null;
  // Edited in /admin → serve the saved page; otherwise build it from the form.
  const content = await getEditedContent(site.slug, { access });
  if (content) return <>{banner}<EditedPage site={site} content={content} base={`/${site.slug}`} /></>;
  return <>{banner}<SitePage site={site} /></>;
}
