import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound, permanentRedirect } from "next/navigation";
import { isPublished, normalizePath, type PageRecord, type SiteFile } from "@/lib/content-store";
import { ADMIN_SESSION_COOKIE, isValidSession } from "@/lib/admin-auth";
import { store } from "@/lib/site-store";

export const dynamic = "force-dynamic";

type Params = Promise<{ slug?: string[] }>;

function pathFromSlug(slug: string[] | undefined): string {
  return normalizePath(`/${(slug ?? []).map(decodeURIComponent).join("/")}`);
}

function publicBase(site: SiteFile): string {
  return (site.canonicalOrigin || site.origin || "").replace(/\/+$/, "");
}

async function isAdmin(): Promise<boolean> {
  try {
    const jar = await cookies();
    return isValidSession(jar.get(ADMIN_SESSION_COOKIE)?.value);
  } catch {
    return false;
  }
}

/** Page for a path, following site redirects; null when missing or not yet published (admins still see it). */
async function resolve(path: string): Promise<{ page: PageRecord; preview: boolean } | null> {
  const site = await store.site();
  const redirect = site.redirects?.find((r) => r.from === path);
  if (redirect && redirect.to !== path) permanentRedirect(redirect.to);
  const page = await store.get(path);
  if (!page) return null;
  if (isPublished(page)) return { page, preview: false };
  return (await isAdmin()) ? { page, preview: true } : null;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const path = pathFromSlug(slug);
  const found = await resolve(path);
  if (!found) return {};
  const { page, preview } = found;
  const site = await store.site();
  const seo = page.seo || {};
  const robots = preview ? "noindex, nofollow" : seo.robots;
  return {
    title: page.title,
    description: page.description || undefined,
    ...(seo.keywords ? { keywords: seo.keywords } : {}),
    ...(robots ? { robots } : {}),
    alternates: { canonical: seo.canonical || `${publicBase(site)}${path === "/" ? "/" : path}` },
  };
}

/**
 * Links to pages that aren't published yet (pSEO drip / held pages) are
 * hidden for visitors so the live site never links to a 404.
 */
async function hiddenLinks(html: string): Promise<{ html: string; css: string }> {
  if (!html.includes("data-pseo-path") && !html.includes('href="/')) return { html, css: "" };
  const pages = await store.list();
  const off = pages.filter((p) => !isPublished(p)).map((p) => p.path);
  if (!off.length) return { html, css: "" };
  const offSet = new Set(off);
  // Drop whole pSEO link sections whose every link is unpublished.
  const pruned = html.replace(/<section class="sb-pseo[^"]*"[^>]*>[\s\S]*?<\/section>/g, (block) => {
    const paths = [...block.matchAll(/data-pseo-path="([^"]+)"/g)].map((m) => m[1]);
    return paths.length && paths.every((p) => offSet.has(p)) ? "" : block;
  });
  const out = pruned.replace(/\shref="(\/[^"#?]*)"/g, (m, href: string) =>
    offSet.has(normalizePath(href)) ? ` data-pseo-off="${href}"` : m,
  );
  const css = off
    .filter((p) => html.includes(`data-pseo-path="${p}"`))
    .map((p) => `[data-pseo-path="${p.replace(/"/g, '\\"')}"]`)
    .join(",");
  return { html: out, css: css ? `${css}{display:none!important}` : "" };
}

export default async function Page({ params }: { params: Params }) {
  const { slug } = await params;
  const found = await resolve(pathFromSlug(slug));
  if (!found) notFound();
  const { page, preview } = found;
  const { html, css: hideCss } = preview ? { html: page.html, css: "" } : await hiddenLinks(page.html);
  const jsonLd = (page.jsonLd || []).map((obj) => JSON.stringify(obj).replace(/</g, "\\u003c"));
  return (
    <>
      {page.css ? (
        // suppressHydrationWarning: the /admin editor rewrites this stylesheet
        // and the page markup in its preview iframe, sometimes before React
        // has hydrated there — expected, not a bug.
        <style id="sb-page-css" suppressHydrationWarning dangerouslySetInnerHTML={{ __html: page.css.replace(/<\/style/gi, "<\\/style") }} />
      ) : null}
      {hideCss ? <style dangerouslySetInnerHTML={{ __html: hideCss }} /> : null}
      {jsonLd.map((json, i) => (
        <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />
      ))}
      {preview ? (
        <div role="status" style={{ position: "sticky", top: 0, zIndex: 2147483000, background: "#111", color: "#fff", font: "600 13px/1.4 system-ui, sans-serif", padding: "8px 14px", textAlign: "center" }}>
          Admin preview — this page is {page.publish?.status === "scheduled" ? `scheduled for ${page.publish.at}` : "on hold"} and not visible to visitors.
        </div>
      ) : null}
      {/* tabIndex -1 makes the skip link target focusable (WCAG 2.4.1). */}
      <div id="cloned-root" tabIndex={-1} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: html }} />
    </>
  );
}
