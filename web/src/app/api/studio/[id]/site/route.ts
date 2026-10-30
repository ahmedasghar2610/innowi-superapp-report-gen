// Mirrors ../pages/route.ts: reads/writes this workspace's site.json (name,
// lang, and the site-wide Theme-panel tokens) via handleSiteRequest.
import { handleSiteRequest } from "@/features/site-builder/server/content-api";
import { workspaceExists, workspaceStore } from "@/features/site-builder/server/workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

async function handle(request: Request, { params }: { params: Params }) {
  const { id } = await params;
  if (!(await workspaceExists(id))) {
    return Response.json({ error: "Workspace not found or expired." }, { status: 404 });
  }
  return handleSiteRequest(workspaceStore(id), request);
}

export { handle as GET, handle as PUT, handle as POST };
