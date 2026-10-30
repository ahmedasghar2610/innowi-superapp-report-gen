import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getSite } from "@/lib/sites";
import { SNAPSHOT_TOKEN_HEADER } from "@/lib/editor";
import SitePage from "@/components/SitePage";

/*
 * The template page in "snapshot mode" — animations as data-sb-* attributes,
 * the mobile menu and forms wired for plain HTML — between two markers.
 * lib/editor.js buildSnapshot() cuts it out to seed the /admin editor.
 * Nothing links here and it isn't indexed.
 */
export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

export default async function SnapshotSource({ params }) {
  const token = headers().get(SNAPSHOT_TOKEN_HEADER) || undefined;
  const site = await getSite(params.slug, { token });
  if (!site || site.restricted) notFound();
  return (
    <>
      <div id="sb-snapshot">
        <SitePage site={{ ...site, snapshot: true }} />
      </div>
      <span id="sb-snapshot-end" />
    </>
  );
}
