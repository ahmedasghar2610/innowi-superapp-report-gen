// Save a finished clone/SEO run into "My Clones" (POST, exempts it from the
// 24h workspace TTL) or remove it (DELETE, drops the index row and the
// workspace files together).
import { getWorkspaceMeta, removeClone, saveClone } from "@/features/site-builder/server/workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

export async function POST(_request: Request, { params }: { params: Params }) {
  const { id } = await params;
  const meta = await getWorkspaceMeta(id);
  if (!meta) {
    return Response.json({ error: "Unknown or expired workspace." }, { status: 404 });
  }
  const summary = await saveClone(id);
  return Response.json({ data: summary });
}

export async function DELETE(_request: Request, { params }: { params: Params }) {
  const { id } = await params;
  await removeClone(id);
  return new Response(null, { status: 204 });
}
