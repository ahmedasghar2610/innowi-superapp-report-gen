// Sign in to one website's /admin editor with that website's password.
// The API checks it and returns a token scoped to this website only, kept in
// an httpOnly cookie — the browser never sees it.
import { cookies } from "next/headers";
import { adminCookie, apiUrl, EDITOR_ENABLED } from "@/lib/editor";
import { json } from "@/lib/admin-route";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: { slug: string } }) {
  if (!EDITOR_ENABLED) return json({ error: "The editor is turned off." }, 404);
  const body = (await request.json().catch(() => ({}))) as { password?: string };
  if (!body.password) return json({ error: "Enter the password." }, 400);

  let res: Response;
  try {
    res = await fetch(apiUrl(params.slug, "/admin/login"), {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: body.password }),
    });
  } catch {
    return json({ error: "The website service isn't reachable. Try again shortly." }, 502);
  }
  const data = (await res.json().catch(() => ({}))) as { token?: string; expiresIn?: number; message?: string | string[]; detail?: string };
  if (!res.ok || !data.token) {
    const msg = Array.isArray(data.message) ? data.message.join(" · ") : data.message || data.detail;
    return json({ error: msg || "Incorrect password." }, res.status === 200 ? 401 : res.status);
  }

  cookies().set(adminCookie(params.slug), data.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: data.expiresIn || 60 * 60 * 24 * 7,
    path: "/",
  });
  return json({ ok: true });
}
