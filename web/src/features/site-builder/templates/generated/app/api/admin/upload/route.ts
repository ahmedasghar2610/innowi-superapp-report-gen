// Ported from src/app/api/studio/[id]/upload/route.ts, simplified for a
// generated site (single site, no workspace id). Gated by the same /admin
// session cookie as the editor page itself.
import { cookies } from "next/headers";
import { handleUploadRequest } from "@/lib/content-api";
import { store } from "@/lib/site-store";
import { ADMIN_SESSION_COOKIE, isValidSession } from "@/lib/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const cookieStore = await cookies();
  if (!isValidSession(cookieStore.get(ADMIN_SESSION_COOKIE)?.value)) {
    return Response.json({ error: "Not authenticated." }, { status: 401 });
  }
  return handleUploadRequest(store, request);
}
