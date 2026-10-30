// COPIED from innowi-superapp-web/src/features/site-builder/server/content-store.ts by scripts/sync-editor.cjs.
// Edit it there, then run `npm run sync-editor`.
// Shared between Site Builder and every generated site (copied verbatim into zips).
// Keep this file free of "@/..." imports.
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export type PageRecord = {
  title: string;
  description?: string;
  html: string;
  /** Per-page stylesheet written by the visual editor's style panel. */
  css?: string;
  updatedAt?: string;
};

export type PagesFile = {
  pages: Record<string, PageRecord>;
};

/**
 * Site-wide design tokens set from the editor's Theme panel — colors,
 * typography, and default heading/text/button/link/surface styling that
 * apply across every page of the site (per-element Style-panel overrides,
 * which are always written `!important`, still win over these). Serialized
 * to CSS custom properties on `:root` by `theme-css.ts` and rendered ahead
 * of the per-page `<style id="sb-page-css">` block wherever a page is
 * rendered (the Studio editor's live preview, the "Visit" preview, and the
 * generated site's own `app/(site)/layout.tsx`), so all three always agree.
 * Every field is optional — an unset field means "use the built-in
 * default" and is simply omitted from the generated CSS.
 */
export type SiteTheme = {
  colors?: {
    background?: string;
    surface?: string;
    foreground?: string;
    muted?: string;
    accent?: string;
    accentForeground?: string;
    border?: string;
    linkColor?: string;
    linkHoverColor?: string;
  };
  typography?: {
    /** Body/paragraph font stack. */
    bodyFont?: string;
    /** Heading (h1-h6) font stack. Falls back to bodyFont when unset. */
    headingFont?: string;
    /** Root font size (px), scales every rem-based size in the theme. */
    baseSize?: number;
    bodyLineHeight?: number;
    headingLineHeight?: number;
    /** Letter-spacing applied to headings only, e.g. "-0.01em". */
    headingLetterSpacing?: string;
    headingWeight?: number;
    bodyWeight?: number;
    /** Per-level font-size overrides (CSS length, e.g. "2.5rem"). */
    h1Size?: string;
    h2Size?: string;
    h3Size?: string;
    h4Size?: string;
    h5Size?: string;
    h6Size?: string;
  };
  buttons?: {
    radius?: string;
    paddingBlock?: string;
    paddingInline?: string;
    fontWeight?: number;
    textTransform?: "none" | "uppercase" | "capitalize" | "lowercase";
    /** Filled (primary) button background; defaults to colors.accent. */
    background?: string;
    /** Filled (primary) button text color; defaults to colors.accentForeground. */
    foreground?: string;
    borderWidth?: string;
  };
  surfaces?: {
    /** Default corner radius for cards, images, popups, inputs, etc. */
    radius?: string;
    /** Default box-shadow for raised cards/popups. */
    shadow?: string;
    /** Max content width for `.sb-container` (page reading width). */
    maxWidth?: string;
  };
};

export type SiteFile = {
  name: string;
  origin: string;
  /** `<html lang>` for the public site (WCAG 3.1.1). Defaults to "en". */
  lang?: string;
  htmlClass?: string;
  bodyClass?: string;
  dataTheme?: string;
  fontHrefs?: string[];
  /**
   * Public path to the source site's own favicon, once downloaded into this
   * site (e.g. "/assets/icons/<hash>-favicon.ico"). Falls back to the
   * generic Site Builder icon when the source site had none, or it couldn't
   * be fetched.
   */
  faviconPath?: string;
  /** Site-wide design tokens set from the editor's Theme panel. See SiteTheme. */
  theme?: SiteTheme;
};

export type PageSummary = {
  path: string;
  title: string;
  description?: string;
  updatedAt?: string;
};

export const PAGES_FILE = "content/pages.json";
export const SITE_FILE = "content/site.json";
export const UPLOADS_DIR = "public/assets/uploads";

