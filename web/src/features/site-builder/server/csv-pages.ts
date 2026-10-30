// CSV -> pages. Shared between Site Builder ("SEO from CSV" flow) and every
// generated site (/admin "Import CSV"). Copied verbatim into zips — keep it
// free of "@/..." imports and third-party dependencies (generated sites have
// no papaparse or cheerio).
import { applyMapping, autoMapColumns, type ColumnMapping, type SeoRow } from "./csv-map";
import { escapeHtml, extractShellFromHtml, normalizePath, pathIsSafe } from "./content-store";
import { slugify } from "./slug";

export const MAX_CSV_BYTES = 2 * 1024 * 1024;
export const MAX_CSV_ROWS = 2000;

/** Minimal RFC 4180 parser: quoted fields, doubled quotes, CR/LF/CRLF. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i += 1;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const nonEmpty = rows.filter((r) => r.some((cell) => cell.trim() !== ""));
  if (nonEmpty.length < 2) return [];
  const headers = nonEmpty[0].map((h, index) => h.trim() || `column_${index + 1}`);
  return nonEmpty.slice(1).map((cells) => {
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      record[header] = (cells[index] ?? "").trim();
    });
    return record;
  });
}

export type CsvGeneratedPage = {
  path: string;
  title: string;
  description: string;
  kicker: string;
  paragraphs: string[];
  links: { href: string; label: string }[];
};

function sentenceCase(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function uniqueBody(row: SeoRow): string[] {
  const keyword = row.keyword || row.title || "this service";
  const location = row.location || "your area";
  const category = row.category || "local services";
  const title = row.title || `${sentenceCase(keyword)} in ${location}`;
  return [
    `${title} is written for people comparing ${category.toLowerCase()} options around ${location}. This page focuses on ${keyword.toLowerCase()} — what it covers, who it helps, and how to choose without wading through generic filler.`,
    `If you searched for ${keyword.toLowerCase()} in ${location}, you probably want a clear next step: scope the job, check local fit, and know which questions to ask. Use this guide as a briefing before you call or book.`,
    `${sentenceCase(category)} pages on this site are split by neighborhood and topic so internal links stay specific. Related ${location} pages and ${keyword.toLowerCase()} articles are listed below so crawlers and humans land on the closest match.`,
  ];
}

export function rowParagraphs(row: SeoRow): string[] {
  if (row.content) {
    return row.content
      .split(/\n{2,}/)
      .map((part) => part.trim())
      .filter(Boolean);
  }
  return uniqueBody(row);
}

function pathFromRow(row: SeoRow): string | null {
  const raw = (row.url || row.slug || "").trim();
  if (!raw) return null;
  // normalizePath handles full URLs (keeps the pathname) and relative paths.
  const path = normalizePath(raw);
  return pathIsSafe(path) ? path : null;
}

export function csvGeneratedPages(
  rowsInput: Record<string, string>[],
  mapping: ColumnMapping,
): CsvGeneratedPage[] {
  const rows = applyMapping(rowsInput, mapping);
  if (rows.length === 0) {
    throw new Error("No usable rows after mapping. Need a URL, title, keyword, or category.");
  }

  const used = new Set<string>();
  const pages: CsvGeneratedPage[] = [];

  for (const row of rows) {
    let path = pathFromRow(row);
    if (!path || path === "/") {
      if (row.category && row.location) {
        path = `/${slugify(row.category)}/${slugify(row.location)}`;
      } else if (row.category) {
        path = `/${slugify(row.category)}`;
      } else {
        path = `/blog/${slugify(row.slug || row.title || row.keyword || "page")}`;
      }
    }
    if (used.has(path)) {
      path = `${path}-${used.size + 1}`.replace(/\/-/, "/");
    }
    used.add(path);

    const title =
      row.title ||
      [row.keyword, row.location].filter(Boolean).join(" in ") ||
      row.category ||
      path;
    pages.push({
      path,
      title,
      description:
        row.content?.replace(/\s+/g, " ").slice(0, 155) ||
        `${title}${row.location ? ` in ${row.location}` : ""}`,
      kicker: [row.category, row.location, row.keyword].filter(Boolean).join(" · "),
      paragraphs: rowParagraphs(row),
      links: [],
    });
  }

  for (const page of pages) {
    page.links = pages
      .filter((other) => other.path !== page.path)
      .slice(0, 10)
      .map((other) => ({ href: other.path, label: other.title }));
  }

  return pages;
}

export const CSV_PAGE_CSS = `
/* CSV-generated pages — not compiled by LightningCSS */
#cloned-root .sb-csv-page {
  max-width: 44rem;
  margin: 2.5rem auto 4rem;
  padding: 0 1.25rem;
}
#cloned-root .sb-csv-kicker {
  letter-spacing: 0.14em;
  text-transform: uppercase;
  font-size: 0.75rem;
  opacity: 0.65;
  margin: 0 0 0.75rem;
}
#cloned-root .sb-csv-page h1 {
  margin: 0 0 1.25rem;
  line-height: 1.15;
}
#cloned-root .sb-csv-body p {
  margin: 0 0 1rem;
  line-height: 1.7;
}
#cloned-root .sb-csv-related {
  margin-top: 2.5rem;
  padding-top: 1.5rem;
  border-top: 1px solid currentColor;
}
#cloned-root .sb-csv-related ul {
  padding-left: 1.2rem;
}
`;

export function csvPageHtml(page: CsvGeneratedPage, header: string, footer: string): string {
  const paragraphs = page.paragraphs
    .map((text) => `      <p>${escapeHtml(text)}</p>`)
    .join("\n");
  const related =
    page.links.length > 0
      ? `    <nav class="sb-csv-related">
      <h2>Related pages</h2>
      <ul>
