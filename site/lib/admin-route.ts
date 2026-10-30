/**
 * Shared plumbing for the /api/sites/<slug>/admin/* route handlers: read the
 * site's editor cookie, build the API-backed content store, and refuse when
 * the editor is switched off or the visitor isn't signed in.
 *
 * The API re-checks the token on every write, so these checks are for clear
 * errors, not the security boundary.
 */
import { cookies } from "next/headers";
import { adminCookie, buildSnapshot, EDITOR_ENABLED, editorSession, selfOrigin } from "@/lib/editor";
import { createRemoteStore } from "@/lib/remote-store";
import { getSite } from "@/lib/sites";
import type { ContentStore } from "@/lib/site-builder/content-store";

type Ctx = { params: { slug: string } };

export type AdminContext = { slug: string; token: string; store: ContentStore; site: Record<string, any> };

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export async function withAdmin(request: Request, ctx: Ctx): Promise<AdminContext | Response> {
  if (!EDITOR_ENABLED) return json({ error: "The editor is turned off." }, 404);
  const slug = ctx.params.slug;
  const token = cookies().get(adminCookie(slug))?.value || "";
  if (!(await editorSession(slug, token))) return json({ error: "Not authenticated." }, 401);
  const site = await getSite(slug, { token });
  if (!site) return json({ error: "No such website." }, 404);
  const origin = selfOrigin(request.url);
  const store = createRemoteStore({ slug, token, initial: () => buildSnapshot(site, origin, token) });
  return { slug, token, store, site };
}
