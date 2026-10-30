// Catch-all for any URL segments typed directly after /api/clone/preview/[id]
// (e.g. a person editing the address bar to add "/admin" or "/some/page"
// instead of using the "?path=" form the preview's own links rewrite to —
// see the click-interceptor script in studio-preview.ts's previewDocument()).
//
// Without this route, a path like /api/clone/preview/<id>/admin doesn't
// match anything under app/api/clone/preview/, so Next falls through to the
// Super App's own global not-found page (src/app/not-found.tsx) — taking the
// person out of the clone entirely, with a "Back to Home" button that goes
// to the Super App's home instead of the cloned site's home. This route
// keeps them inside the clone: it resolves the same way the main preview
// route does (workspace lookup, page lookup) and renders that clone's own
// page-not-found state (or the matching page, if one exists at that path)
// instead of ever reaching the app-wide 404.
import { notFoundDocument, previewDocument, studioAssetPrefix, studioPreviewBase } from "@/features/site-builder/server/studio-preview";
import { workspaceExists, workspaceStore } from "@/features/site-builder/server/workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = Promise<{ id: string; path: string[] }>;

export async function GET(_request: Request, { params }: { params: Params }) {
  const { id, path } = await params;

  if (!(await workspaceExists(id))) {
    return new Response("This clone was not found, or has expired.", { status: 404 });
  }

  const requestedPath = `/${(path ?? []).map(decodeURIComponent).join("/")}`;
  const store = workspaceStore(id);
  const [site, page] = await Promise.all([store.site(), store.get(requestedPath)]);

  if (!page) {
    // Same styled "not found" shell the main preview route serves for an
    // unknown ?path=, with a link back to this clone's own home (not the
    // Super App's) so the person never leaves the preview.
    return new Response(
      notFoundDocument(requestedPath, studioPreviewBase(id) + encodeURIComponent("/"), site.name),
      { status: 404, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }

  return new Response(previewDocument(site, page, studioAssetPrefix(id), studioPreviewBase(id)), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
