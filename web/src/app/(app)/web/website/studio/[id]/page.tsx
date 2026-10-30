import type { Metadata } from "next";
import { notFound } from "next/navigation";
import VisualEditor from "@/features/site-builder/components/editor/VisualEditor";
import { studioAssetPrefix, studioPreviewBase } from "@/features/site-builder/server/studio-preview";
import { getWorkspaceMeta } from "@/features/site-builder/server/workspaces";

// Ported from site-builder-source-for-developer/app/studio/[id]/page.tsx.
//
// Nested under the Website module (rather than a bare top-level /studio/[id],
// as in the standalone source tool) so it reads as part of the same Clone a
// Website flow it's launched from. Reachable only via the "Edit" button on a
// saved "My Clones" card (clone-website-panel.tsx) — see that file for how it
// links here. This route lives outside /api/ and isn't in middleware's public
// path allowlist, so the existing session-cookie check (src/middleware.ts)
// already protects it like every other app page; opening it in a new tab
// works because the auth cookie is per-browser-origin, not per-tab. No
// additional auth mechanism was added and none is needed.
//
// The editor's preview iframe (previewBase/assetPrefix below) reuses the
// already-ported read-only "Visit" preview route at /api/clone/preview/[id]
// rather than a duplicate studio-scoped route — that route re-reads the
// workspace store on every request, so edits saved through apiBase
// (/api/studio/[id]/pages) show up immediately on the next preview fetch.
export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{ path?: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  const meta = await getWorkspaceMeta(id).catch(() => null);
  return { title: meta ? `Edit ${meta.siteName} — Innowi` : "Studio — Innowi" };
}

export default async function StudioPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  const { path } = await searchParams;
  const meta = await getWorkspaceMeta(id).catch(() => null);
  if (!meta) notFound();

  return (
    <VisualEditor
      apiBase={`/api/studio/${id}`}
      previewBase={studioPreviewBase(id)}
      assetPrefix={studioAssetPrefix(id)}
      initialPath={path || "/"}
      siteName={meta.siteName}
      downloadHref={`/api/clone/download?id=${encodeURIComponent(id)}`}
      exitHref="/web/website"
      exitLabel="Back to Website"
    />
  );
}
