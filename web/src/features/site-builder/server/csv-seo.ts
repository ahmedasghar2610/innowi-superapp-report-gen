import type { ColumnMapping } from "@/features/site-builder/server/csv-map";
import { applyMapping } from "@/features/site-builder/server/csv-map";
import { rowParagraphs } from "@/features/site-builder/server/csv-pages";
import { renderSeoFiles } from "@/features/site-builder/server/seo-templates";
import { seoStarterFiles } from "@/features/site-builder/server/starter-files";
import { uniqueSlug } from "@/features/site-builder/server/slug";

export type SeoPage = {
  kind: "home" | "category" | "location" | "article";
  path: string;
  slug: string;
  title: string;
  description: string;
  kicker: string;
  lede: string;
  paragraphs: string[];
  links: { href: string; label: string }[];
};

export type SeoLocation = {
  name: string;
  slug: string;
  page: SeoPage;
};

export type SeoCategory = {
  name: string;
  slug: string;
  page: SeoPage;
  locations: SeoLocation[];
  articles: SeoPage[];
};

export type SeoModel = {
  siteName: string;
  siteUrl: string;
  homeDescription: string;
  categories: SeoCategory[];
  articles: SeoPage[];
};

function siteUrl(raw: string): string {
  const trimmed = raw.trim() || "https://example.com";
  try {
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    return url.origin;
  } catch {
    return "https://example.com";
  }
}

export function buildSeoModel(
  rowsInput: Record<string, string>[],
  mapping: ColumnMapping,
  siteName: string,
  siteUrlInput: string,
): SeoModel {
  const rows = applyMapping(rowsInput, mapping);
  if (rows.length === 0) {
    throw new Error("No usable rows after mapping. Need at least a keyword, title, or category.");
  }

  const name = siteName.trim() || "Local Pages";
  const origin = siteUrl(siteUrlInput);
  const usedCategory = new Set<string>();
  const usedLocation = new Map<string, Set<string>>();
  const usedArticle = new Set<string>();

  const categoryMap = new Map<string, SeoCategory>();

  for (const row of rows) {
    const categoryName = row.category || "Guides";
    let category = [...categoryMap.values()].find(
      (item) => item.name.toLowerCase() === categoryName.toLowerCase(),
    );
    if (!category) {
      const categorySlug = uniqueSlug(categoryName, usedCategory);
      category = {
        name: categoryName,
        slug: categorySlug,
        locations: [],
        articles: [],
        page: {
          kind: "category",
          path: `/${categorySlug}`,
          slug: categorySlug,
          title: categoryName,
          description: `${categoryName} locations and guides`,
          kicker: "Category",
          lede: `Browse ${categoryName.toLowerCase()} pages by location, then open a guide for the exact search term.`,
          paragraphs: [
            `This ${categoryName.toLowerCase()} section is generated from your spreadsheet. Each location page targets a city or area; each guide is a keyword article.`,
          ],
          links: [],
        },
      };
      categoryMap.set(categorySlug, category);
    }

    let locationPath: string | null = null;
    if (row.location) {
      let location = category.locations.find(
        (item) => item.name.toLowerCase() === row.location.toLowerCase(),
      );
      if (!location) {
        const locUsed = usedLocation.get(category.slug) ?? new Set<string>();
        usedLocation.set(category.slug, locUsed);
        const locationSlug = uniqueSlug(row.location, locUsed);
        const path = `/${category.slug}/${locationSlug}`;
        location = {
          name: row.location,
          slug: locationSlug,
          page: {
            kind: "location",
            path,
            slug: locationSlug,
            title: row.title || `${categoryName} in ${row.location}`,
            description: `Local ${categoryName.toLowerCase()} information for ${row.location}.`,
            kicker: `${categoryName} · ${row.location}`,
            lede: `A landing page for ${categoryName.toLowerCase()} in ${row.location}, built from keyword rows in your CSV.`,
            paragraphs: rowParagraphs(row),
            links: [{ href: `/${category.slug}`, label: `All ${categoryName}` }],
          },
        };
        category.locations.push(location);
      }
      locationPath = location.page.path;
    }

    const articleTitle =
      row.title ||
      [row.keyword, row.location].filter(Boolean).join(" in ") ||
      categoryName;
    const articleSlug = uniqueSlug(row.slug || articleTitle, usedArticle);
    const article: SeoPage = {
      kind: "article",
      path: `/blog/${articleSlug}`,
      slug: articleSlug,
      title: articleTitle,
      description:
        row.content?.slice(0, 155) ||
        `${articleTitle} — a short guide covering ${row.keyword || categoryName}${
          row.location ? ` in ${row.location}` : ""
        }.`,
      kicker: [row.category, row.location].filter(Boolean).join(" · ") || "Guide",
      lede: `Written around the search phrase “${row.keyword || articleTitle}”.`,
      paragraphs: rowParagraphs(row),
      links: [
        { href: `/${category.slug}`, label: categoryName },
        ...(locationPath ? [{ href: locationPath, label: row.location }] : []),
      ],
    };
    category.articles.push(article);
  }

  const categories = [...categoryMap.values()];
  for (const category of categories) {
    category.page.links = [
      ...category.locations.map((location) => ({
        href: location.page.path,
        label: location.name,
      })),
      ...category.articles.slice(0, 12).map((article) => ({
        href: article.path,
        label: article.title,
      })),
    ];
    for (const location of category.locations) {
      const related = category.articles
        .filter((article) =>
          article.kicker.toLowerCase().includes(location.name.toLowerCase()),
        )
        .slice(0, 8)
        .map((article) => ({ href: article.path, label: article.title }));
      location.page.links.push(...related);
    }
  }

  const articles = categories.flatMap((category) => category.articles);

  return {
    siteName: name,
    siteUrl: origin,
    homeDescription: `${name} publishes ${categories.length} service categories across ${
      categories.reduce((sum, category) => sum + category.locations.length, 0)
    } locations.`,
    categories,
    articles,
  };
}

export function buildSeoProject(
  rows: Record<string, string>[],
  mapping: ColumnMapping,
  siteName: string,
  siteUrlInput: string,
): Record<string, string | Buffer> {
  const model = buildSeoModel(rows, mapping, siteName, siteUrlInput);
  return {
    ...seoStarterFiles(model.siteName),
    ...renderSeoFiles(model),
  };
}
