// Password gate for /admin (this site's visual editor). Compares the
// submitted password to ADMIN_PASSWORD (see the README / .env.local) and, on
// success, sets an httpOnly cookie holding a SHA-256 hash of that password —
// never the plaintext password itself. app/(admin)/admin/page.tsx and the
// /api/admin/pages and /api/admin/upload routes all recompute that same hash
// to decide whether a request is authenticated.
import { cookies } from "next/headers";
import { ADMIN_SESSION_COOKIE, ADMIN_SESSION_MAX_AGE, expectedSessionValue, isValidPassword } from "@/lib/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const expected = expectedSessionValue();
  if (!expected) {
    return Response.json({ error: "ADMIN_PASSWORD is not configured." }, { status: 500 });
  }

  let body: { password?: string };
  try {
    body = (await request.json()) as { password?: string };
  } catch {
    return Response.json({ error: "Incorrect password." }, { status: 401 });
  }

  if (!isValidPassword(body.password ?? "")) {
    return Response.json({ error: "Incorrect password." }, { status: 401 });
  }

  const store = await cookies();
  store.set(ADMIN_SESSION_COOKIE, expected, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: ADMIN_SESSION_MAX_AGE,
    path: "/",
  });

  return Response.json({ ok: true });
}
