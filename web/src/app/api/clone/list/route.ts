// "My Clones" — the durable list of saved clone/SEO runs (see saveClone() in
// workspaces.ts). Unrelated to the 24h workspace TTL: only entries someone
// explicitly saved show up here.
import { listClones } from "@/features/site-builder/server/workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const clones = await listClones();
  return Response.json({ data: clones });
}
