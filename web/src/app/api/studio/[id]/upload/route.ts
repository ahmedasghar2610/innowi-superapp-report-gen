// Ported from site-builder-source-for-developer/app/api/studio/[id]/upload/route.ts.
import { handleUploadRequest } from "@/features/site-builder/server/content-api";
import { workspaceExists, workspaceStore } from "@/features/site-builder/server/workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

export async function POST(request: Request, { params }: { params: Params }) {
  const { id } = await params;
  if (!(await workspaceExists(id))) {
    return Response.json({ error: "Workspace not found or expired." }, { status: 404 });
  }
  return handleUploadRequest(workspaceStore(id), request);
}
