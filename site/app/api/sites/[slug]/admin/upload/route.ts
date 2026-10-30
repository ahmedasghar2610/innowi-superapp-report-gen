// The editor's /upload endpoint — images go to the API's website storage.
import { handleUploadRequest } from "@/lib/site-builder/content-api";
import { withAdmin } from "@/lib/admin-route";

export const dynamic = "force-dynamic";

export async function POST(request: Request, ctx: { params: { slug: string } }) {
  const admin = await withAdmin(request, ctx);
  if (admin instanceof Response) return admin;
  return handleUploadRequest(admin.store, request);
}
