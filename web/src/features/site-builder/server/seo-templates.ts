import type { SeoModel, SeoPage } from "@/features/site-builder/server/csv-seo";

function hueFromName(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 33 + name.charCodeAt(i)) % 360;
  return h;
}

function jsonLd(page: SeoPage, siteName: string, siteUrl: string): string {
  const data = {
    "@context": "https://schema.org",
    "@type": page.kind === "article" ? "Article" : "WebPage",
    name: page.title,
    headline: page.title,
    description: page.description,
    url: `${siteUrl}${page.path}`,
    publisher: { "@type": "Organization", name: siteName },
  };
  return JSON.stringify(data);
}

function shellOpen(model: SeoModel): string {
  const hue = hueFromName(model.siteName);
  return `"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = ${JSON.stringify(
    model.categories.map((category) => ({
      href: `/${category.slug}`,
      label: category.name,
    })),
  )};

export function SiteHeader() {
  const pathname = usePathname();
  return (
    <header className="border-b border-[color:var(--ink)]/10 bg-[color:var(--paper)]">
      <div className="mx-auto flex max-w-5xl items-baseline justify-between gap-6 px-6 py-5">
        <Link href="/" className="font-serif text-xl tracking-tight">
          ${escapeJsx(model.siteName)}
        </Link>
        <nav className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={pathname.startsWith(item.href) ? "underline" : "opacity-80 hover:opacity-100"}
            >
              {item.label}
            </Link>
          ))}
          <Link href="/blog" className={pathname.startsWith("/blog") ? "underline" : "opacity-80 hover:opacity-100"}>
            Guides
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-[color:var(--ink)]/10">
      <div className="mx-auto flex max-w-5xl justify-between px-6 py-8 text-sm opacity-70">
        <p>© {new Date().getFullYear()} ${escapeJsx(model.siteName)}</p>
        <p>Generated programmatic pages</p>
      </div>
    </footer>
  );
}

export const themeHue = ${hue};
`;
}

function escapeJsx(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/{/g, "&#123;")
    .replace(/}/g, "&#125;")
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\$/g, "\\$");
}

function pageFile(page: SeoPage, model: SeoModel): string {
  const links = page.links
    .map(
      (link) =>
        `          <li><Link href=${JSON.stringify(link.href)}>${JSON.stringify(link.label)}</Link></li>`,
    )
    .join("\n");

  return `import Link from "next/link";
import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";

const jsonLd = ${JSON.stringify(jsonLd(page, model.siteName, model.siteUrl))};

export const metadata: Metadata = {
  title: ${JSON.stringify(`${page.title} | ${model.siteName}`)},
  description: ${JSON.stringify(page.description)},
  alternates: { canonical: ${JSON.stringify(`${model.siteUrl}${page.path}`)} },
};

export default function Page() {
  return (
    <>
      <SiteHeader />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />
      <main className="mx-auto max-w-3xl px-6 py-14">
        <p className="text-xs uppercase tracking-[0.18em] opacity-60">${escapeJsx(page.kicker)}</p>
        <h1 className="mt-3 font-serif text-4xl leading-tight tracking-tight">${escapeJsx(page.title)}</h1>
        <p className="mt-5 text-lg leading-8 opacity-80">${escapeJsx(page.lede)}</p>
        <div className="prose-body mt-10 space-y-5 text-base leading-8">
          ${page.paragraphs.map((p) => `<p>${escapeJsx(p)}</p>`).join("\n          ")}
        </div>
        ${
          page.links.length
            ? `<section className="mt-14">
          <h2 className="font-serif text-2xl">Related pages</h2>
          <ul className="mt-4 grid gap-2 text-sm underline-offset-4">
${links}
          </ul>
        </section>`
            : ""
        }
      </main>
      <SiteFooter />
    </>
  );
}
`;
}

function blogIndex(model: SeoModel): string {
  const items = model.articles
    .map(
      (article) =>
        `          <li>
            <Link href=${JSON.stringify(article.path)} className="block border-b border-[color:var(--ink)]/10 py-4">
              <p className="text-xs uppercase tracking-[0.14em] opacity-60">${escapeJsx(article.kicker)}</p>
              <h2 className="mt-1 font-serif text-2xl">${escapeJsx(article.title)}</h2>
              <p className="mt-2 opacity-75">${escapeJsx(article.lede)}</p>
            </Link>
          </li>`,
    )
    .join("\n");

  return `import Link from "next/link";
import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";

export const metadata: Metadata = {
  title: ${JSON.stringify(`Guides | ${model.siteName}`)},
  description: ${JSON.stringify(`Articles and local guides from ${model.siteName}`)},
};

export default function BlogIndex() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-6 py-14">
        <h1 className="font-serif text-4xl tracking-tight">Guides</h1>
        <ul className="mt-10">
${items}
        </ul>
      </main>
      <SiteFooter />
    </>
  );
}
`;
}

