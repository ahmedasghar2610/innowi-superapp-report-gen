// Mirrors ../pages/route.ts: reads/writes this site's own site.json (theme
// tokens set from the /admin editor's Theme panel). Gated by the same
// /admin session cookie as the editor page and every other /api/admin route.
import { cookies } from "next/headers";
import { handleSiteRequest } from "@/lib/content-api";
import { store } from "@/lib/site-store";
import { ADMIN_SESSION_COOKIE, isValidSession } from "@/lib/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(request: Request) {
  const cookieStore = await cookies();
  if (!isValidSession(cookieStore.get(ADMIN_SESSION_COOKIE)?.value)) {
    return Response.json({ error: "Not authenticated." }, { status: 401 });
  }
  return handleSiteRequest(store, request);
}

export { handle as GET, handle as PUT, handle as POST };
