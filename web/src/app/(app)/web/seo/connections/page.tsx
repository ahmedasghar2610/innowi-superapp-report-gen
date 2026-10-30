import { redirect } from "next/navigation";

/** /web/seo/connections was split: the Google connection is in Settings → Integrations, site settings in SEO → Site settings. Old links (?site=) still land on the right site. */
export default async function Page({ searchParams }: { searchParams: Promise<{ site?: string }> }) {
  const { site } = await searchParams;
  redirect(`/web/seo/site-settings${site ? `?site=${encodeURIComponent(site)}` : ""}`);
}
