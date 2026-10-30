// Ported from site-builder-source-for-developer/app/api/clone/download/route.ts.
// Same query contract: GET /api/clone/download?id=<downloadId>.
import { getCloneJob, zipCloneJob } from "@/features/site-builder/server/clone-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id") || "";
  const job = await getCloneJob(id);
  if (!job) {
    return Response.json({ error: "Unknown or expired download." }, { status: 404 });
  }

  const zip = await zipCloneJob(id);
  return new Response(new Uint8Array(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${job.filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
