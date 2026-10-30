import { normalizePath } from "@/features/site-builder/server/content-store";
import type { ColumnMapping } from "@/features/site-builder/server/csv-map";
import { CSV_PAGE_CSS, csvGeneratedPages, csvPageHtml } from "@/features/site-builder/server/csv-pages";
import {
  pageRecord,
  readPagesFile,
  writePagesFile,
  type FileMap,
} from "@/features/site-builder/server/site-content-files";
import * as cheerio from "cheerio";

export { CSV_PAGE_CSS };

export function extractShell(html: string): { header: string; footer: string } {
  const $ = cheerio.load(html);
  const header =
    $("header").first().toString() ||
    $(".elementor-location-header").first().toString() ||
    $("#header, .site-header, [role='banner']").first().toString() ||
    $("nav").first().toString() ||
    "";
  const footer =
    $("footer").first().toString() ||
    $(".elementor-location-footer").first().toString() ||
    $("#footer, .site-footer, [role='contentinfo']").first().toString() ||
    "";
  return { header, footer };
}

export function mergeCsvPagesIntoClone(
  files: FileMap,
  _origin: string,
  rows: Record<string, string>[],
  mapping: ColumnMapping,
): { files: FileMap; created: number } {
  const pages = csvGeneratedPages(rows, mapping);
  const data = readPagesFile(files);
  const home = data.pages["/"];
  const shell = home ? extractShell(home.html) : { header: "", footer: "" };

  let created = 0;
  for (const page of pages) {
    const key = normalizePath(page.path);
    if (data.pages[key]) continue;
    data.pages[key] = pageRecord(
      page.title,
      csvPageHtml(page, shell.header, shell.footer),
      page.description,
    );
    created += 1;
  }
  writePagesFile(files, data);

  const clonedCss = files["public/cloned.css"];
  if (typeof clonedCss === "string") {
    if (!clonedCss.includes(".sb-csv-page")) {
      files["public/cloned.css"] = `${clonedCss}\n${CSV_PAGE_CSS}`;
    }
  } else {
    files["public/cloned.css"] = CSV_PAGE_CSS;
  }

  return { files, created };
}
