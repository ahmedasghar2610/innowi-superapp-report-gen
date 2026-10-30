/**
 * A Site Builder ContentStore backed by the Innowi API instead of files.
 *
 * The editor's route handlers (lib/site-builder/content-api.ts, copied from the
 * Super App) work against a `ContentStore`: pages and site settings on disk for
 * a cloned site. Here the same interface reads and writes one website's
 * `editor_content` through `/websites/<slug>/content`, so the handlers — and
 * the editor — run unchanged.
 *
 * Until the first save the store starts from a snapshot of the template page
 * (lib/editor.js buildSnapshot); nothing is stored until something is saved.
 */
import {
  blankPageHtml,
  extractShellFromHtml,
  normalizePath,
  pathIsSafe,
  type ContentStore,
  type PageRecord,
  type PageSummary,
  type PagesFile,
  type SiteFile,
} from "@/lib/site-builder/content-store";
import { API_ORIGIN } from "@/lib/sites";
import { apiUrl } from "@/lib/editor";

type Content = { pages: PagesFile["pages"]; site: SiteFile };

async function apiError(res: Response): Promise<Error> {
  const body = (await res.json().catch(() => ({}))) as { message?: string | string[]; detail?: unknown };
  const msg = Array.isArray(body.message) ? body.message.join(" · ") : body.message || (typeof body.detail === "string" ? body.detail : "");
  return new Error(msg || `The API refused the change (${res.status}).`);
}

function reserved(pagePath: string): boolean {
  return pagePath.startsWith("/admin") || pagePath.startsWith("/api");
}

export function createRemoteStore(opts: {
  slug: string;
  token: string;
  /** Builds the starting content when the site has never been saved. */
  initial: () => Promise<Content>;
}): ContentStore {
  const { slug, token } = opts;
  const auth = { Authorization: `Bearer ${token}` };
  let cache: Content | null = null;

  async function load(): Promise<Content> {
    if (cache) return cache;
    // With the editor token: a site that isn't public hides its pages from
    // anonymous reads, and a 404 here would restart the editor from a fresh
    // snapshot over the saved edits.
    const res = await fetch(apiUrl(slug, "/content"), { cache: "no-store", headers: auth });
    if (res.ok) {
      const data = (await res.json()) as Content;
      cache = { pages: data.pages || {}, site: data.site || ({ name: slug, origin: "" } as SiteFile) };
    } else if (res.status === 404) {
      cache = await opts.initial();
    } else {
      throw await apiError(res);
    }
    return cache;
  }

  async function persist(next: Content): Promise<void> {
    const res = await fetch(apiUrl(slug, "/content"), {
      method: "PUT",
      cache: "no-store",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify(next),
    });
    if (!res.ok) throw await apiError(res);
    // The API re-stamps form-bound elements on save (and writes visual edits
    // back into the form answers), so keep what it returns, not what we sent.
    const saved = (await res.json().catch(() => null)) as Content | null;
    cache = saved?.pages ? { pages: saved.pages, site: saved.site || next.site } : next;
  }

  const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
  const now = () => new Date().toISOString();

  const store = {
    rootDir: "",

    async site(): Promise<SiteFile> {
      return clone((await load()).site);
    },

    async saveSite(site: SiteFile): Promise<void> {
      const data = clone(await load());
      await persist({ ...data, site });
    },

    async list(): Promise<PageSummary[]> {
      const { pages } = await load();
      return Object.entries(pages)
        .map(([path, page]) => ({ path, title: page.title, description: page.description, updatedAt: page.updatedAt }))
        .sort((a, b) => (a.path === "/" ? -1 : b.path === "/" ? 1 : a.path.localeCompare(b.path)));
    },

    async get(rawPath: string): Promise<(PageRecord & { path: string }) | null> {
      const path = normalizePath(rawPath);
      const page = (await load()).pages[path];
      return page ? { path, ...clone(page) } : null;
    },

    async save(rawPath: string, record: Omit<PageRecord, "updatedAt">): Promise<void> {
      const path = normalizePath(rawPath);
      if (!pathIsSafe(path)) throw new Error("Invalid page path.");
      const data = clone(await load());
      data.pages[path] = {
        title: record.title || path,
        description: record.description || "",
        html: record.html || "",
        css: record.css || "",
        updatedAt: now(),
      };
      await persist(data);
    },

    async create(rawPath: string, title: string, templatePath = "/"): Promise<string> {
      const path = normalizePath(rawPath);
      if (!pathIsSafe(path)) throw new Error("Invalid page path.");
      if (reserved(path)) throw new Error("That path is reserved.");
      const data = clone(await load());
      if (data.pages[path]) throw new Error("A page already exists at that path.");
      const template = data.pages[normalizePath(templatePath)] ?? data.pages["/"];
      const shell = template ? extractShellFromHtml(template.html) : { header: "", footer: "" };
      data.pages[path] = { title: title || path, description: "", html: blankPageHtml(title || path, shell), updatedAt: now() };
      await persist(data);
      return path;
    },

    async duplicate(fromPath: string, toPath: string, title?: string): Promise<string> {
      const source = normalizePath(fromPath);
      const target = normalizePath(toPath);
      if (!pathIsSafe(target)) throw new Error("Invalid page path.");
      if (reserved(target)) throw new Error("That path is reserved.");
      const data = clone(await load());
      const original = data.pages[source];
      if (!original) throw new Error("The page to duplicate was not found.");
      if (data.pages[target]) throw new Error("A page already exists at that path.");
      data.pages[target] = {
        title: title?.trim() || `${original.title} (copy)`,
        description: original.description || "",
        html: original.html,
        css: original.css || "",
        updatedAt: now(),
      };
      await persist(data);
      return target;
    },

    async createMany(
      records: Array<Omit<PageRecord, "updatedAt"> & { path: string }>,
    ): Promise<{ created: string[]; skipped: string[] }> {
      const data = clone(await load());
      const created: string[] = [];
      const skipped: string[] = [];
      for (const record of records) {
        const path = normalizePath(record.path);
        if (!pathIsSafe(path) || path === "/" || reserved(path) || data.pages[path]) {
          skipped.push(path);
          continue;
        }
        data.pages[path] = {
          title: record.title || path,
          description: record.description || "",
          html: record.html || "",
          css: record.css || "",
          updatedAt: now(),
        };
        created.push(path);
      }
      if (created.length) await persist(data);
      return { created, skipped };
    },

    async remove(rawPath: string): Promise<void> {
      const path = normalizePath(rawPath);
      if (path === "/") throw new Error("The home page cannot be deleted.");
      const data = clone(await load());
      delete data.pages[path];
      await persist(data);
    },

    /** Images go to the API's website storage; the absolute URL goes in the page. */
    async saveUpload(originalName: string, bytes: Buffer): Promise<string> {
      const form = new FormData();
      form.append("file", new Blob([new Uint8Array(bytes)]), originalName || "image");
      const res = await fetch(apiUrl(slug, "/content/assets"), { method: "POST", headers: auth, body: form });
      if (!res.ok) throw await apiError(res);
      const asset = (await res.json()) as { url: string };
      return asset.url.startsWith("/") && API_ORIGIN ? `${API_ORIGIN}${asset.url}` : asset.url;
    },

    async listUploads(): Promise<string[]> {
      return [];
    },

    async removeAll(): Promise<void> {
      const res = await fetch(apiUrl(slug, "/content"), { method: "DELETE", headers: auth });
      if (!res.ok && res.status !== 404) throw await apiError(res);
      cache = null;
    },
  };

  return store as unknown as ContentStore;
}
