// Ported from site-builder-source-for-developer/app/api/studio/[id]/pages/route.ts.
//
// Note: the read-only "Visit" preview/asset routes were already ported at
// /api/clone/preview/[id]/** in an earlier pass, and the editor's preview
// iframe (VisualEditor's previewBase/assetPrefix props, wired up in the
// studio page) reuses those directly rather than duplicating them here —
// they already re-read the workspace store on every request (no caching),
// so saves made through this route are reflected immediately. This route is
// the only new capability the editor needs beyond what's already ported:
// reading/writing page content.
import { handlePagesRequest } from "@/features/site-builder/server/content-api";
import { studioAssetPrefix } from "@/features/site-builder/server/studio-preview";
import { workspaceExists, workspaceStore } from "@/features/site-builder/server/workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

async function handle(request: Request, { params }: { params: Params }) {
  const { id } = await params;
  if (!(await workspaceExists(id))) {
    return Response.json({ error: "Workspace not found or expired." }, { status: 404 });
  }
  return handlePagesRequest(workspaceStore(id), request, {
    assetPrefix: studioAssetPrefix(id),
  });
}

export { handle as GET, handle as PUT, handle as POST, handle as DELETE };
