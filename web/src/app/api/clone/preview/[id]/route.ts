// Live "Visit" preview for a saved clone — renders one page of the workspace
// as a complete HTML document, without starting a separate Next.js process.
// Ported from site-builder-source-for-developer/app/api/studio/[id]/preview/route.ts.
import { notFoundDocument, previewDocument, studioAssetPrefix, studioPreviewBase } from "@/features/site-builder/server/studio-preview";
import { workspaceExists, workspaceStore } from "@/features/site-builder/server/workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

export async function GET(request: Request, { params }: { params: Params }) {
  const { id } = await params;
  if (!(await workspaceExists(id))) {
    return new Response("This clone was not found, or has expired.", { status: 404 });
  }
  const path = new URL(request.url).searchParams.get("path") || "/";
  const store = workspaceStore(id);
  const [site, page] = await Promise.all([store.site(), store.get(path)]);
  if (!page) {
    return new Response(notFoundDocument(path, studioPreviewBase(id) + encodeURIComponent("/"), site.name), {
      status: 404,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
  return new Response(previewDocument(site, page, studioAssetPrefix(id), studioPreviewBase(id)), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
