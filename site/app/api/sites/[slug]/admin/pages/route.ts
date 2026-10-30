// The editor's /pages endpoint — list, read, save, add, duplicate and delete
// pages. Same handler the Super App's Studio and every cloned site's /admin
// use (lib/site-builder/content-api.ts), over the API-backed store.
import { revalidatePath } from "next/cache";
import { handlePagesRequest } from "@/lib/site-builder/content-api";
import { withAdmin } from "@/lib/admin-route";

export const dynamic = "force-dynamic";

async function handle(request: Request, ctx: { params: { slug: string } }) {
  const admin = await withAdmin(request, ctx);
  if (admin instanceof Response) return admin;
  const res = await handlePagesRequest(admin.store, request);
  // Saved changes show on the public page at once, whatever SITE_REVALIDATE is.
  if (request.method !== "GET" && res.ok) revalidatePath(`/${admin.slug}`, "layout");
  return res;
}

export { handle as GET, handle as PUT, handle as POST, handle as DELETE };
