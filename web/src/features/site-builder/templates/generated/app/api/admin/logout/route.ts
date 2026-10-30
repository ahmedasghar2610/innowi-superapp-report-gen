// Clears the /admin session cookie set by /api/admin/login.
import { cookies } from "next/headers";
import { ADMIN_SESSION_COOKIE } from "@/lib/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const store = await cookies();
  store.delete(ADMIN_SESSION_COOKIE);
  return Response.json({ ok: true });
}