export function normalizePath(raw: string): string {
  let value = (raw || "").trim();
  if (!value) return "/";
  if (/^https?:\/\//i.test(value)) {
    try {
      value = new URL(value).pathname;
    } catch {
      value = "/";
    }
  }
  value = value.split(/[?#]/)[0];
  if (!value.startsWith("/")) value = `/${value}`;
  value = value.replace(/\/{2,}/g, "/");
  if (value.length > 1) value = value.replace(/\/+$/, "");
  return value || "/";
}

export function pathIsSafe(pathname: string): boolean {
  if (pathname === "/") return true;
  return pathname.split("/").every(
    (segment, index) => index === 0 || (segment.length > 0 && segment !== "." && segment !== ".."),
  );
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Pull the first header-ish and footer-ish blocks out of a page so a new page
 * can reuse the site chrome.
 */
export function extractShellFromHtml(html: string): { header: string; footer: string } {
  const pick = (patterns: RegExp[]) => {
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match) return match[0];
    }
    return "";
  };
  const header = pick([
    /<header\b[\s\S]*?<\/header>/i,
    /<div[^>]*class="[^"]*elementor-location-header[^"]*"[\s\S]*?<\/div>\s*(?=<(?:main|section|div))/i,
    /<nav\b[\s\S]*?<\/nav>/i,
  ]);
  const footer = pick([
    /<footer\b[\s\S]*?<\/footer>/i,
    /<div[^>]*class="[^"]*elementor-location-footer[^"]*"[\s\S]*$/i,
  ]);
  return { header, footer };
}

export function blankPageHtml(
  title: string,
  shell: { header: string; footer: string },
  paragraphs: string[] = ["Start writing. Click any text to edit it."],
): string {
  const body = paragraphs.map((text) => `<p>${escapeHtml(text)}</p>`).join("\n      ");
  return `${shell.header}
<main class="sb-csv-page">
  <h1>${escapeHtml(title)}</h1>
  <div class="sb-csv-body">
      ${body}
  </div>
</main>
${shell.footer}`;
}

export type ContentSnapshot = {
  pages?: PagesFile;
  site?: SiteFile;
};

/**
 * @param rootDir  project root holding content/ and public/
 * @param snapshot optional copy of the content files inlined at build time.
 *   Used when the JSON files are missing on disk — managed hosts (Hostinger
 *   "Deploy Web App") run the site from a folder that has only the build
 *   output. The first admin save writes the full content back to disk, and
 *   disk always wins over the snapshot afterwards.
 */
export function createContentStore(rootDir: string, snapshot: ContentSnapshot = {}) {
  const pagesPath = path.join(rootDir, PAGES_FILE);
  const sitePath = path.join(rootDir, SITE_FILE);

  async function readJson<T>(file: string, fallback: T): Promise<T> {
    try {
      const raw = await readFile(file, "utf8");
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
  }

  async function writeJson(file: string, data: unknown): Promise<void> {
    await mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
    await rename(tmp, file);
  }

  async function readPages(): Promise<PagesFile> {
    const data = await readJson<PagesFile>(
      pagesPath,
      snapshot.pages ? clone(snapshot.pages) : { pages: {} },
    );
    if (!data.pages || typeof data.pages !== "object") data.pages = {};
    return data;
  }

  return {
    rootDir,

    async site(): Promise<SiteFile> {
      return readJson<SiteFile>(
        sitePath,
        snapshot.site ? clone(snapshot.site) : { name: "Site", origin: "https://example.com" },
      );
    },

    async saveSite(site: SiteFile): Promise<void> {
      await writeJson(sitePath, site);
    },

    async list(): Promise<PageSummary[]> {
      const { pages } = await readPages();
      return Object.entries(pages)
        .map(([pagePath, page]) => ({
          path: pagePath,
          title: page.title,
          description: page.description,
          updatedAt: page.updatedAt,
        }))
        .sort((a, b) => (a.path === "/" ? -1 : b.path === "/" ? 1 : a.path.localeCompare(b.path)));
    },

    async get(rawPath: string): Promise<(PageRecord & { path: string }) | null> {
      const pagePath = normalizePath(rawPath);
      const { pages } = await readPages();
      const page = pages[pagePath];
      return page ? { path: pagePath, ...page } : null;
    },

    async save(rawPath: string, record: Omit<PageRecord, "updatedAt">): Promise<void> {
      const pagePath = normalizePath(rawPath);
      if (!pathIsSafe(pagePath)) throw new Error("Invalid page path.");
      const data = await readPages();
      data.pages[pagePath] = {
        title: record.title || pagePath,
        description: record.description || "",
        html: record.html || "",
        css: record.css || "",
        updatedAt: new Date().toISOString(),
      };
      await writeJson(pagesPath, data);
    },

    async create(rawPath: string, title: string, templatePath = "/"): Promise<string> {
      const pagePath = normalizePath(rawPath);
      if (!pathIsSafe(pagePath)) throw new Error("Invalid page path.");
      if (pagePath.startsWith("/admin") || pagePath.startsWith("/api")) {
        throw new Error("That path is reserved.");
      }
      const data = await readPages();
      if (data.pages[pagePath]) throw new Error("A page already exists at that path.");
      const template = data.pages[normalizePath(templatePath)] ?? data.pages["/"];
      const shell = template ? extractShellFromHtml(template.html) : { header: "", footer: "" };
      data.pages[pagePath] = {
        title: title || pagePath,
        description: "",
        html: blankPageHtml(title || pagePath, shell),
        updatedAt: new Date().toISOString(),
      };
      await writeJson(pagesPath, data);
      return pagePath;
    },

    /** Copy an existing page (title, description, html, css) to a new path. */
    async duplicate(fromPath: string, toPath: string, title?: string): Promise<string> {
      const source = normalizePath(fromPath);
      const target = normalizePath(toPath);
      if (!pathIsSafe(target)) throw new Error("Invalid page path.");
      if (target.startsWith("/admin") || target.startsWith("/api")) {
        throw new Error("That path is reserved.");
      }
      const data = await readPages();
      const original = data.pages[source];
      if (!original) throw new Error("The page to duplicate was not found.");
      if (data.pages[target]) throw new Error("A page already exists at that path.");
      data.pages[target] = {
        title: title?.trim() || `${original.title} (copy)`,
        description: original.description || "",
        html: original.html,
        css: original.css || "",
        updatedAt: new Date().toISOString(),
      };
      await writeJson(pagesPath, data);
      return target;
    },

    /**
     * Add many pages in one read/write. Existing paths (and reserved or
     * unsafe ones) are skipped rather than overwritten.
     */
    async createMany(
      records: Array<Omit<PageRecord, "updatedAt"> & { path: string }>,
    ): Promise<{ created: string[]; skipped: string[] }> {
      const data = await readPages();
      const created: string[] = [];
      const skipped: string[] = [];
      const now = new Date().toISOString();
      for (const record of records) {
        const pagePath = normalizePath(record.path);
        if (
          !pathIsSafe(pagePath) ||
          pagePath === "/" ||
          pagePath.startsWith("/admin") ||
          pagePath.startsWith("/api") ||
          data.pages[pagePath]
        ) {
          skipped.push(pagePath);
          continue;
        }
        data.pages[pagePath] = {
          title: record.title || pagePath,
          description: record.description || "",
          html: record.html || "",
          css: record.css || "",
          updatedAt: now,
        };
        created.push(pagePath);
      }
      if (created.length > 0) await writeJson(pagesPath, data);
      return { created, skipped };
    },

    async remove(rawPath: string): Promise<void> {
      const pagePath = normalizePath(rawPath);
      if (pagePath === "/") throw new Error("The home page cannot be deleted.");
      const data = await readPages();
      delete data.pages[pagePath];
      await writeJson(pagesPath, data);
    },

    async saveUpload(originalName: string, bytes: Buffer): Promise<string> {
      const ext = (path.extname(originalName) || ".bin").toLowerCase().slice(0, 8);
      const base = path
        .basename(originalName, path.extname(originalName))
        .replace(/[^a-zA-Z0-9_-]+/g, "-")
        .slice(0, 48) || "image";
      const name = `${base}-${Date.now().toString(36)}${ext}`;
      const dir = path.join(rootDir, UPLOADS_DIR);
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, name), bytes);
      return `/assets/uploads/${name}`;
    },

    async listUploads(): Promise<string[]> {
      try {
        const names = await readdir(path.join(rootDir, UPLOADS_DIR));
        return names.map((name) => `/assets/uploads/${name}`);
      } catch {
        return [];
      }
    },

    async removeAll(): Promise<void> {
      await rm(rootDir, { recursive: true, force: true });
    },
  };
}

export type ContentStore = ReturnType<typeof createContentStore>;
