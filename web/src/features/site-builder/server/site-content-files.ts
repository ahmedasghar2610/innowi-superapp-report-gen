// Helpers for building the in-memory file map that becomes a zip / workspace.
import type { PageChrome } from "@/features/site-builder/server/clone-chrome";
import {
  PAGES_FILE,
  SITE_FILE,
  type PageRecord,
  type PagesFile,
  type SiteFile,
} from "@/features/site-builder/server/content-store";

export type FileMap = Record<string, string | Buffer>;

export function readPagesFile(files: FileMap): PagesFile {
  const raw = files[PAGES_FILE];
  if (typeof raw !== "string") return { pages: {} };
  try {
    const parsed = JSON.parse(raw) as PagesFile;
    return parsed.pages ? parsed : { pages: {} };
  } catch {
    return { pages: {} };
  }
}

export function writePagesFile(files: FileMap, data: PagesFile): void {
  files[PAGES_FILE] = JSON.stringify(data, null, 2);
}

export function readSiteFile(files: FileMap): SiteFile | null {
  const raw = files[SITE_FILE];
  if (typeof raw !== "string") return null;
  try {
    return JSON.parse(raw) as SiteFile;
  } catch {
    return null;
  }
}

export function writeSiteFile(files: FileMap, site: SiteFile): void {
  files[SITE_FILE] = JSON.stringify(site, null, 2);
}

export function siteFileFromChrome(
  chrome: PageChrome,
  origin: string,
  name?: string,
  faviconPath?: string,
): SiteFile {
  return {
    name: name || chrome.title || "Cloned site",
    origin,
    lang: chrome.lang || "en",
    htmlClass: chrome.htmlClass,
    bodyClass: chrome.bodyClass,
    dataTheme: chrome.dataTheme,
    fontHrefs: chrome.fontHrefs,
    faviconPath,
  };
}

export function pageRecord(title: string, html: string, description = ""): PageRecord {
  return { title, description, html, updatedAt: new Date().toISOString() };
}
