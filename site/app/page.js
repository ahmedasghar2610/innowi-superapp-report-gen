import { notFound } from "next/navigation";
import { getSite, DEFAULT_SLUG } from "@/lib/sites";
import { buildMetadata } from "@/lib/metadata";
import SitePage from "@/components/SitePage";
import EditedPage from "@/components/EditedPage";
import { getEditedContent } from "@/lib/editor";
import ComingSoon, { comingSoonMetadata } from "@/components/ComingSoon";

/*
 * "/" serves nothing unless DEFAULT_SITE names a slug.
 *
 * This template hosts many merchants' sites; picking one to live at the root
 * would hand it a URL the others can't have. Each site is reached at its own
 * `/<slug>`. A single-merchant deployment sets DEFAULT_SITE in .env and gets
 * that site at the root instead.
 */

export async function generateMetadata() {
  if (!DEFAULT_SLUG) return { title: "Not found" };
  const site = await getSite(DEFAULT_SLUG);
  return site?.restricted ? comingSoonMetadata(site) : buildMetadata(site);
}

export default async function Home() {
  if (!DEFAULT_SLUG) notFound();

  const site = await getSite(DEFAULT_SLUG);
  if (!site) notFound();
  if (site.restricted) return <ComingSoon site={site} />;

  // Served at the root, so saved pages' links need no /<slug> prefix.
  const content = await getEditedContent(site.slug);
  if (content) return <EditedPage site={site} content={content} />;
  return <SitePage site={site} />;
}
