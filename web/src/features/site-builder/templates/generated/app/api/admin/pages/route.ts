// Ported from src/app/api/studio/[id]/pages/route.ts, simplified for a
// generated site: a zip is always exactly one site, so there's no
// workspace id lookup — `store` comes straight from lib/site-store, and
// asset URLs need no prefix rewriting (assets are already served at
// /assets/... on this site's own origin). Gated by the same /admin session
// cookie as the editor page itself.
import { cookies } from "next/headers";
import { handlePagesRequest } from "@/lib/content-api";
import { store } from "@/lib/site-store";
import { ADMIN_SESSION_COOKIE, isValidSession } from "@/lib/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(request: Request) {
  const cookieStore = await cookies();
  if (!isValidSession(cookieStore.get(ADMIN_SESSION_COOKIE)?.value)) {
    return Response.json({ error: "Not authenticated." }, { status: 401 });
  }
  return handlePagesRequest(store, request, { assetPrefix: "" });
}

export { handle as GET, handle as PUT, handle as POST, handle as DELETE };