${page.links
  .map(
    (link) =>
      `        <li><a href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a></li>`,
  )
  .join("\n")}
      </ul>
    </nav>`
      : "";
  return `${header}
<main class="sb-csv-page">
${page.kicker ? `    <p class="sb-csv-kicker">${escapeHtml(page.kicker)}</p>\n` : ""}    <h1>${escapeHtml(page.title)}</h1>
    <div class="sb-csv-body">
${paragraphs}
    </div>
${related}
</main>
${footer}`;
}

export type CsvPageRecord = {
  path: string;
  title: string;
  description: string;
  html: string;
  css: string;
};

export type CsvBuildResult = {
  mapping: ColumnMapping;
  rowCount: number;
  pages: CsvPageRecord[];
};

/**
 * Turn raw CSV text into ready-to-save page records. The header/footer of
 * `templateHtml` (the page open in the editor) wraps every generated page,
 * and the CSV page styles ride along as per-page CSS so nothing else on the
 * site needs to change.
 */
export function buildCsvPages(csvText: string, templateHtml: string): CsvBuildResult {
  if (csvText.length > MAX_CSV_BYTES) throw new Error("CSV is larger than 2 MB.");
  const rows = parseCsv(csvText);
  if (rows.length === 0) throw new Error("The CSV needs a header row and at least one data row.");
  if (rows.length > MAX_CSV_ROWS) throw new Error(`CSV has ${rows.length} rows; the limit is ${MAX_CSV_ROWS}.`);
  const mapping = autoMapColumns(Object.keys(rows[0]));
  const generated = csvGeneratedPages(rows, mapping);
  const shell = templateHtml ? extractShellFromHtml(templateHtml) : { header: "", footer: "" };
  return {
    mapping,
    rowCount: rows.length,
    pages: generated.map((page) => ({
      path: page.path,
      title: page.title,
      description: page.description,
      html: csvPageHtml(page, shell.header, shell.footer),
      css: CSV_PAGE_CSS,
    })),
  };
}