function homePage(model: SeoModel): string {
  const cards = model.categories
    .map(
      (category) => `          <Link href=${JSON.stringify(`/${category.slug}`)} className="block border border-[color:var(--ink)]/15 p-5 hover:border-[color:var(--accent)]">
            <h2 className="font-serif text-2xl">${escapeJsx(category.name)}</h2>
            <p className="mt-2 text-sm opacity-70">${category.locations.length} locations · ${category.articles.length} guides</p>
          </Link>`,
    )
    .join("\n");

  return `import Link from "next/link";
import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";

export const metadata: Metadata = {
  title: ${JSON.stringify(model.siteName)},
  description: ${JSON.stringify(model.homeDescription)},
};

export default function HomePage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-6 py-16">
        <p className="text-xs uppercase tracking-[0.2em] opacity-60">Directory</p>
        <h1 className="mt-3 max-w-2xl font-serif text-5xl leading-[1.05] tracking-tight">${escapeJsx(model.siteName)}</h1>
        <p className="mt-5 max-w-xl text-lg leading-8 opacity-80">${escapeJsx(model.homeDescription)}</p>
        <section className="mt-14 grid gap-4 sm:grid-cols-2">
${cards}
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
`;
}

export function seoLayout(model: SeoModel): string {
  const hue = hueFromName(model.siteName);
  return `import AccessibilityWidget from "@/components/a11y/AccessibilityWidget";
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(${JSON.stringify(model.siteUrl)}),
  title: {
    default: ${JSON.stringify(model.siteName)},
    template: ${JSON.stringify(`%s | ${model.siteName}`)},
  },
  description: ${JSON.stringify(model.homeDescription)},
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full" style={{ ["--accent" as string]: "hsl(${hue} 68% 40%)" }}>
      <body className="min-h-full bg-[color:var(--paper)] text-[color:var(--ink)] antialiased">
        {children}
        <AccessibilityWidget />
      </body>
    </html>
  );
}
`;
}

export function seoGlobals(): string {
  return `@import "tailwindcss";

:root {
  --paper: #f3efe6;
  --ink: #1c1915;
  --accent: #b44a1f;
  --font-display: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
  --font-body: "Segoe UI", "Source Sans 3", system-ui, sans-serif;
}

@theme inline {
  --font-sans: var(--font-body);
  --font-serif: var(--font-display);
  --color-paper: var(--paper);
  --color-ink: var(--ink);
}

html {
  background: var(--paper);
}

body {
  font-family: var(--font-body), system-ui, sans-serif;
}

.font-serif {
  font-family: var(--font-display), Georgia, serif;
}

a:hover {
  color: var(--accent);
}
`;
}

export function seoSitemap(model: SeoModel): string {
  const paths = [
    "/",
    "/blog",
    ...model.categories.map((category) => `/${category.slug}`),
    ...model.categories.flatMap((category) =>
      category.locations.map((location) => `/${category.slug}/${location.slug}`),
    ),
    ...model.articles.map((article) => article.path),
  ];
  return `import type { MetadataRoute } from "next";

const paths = ${JSON.stringify(paths)};

export default function sitemap(): MetadataRoute.Sitemap {
  const base = ${JSON.stringify(model.siteUrl.replace(/\/+$/, ""))};
  return paths.map((path) => ({
    url: path === "/" ? base : \`\${base}\${path}\`,
    lastModified: new Date(),
  }));
}
`;
}

export function seoRobots(model: SeoModel): string {
  return `import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: ${JSON.stringify(`${model.siteUrl.replace(/\/+$/, "")}/sitemap.xml`)},
  };
}
`;
}

export function renderSeoFiles(model: SeoModel): Record<string, string> {
  const files: Record<string, string> = {
    "app/layout.tsx": seoLayout(model),
    "app/globals.css": seoGlobals(),
    "app/page.tsx": homePage(model),
    "app/blog/page.tsx": blogIndex(model),
    "app/sitemap.ts": seoSitemap(model),
    "app/robots.ts": seoRobots(model),
    "components/SiteChrome.tsx": shellOpen(model),
    "app/icon.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="6" fill="#1c1915"/>
  <path d="M8 22V10h3.2c2.8 0 4.4 1.5 4.4 3.7 0 2.3-1.7 3.8-4.5 3.8H11v4.5H8zm3-6.7h.6c1.2 0 1.9-.6 1.9-1.6S12.8 12 11.6 12H11v3.3zM18.2 22V10h7.2v2.4h-4.4v2.2h4v2.3h-4v5.1h-2.8z" fill="#f3efe6"/>
</svg>
`,
  };

  for (const category of model.categories) {
    files[`app/${category.slug}/page.tsx`] = pageFile(category.page, model);
    for (const location of category.locations) {
      files[`app/${category.slug}/${location.slug}/page.tsx`] = pageFile(
        location.page,
        model,
      );
    }
  }

  for (const article of model.articles) {
    files[`app/blog/${article.slug}/page.tsx`] = pageFile(article, model);
  }

  return files;
}
