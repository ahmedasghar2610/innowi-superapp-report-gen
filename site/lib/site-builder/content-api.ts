// COPIED from innowi-superapp-web/src/features/site-builder/server/content-api.ts by scripts/sync-editor.cjs.
// Edit it there, then run `npm run sync-editor`.
// Shared between Site Builder (/api/studio/[id]/*) and generated sites
// (/api/admin/*). Copied verbatim into zips — keep it free of "@/..." imports
// other than content-store / csv-pages, which are copied alongside it.
import { normalizePath, type ContentStore, type SiteTheme } from "./content-store";
import { buildCsvPages } from "./csv-pages";
import { pruneTheme } from "./theme-css";
import { detectSiteTheme } from "./theme-detect";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|svg|ico|bmp)$/i;

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

function fail(error: unknown, status = 400): Response {
  const message = error instanceof Error ? error.message : String(error);
  return json({ error: message }, status);
}

export type PagesRequestOptions = {
  /** Strip this prefix from asset URLs before saving (Builder preview rewrites them). */
  assetPrefix?: string;
};

function unprefixAssets(html: string, prefix?: string): string {
  if (!prefix) return html;
  return html.split(prefix).join("");
}

export async function handlePagesRequest(
  store: ContentStore,
  request: Request,
  options: PagesRequestOptions = {},
): Promise<Response> {
  const url = new URL(request.url);
  try {
    switch (request.method) {
      case "GET": {
        const path = url.searchParams.get("path");
        if (path) {
          const page = await store.get(path);
          if (!page) return json({ error: "Page not found." }, 404);
          return json(page);
        }
        const [pages, site] = await Promise.all([store.list(), store.site()]);
        return json({ pages, site });
      }
      case "PUT": {
        const body = (await request.json()) as {
          path?: string;
          title?: string;
          description?: string;
          html?: string;
          css?: string;
        };
        if (!body.path) return fail("Missing path.");
        await store.save(body.path, {
          title: body.title || "",
          description: body.description || "",
          html: unprefixAssets(body.html || "", options.assetPrefix),
          css: unprefixAssets(body.css || "", options.assetPrefix),
        });
        return json({ ok: true, path: normalizePath(body.path) });
      }
      case "POST": {
        const body = (await request.json()) as {
          path?: string;
          title?: string;
          template?: string;
          /** Duplicate: copy this existing page to `path`. */
          duplicateOf?: string;
          /** CSV import: raw CSV text; pages inherit header/footer of `template`. */
          csv?: string;
          dryRun?: boolean;
        };

        if (typeof body.csv === "string") {
          const templatePage = await store.get(body.template || "/");
          const built = buildCsvPages(body.csv, templatePage?.html || "");
          const existing = new Set((await store.list()).map((p) => p.path));
          if (body.dryRun) {
            return json({
              ok: true,
              mapping: built.mapping,
              rowCount: built.rowCount,
              pages: built.pages.map((page) => ({
                path: normalizePath(page.path),
                title: page.title,
                exists: existing.has(normalizePath(page.path)),
              })),
            });
          }
          const result = await store.createMany(built.pages);
          return json({ ok: true, ...result }, 201);
        }

        if (!body.path) return fail("Missing path.");
        if (body.duplicateOf) {
          const path = await store.duplicate(body.duplicateOf, body.path, body.title);
          return json({ ok: true, path }, 201);
        }
        const path = await store.create(body.path, body.title || "", body.template || "/");
        return json({ ok: true, path }, 201);
      }
      case "DELETE": {
        const path = url.searchParams.get("path");
        if (!path) return fail("Missing path.");
        await store.remove(path);
        return json({ ok: true });
      }
      default:
        return json({ error: "Method not allowed." }, 405);
    }
  } catch (error) {
    return fail(error);
  }
}

/**
 * GET returns the current site.json (name/origin/lang/theme/...); PUT merges
 * the given fields into it (shallow on top-level SiteFile keys, `theme` is
 * itself shallow-merged one level deeper so setting `colors` doesn't wipe
 * `typography`/`buttons`/`surfaces` set in an earlier save).
 */
export async function handleSiteRequest(store: ContentStore, request: Request): Promise<Response> {
  try {
    switch (request.method) {
      case "GET": {
        const site = await store.site();
        return json({ site });
      }
      case "PUT": {
        const body = (await request.json()) as {
          name?: string;
          lang?: string;
          theme?: SiteTheme;
        };
        const current = await store.site();
        // The editor always sends the complete theme, so it replaces the
        // stored one outright — that's what lets "Reset all" and clearing a
        // field actually remove a saved value (a merge would keep it).
        await store.saveSite({
          ...current,
          name: body.name !== undefined ? body.name : current.name,
          lang: body.lang !== undefined ? body.lang : current.lang,
          theme: body.theme !== undefined ? pruneTheme(body.theme) : current.theme,
        });
        return json({ ok: true });
      }
      case "POST": {
        // { action: "detect" } — scan this workspace's own cloned.css and
        // return a best-effort SiteTheme guess. Read-only: does not touch
        // site.json. The editor merges the result into empty fields only.
        const body = (await request.json().catch(() => ({}))) as { action?: string };
        if (body.action !== "detect") return fail("Unknown action.");
        const detected = await detectSiteTheme(store);
        return json({ ok: true, theme: detected.theme, foundCount: detected.foundCount });
      }
      default:
        return json({ error: "Method not allowed." }, 405);
    }
  } catch (error) {
    return fail(error);
  }
}

export async function handleUploadRequest(
  store: ContentStore,
  request: Request,
): Promise<Response> {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return fail("Expected a file field named 'file'.");
    if (file.size > MAX_UPLOAD_BYTES) return fail("File is larger than 25 MB.", 413);
    const isImage = file.type.startsWith("image/") || IMAGE_EXT.test(file.name);
    if (!isImage) return fail("Only image uploads are allowed.");
    const bytes = Buffer.from(await file.arrayBuffer());
    const url = await store.saveUpload(file.name || "image", bytes);
    return json({ ok: true, url }, 201);
  } catch (error) {
    return fail(error);
  }
}
