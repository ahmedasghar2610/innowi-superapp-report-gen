export const SEO_FIELDS = [
  "url",
  "keyword",
  "location",
  "category",
  "title",
  "content",
  "slug",
] as const;

export type SeoField = (typeof SEO_FIELDS)[number];
export type ColumnMapping = Record<SeoField, string | null>;

const ALIASES: Record<SeoField, string[]> = {
  url: [
    "url",
    "path",
    "permalink",
    "route",
    "page url",
    "pageurl",
    "target url",
    "canonical",
    "canonical url",
    "url structure",
    "content tree",
    "tree",
    "href",
    "page path",
    "slug path",
  ],
  keyword: [
    "keyword",
    "keywords",
    "query",
    "search",
    "term",
    "phrase",
    "primary keyword",
    "target keyword",
    "focus keyword",
    "main keyword",
  ],
  location: ["location", "city", "town", "area", "place", "region", "market"],
  category: [
    "category",
    "service",
    "vertical",
    "type",
    "topic",
    "niche",
    "page type",
    "section",
    "folder",
  ],
  title: [
    "title",
    "h1",
    "headline",
    "page title",
    "pagetitle",
    "name",
    "meta title",
    "seo title",
    "title tag",
  ],
  content: [
    "content",
    "body",
    "description",
    "copy",
    "text",
    "article",
    "meta description",
    "outline",
    "notes",
    "brief",
    "page content",
  ],
  slug: ["slug"],
};

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[_/]+/g, " ").replace(/\s+/g, " ");
}

export function emptyMapping(): ColumnMapping {
  return {
    url: null,
    keyword: null,
    location: null,
    category: null,
    title: null,
    content: null,
    slug: null,
  };
}

export function autoMapColumns(headers: string[]): ColumnMapping {
  const mapping = emptyMapping();
  const used = new Set<string>();
  const normalized = headers.map((header) => ({
    original: header,
    key: normalizeHeader(header),
  }));

  for (const field of SEO_FIELDS) {
    const aliases = ALIASES[field];
    const match = normalized.find(
      (header) =>
        !used.has(header.original) &&
        aliases.some(
          (alias) =>
            header.key === alias ||
            header.key.replace(/\s/g, "") === alias.replace(/\s/g, ""),
        ),
    );
    if (match) {
      mapping[field] = match.original;
      used.add(match.original);
    }
  }
  return mapping;
}

export type SeoRow = {
  url: string;
  keyword: string;
  location: string;
  category: string;
  title: string;
  content: string;
  slug: string;
};

export function applyMapping(
  rows: Record<string, string>[],
  mapping: ColumnMapping,
): SeoRow[] {
  const read = (row: Record<string, string>, field: SeoField) => {
    const column = mapping[field];
    if (!column) return "";
    return (row[column] ?? "").toString().trim();
  };

  return rows
    .map((row) => ({
      url: read(row, "url"),
      keyword: read(row, "keyword"),
      location: read(row, "location"),
      category: read(row, "category"),
      title: read(row, "title"),
      content: read(row, "content"),
      slug: read(row, "slug"),
    }))
    .filter(
      (row) =>
        row.keyword || row.title || row.category || row.url || row.slug || row.content,
    );
}
