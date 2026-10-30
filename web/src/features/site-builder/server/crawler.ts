// src/features/site-builder/server — the "Clone a Website" engine, ported
// verbatim (module-for-module) from the standalone site-builder-source-for-developer
// project into this app's feature-based layout. It is server-only Node code
// (node:fs, Playwright, JSZip, cheerio) so it lives under server/, not
// alongside client components — src/app/api/clone, src/app/api/seo and
// src/app/api/clone/download are the only entry points into it.
//
// Pipeline: crawler.ts (crawl) -> html-to-next.ts + effects-extract.ts +
// a11y-fixes.ts (convert to Next.js, apply accessibility fixes) ->
// csv-*.ts / seo-*.ts (optional CSV/SEO page generation) -> workspaces.ts
// (persist to .workspaces/<id>/, 24h TTL) -> clone-jobs.ts + project-zip.ts
// (zip on download).
//
// Scope note: the Studio visual editor (site-builder's components/editor/*
// and app/studio/[id]/**) was intentionally left out of this port per an
// explicit scope narrowing — it's a separate follow-up. Where the ported
// pipeline produces a `studioPath` field (see clone-progress.ts), it is
// carried through as inert data only; no /studio route exists yet.
//
// crawler.ts — Playwright/Chromium loads a URL, crawls every same-domain
// page (see urls.ts for the same-host/file-extension rules), and waits for
// each page to finish loading (lazy images, sliders, hydration) before
// snapshotting its DOM.

import * as cheerio from "cheerio";
import type { Browser, Page } from "playwright";
import { extractChrome, type PageChrome } from "@/features/site-builder/server/clone-chrome";
import type { CloneProgress } from "@/features/site-builder/server/clone-progress";
import { crawlPercent } from "@/features/site-builder/server/clone-progress";
import { explainConnectError, readRemoteEndpoint } from "@/features/site-builder/server/remote-browser";
import {
  isSameHost,
  normalizePageUrl,
  parseHttpUrl,
  urlToAppPath,
} from "@/features/site-builder/server/urls";

export type CrawledPage = {
  url: string;
  path: string;
  html: string;
  chrome: PageChrome;
  imageUrls: string[];
  stylesheetUrls: string[];
};

export type CrawledSite = {
  origin: string;
  startUrl: string;
  pages: CrawledPage[];
};

const SKIP_HREF = /^(mailto:|tel:|javascript:|data:|#)/i;

async function launchBrowser(): Promise<Browser> {
  const { chromium } = await import("playwright");
  // Managed hosts (Hostinger web hosting, Railway without Docker, …) cannot
  // run Chromium. Point PLAYWRIGHT_WS_ENDPOINT at a remote browser instead.
  // Two URL styles are accepted:
  //   CDP (Browserless default, works on every plan):
  //     wss://production-sfo.browserless.io?token=…
  //   Playwright-native server (path contains /playwright):
  //     wss://production-sfo.browserless.io/chromium/playwright?token=…
  const remote = readRemoteEndpoint();
  if (remote) {
    try {
      return remote.mode === "playwright"
        ? await chromium.connect(remote.url, { timeout: 60_000 })
        : await chromium.connectOverCDP(remote.url, { timeout: 60_000 });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Could not connect to the remote browser at PLAYWRIGHT_WS_ENDPOINT (${reason}).${explainConnectError(remote, reason)}`);
    }
  }
  const attempts: Array<Parameters<typeof chromium.launch>[0]> = [
    { headless: true, channel: "chrome" },
    { headless: true, channel: "msedge" },
    { headless: true },
  ];
  let lastError: unknown;
  for (const options of attempts) {
    try {
      return await chromium.launch(options);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Could not launch Chromium, Chrome, or Edge.");
}

async function waitForDocumentLoad(page: Page): Promise<void> {
  await page.waitForLoadState("load").catch(() => undefined);
  await page
    .waitForFunction(() => document.readyState === "complete", null, { timeout: 30000 })
    .catch(() => undefined);
  await page.evaluate(() => document.fonts.ready).catch(() => undefined);
}

/**
 * Wait until client-side JS has stopped changing the DOM (sliders, galleries,
 * hydration, lazy sections). Resolves when the DOM size is unchanged across
 * three consecutive checks, or after `maxMs`.
 */
async function waitForDomStable(page: Page, maxMs = 10000): Promise<void> {
  await page
    .evaluate(async (limit) => {
      const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
      const size = () =>
        `${document.body?.innerHTML.length ?? 0}:${document.images.length}:${document.querySelectorAll("*").length}`;
      const started = Date.now();
      let last = size();
      let stable = 0;
      while (Date.now() - started < limit) {
        await delay(500);
        const now = size();
        if (now === last) {
          stable += 1;
          if (stable >= 3) return;
        } else {
          stable = 0;
          last = now;
        }
      }
    }, maxMs)
    .catch(() => undefined);
}

async function promoteLazyMedia(page: Page): Promise<void> {
  await page.evaluate(() => {
    const copyAttr = (from: string, to: string) => {
      document.querySelectorAll(`[${from}]`).forEach((el) => {
        const value = el.getAttribute(from);
        if (value && !el.getAttribute(to)) el.setAttribute(to, value);
      });
    };
    copyAttr("data-src", "src");
    copyAttr("data-lazy-src", "src");
    copyAttr("data-original", "src");
    copyAttr("data-lazy", "src");
    copyAttr("data-srcset", "srcset");
    copyAttr("data-lazy-srcset", "srcset");
    copyAttr("data-full", "src");
    copyAttr("data-large_image", "src");
    copyAttr("data-large-image", "src");

    document.querySelectorAll("img[loading='lazy']").forEach((el) => {
      (el as HTMLImageElement).loading = "eager";
    });

    const setBg = (el: Element, raw: string | null) => {
      if (!raw || !(el instanceof HTMLElement)) return;
      if (!el.style.backgroundImage || el.style.backgroundImage === "none") {
        el.style.backgroundImage = `url("${raw}")`;
      }
    };
    document.querySelectorAll("[data-bg]").forEach((el) => setBg(el, el.getAttribute("data-bg")));
    document.querySelectorAll("[data-background]").forEach((el) =>
      setBg(el, el.getAttribute("data-background")),
    );
    document.querySelectorAll("[data-thumbnail]").forEach((el) =>
      setBg(el, el.getAttribute("data-thumbnail")),
    );
    document.querySelectorAll("[data-src]").forEach((el) => {
      if (el.tagName !== "IMG") setBg(el, el.getAttribute("data-src"));
    });
  });
}

async function scrollAndWaitForMedia(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const waitVisibleImages = async () => {
      const imgs = [...document.images].filter((img) => {
        const rect = img.getBoundingClientRect();
        return rect.bottom > -80 && rect.top < window.innerHeight + 240;
      });
      await Promise.all(
        imgs.map((img) => {
          if (img.complete && img.naturalWidth > 0) return Promise.resolve();
          return Promise.race([
            new Promise<void>((resolve) => {
              img.addEventListener("load", () => resolve(), { once: true });
              img.addEventListener("error", () => resolve(), { once: true });
            }),
            delay(5000),
          ]);
        }),
      );
    };

    let y = 0;
    let lastHeight = 0;
    for (let step = 0; step < 48; step++) {
      window.scrollTo(0, y);
      await delay(320);
      await waitVisibleImages();
      const height = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
      if (y >= Math.min(height, 28000) && height === lastHeight) break;
      lastHeight = height;
      y += Math.max(480, Math.floor(window.innerHeight * 0.7));
    }
    window.scrollTo(0, 0);
    await delay(400);
  });
}

async function revealGalleries(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const nodes = [
      ...document.querySelectorAll(
        "img, [data-src], [data-bg], [data-thumbnail], .e-gallery-item, .elementor-gallery-item, .wp-block-gallery img, .gallery img",
      ),
    ].slice(0, 160);
    for (const el of nodes) {
      el.scrollIntoView({ block: "center", inline: "nearest" });
      await delay(70);
    }
    window.scrollTo(0, 0);
  });
}

async function waitForImages(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const imgs = [...document.images];
    await Promise.all(
      imgs.map((img) => {
        if (img.complete) return Promise.resolve();
        return Promise.race([
          new Promise<void>((resolve) => {
            img.addEventListener("load", () => resolve(), { once: true });
            img.addEventListener("error", () => resolve(), { once: true });
          }),
          delay(8000),
        ]);
      }),
    );
    await Promise.all(
      imgs.slice(0, 80).map((img) =>
        img.decode ? img.decode().catch(() => undefined) : Promise.resolve(),
      ),
    );
  });
}

/** Playwright throws this when the page navigates (redirect, reload) mid-script. */
function isNavigationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Execution context was destroyed|Target closed|frame was detached|Navigation|navigating/i.test(
    message,
  );
}

async function waitForCompletePage(
  page: Page,
  onProgress: (event: CloneProgress) => void,
  url: string,
  loaded: number,
  queued: number,
): Promise<void> {
  const percent = crawlPercent(loaded, queued);
  const total = loaded + queued;
  const step = (message: string) =>
    onProgress({ phase: "load", percent, message, current: loaded, total });

  const sequence = async () => {
    step(`Page ${loaded + 1} of ${total} — waiting for document, fonts and scripts: ${page.url() || url}`);
    await waitForDocumentLoad(page);
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => undefined);
    await waitForDomStable(page, 6000);
    await promoteLazyMedia(page);

    step(`Page ${loaded + 1} of ${total} — scrolling to load lazy images and galleries`);
    await scrollAndWaitForMedia(page);
    await promoteLazyMedia(page);
    await revealGalleries(page);
    await promoteLazyMedia(page);

    step(`Page ${loaded + 1} of ${total} — waiting for every image to finish`);
    await waitForImages(page);
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => undefined);
    await waitForDomStable(page, 10000);
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 1200)));
  };

  // Some sites redirect or reload themselves after the first load (consent
  // scripts, locale redirects, www/non-www, SPA routers). If that happens
  // mid-sequence, wait for the new document and start the sequence over.
  for (let attempt = 1; ; attempt++) {
    try {
      await sequence();
      return;
    } catch (error) {
      if (!isNavigationError(error) || attempt >= 4) throw error;
      step(
        `Page ${loaded + 1} of ${total} — site navigated to ${page.url()} while loading; waiting for the new page (retry ${attempt})`,
      );
      await page.waitForLoadState("load", { timeout: 60000 }).catch(() => undefined);
      await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 800))).catch(() => undefined);
    }
  }
}

async function collectComputedBackgrounds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const urls = new Set<string>();
    const root = document.body;
    if (!root) return [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let node = walker.currentNode as Element | null;
    let inspected = 0;
    while (node && inspected < 4000) {
      const bg = getComputedStyle(node).backgroundImage;
      const matches = bg.matchAll(/url\((['"]?)([^'")]+)\1\)/g);
      for (const match of matches) {
        if (match[2] && !match[2].startsWith("data:")) urls.add(match[2]);
      }
      inspected += 1;
      node = walker.nextNode() as Element | null;
    }
    return [...urls];
  });
}

function collectFromHtml(html: string, pageUrl: string) {
  const $ = cheerio.load(html);
  const imageUrls = new Set<string>();
  const stylesheetUrls = new Set<string>();
  const links: string[] = [];

  const abs = (value: string | undefined) => {
    if (!value) return null;
    try {
      return new URL(value, pageUrl).href;
    } catch {
      return null;
    }
  };

  $("img").each((_, el) => {
    const src = abs($(el).attr("src"));
    if (src) imageUrls.add(src);
    for (const attr of [
      "data-src",
      "data-lazy-src",
      "data-original",
      "data-full",
      "data-large_image",
      "data-thumbnail",
    ]) {
      const extra = abs($(el).attr(attr));
      if (extra) imageUrls.add(extra);
    }
    const srcset = $(el).attr("srcset") || $(el).attr("data-srcset") || "";
    for (const part of srcset.split(",")) {
      const candidate = abs(part.trim().split(/\s+/)[0]);
      if (candidate) imageUrls.add(candidate);
    }
  });

  $("[data-thumbnail], [data-bg], [data-background], [data-src]").each((_, el) => {
    for (const attr of ["data-thumbnail", "data-bg", "data-background", "data-src"]) {
      const extra = abs($(el).attr(attr));
      if (extra && !extra.startsWith("data:")) imageUrls.add(extra);
    }
  });

  $("source, [srcset]").each((_, el) => {
    const srcset = $(el).attr("srcset") || "";
    for (const part of srcset.split(",")) {
      const candidate = abs(part.trim().split(/\s+/)[0]);
      if (candidate) imageUrls.add(candidate);
    }
  });

  $("link[rel]").each((_, el) => {
    const rel = ($(el).attr("rel") || "").toLowerCase();
    if (!rel.includes("stylesheet")) return;
    const href = abs($(el).attr("href"));
    if (href) stylesheetUrls.add(href);
  });

  $("style").each((_, el) => {
    const css = $(el).html() || "";
    for (const match of css.matchAll(/url\((['"]?)([^'")]+)\1\)/g)) {
      const href = abs(match[2]);
      if (href && !href.startsWith("data:")) imageUrls.add(href);
    }
  });

  $("a[href]").each((_, el) => {
    const href = ($(el).attr("href") || "").trim();
    if (!href || SKIP_HREF.test(href)) return;
    links.push(href);
  });

  return { imageUrls: [...imageUrls], stylesheetUrls: [...stylesheetUrls], links };
}

function toCrawledPage(
  pageUrl: string,
  html: string,
  extraImages: string[] = [],
): CrawledPage {
  const parsed = new URL(pageUrl);
  const collected = collectFromHtml(html, pageUrl);
  return {
    url: pageUrl,
    path: urlToAppPath(parsed),
    html,
    chrome: extractChrome(html, pageUrl),
    imageUrls: [...new Set([...collected.imageUrls, ...extraImages])],
    stylesheetUrls: collected.stylesheetUrls,
  };
}

async function crawlWithPlaywright(
  start: URL,
  onProgress: (event: CloneProgress) => void,
  onBrowserReady: () => void,
): Promise<CrawledSite> {
  const browser = await launchBrowser();
  onBrowserReady();
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 1600 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();
  const queue: string[] = [start.href];
  const queued = new Set(queue);
  const pages: CrawledPage[] = [];
  let lastError: string | null = null;

  try {
    // Stage 1: load every same-host page completely in the browser. Nothing is
    // converted or downloaded until this loop has finished for the whole site.
    while (queue.length > 0) {
      const current = queue.shift()!;
      const total = pages.length + queue.length + 1;

      try {
        onProgress({
          phase: "load",
          percent: crawlPercent(pages.length, queue.length + 1),
          message: `Page ${pages.length + 1} of ${total} — opening ${current}`,
          current: pages.length,
          total,
        });
        await page.goto(current, { waitUntil: "load", timeout: 90000 }).catch(async () => {
          await page.goto(current, { waitUntil: "domcontentloaded", timeout: 60000 });
        });
        await waitForCompletePage(page, onProgress, current, pages.length, queue.length + 1);
        onProgress({
          phase: "load",
          percent: crawlPercent(pages.length, queue.length + 1),
          message: `Page ${pages.length + 1} of ${total} fully loaded — snapshotting DOM`,
          current: pages.length,
          total,
        });
        const backgrounds = await collectComputedBackgrounds(page).catch(() => []);
        const html = await page.content();
        const crawled = toCrawledPage(page.url() || current, html, backgrounds);
        pages.push(crawled);

        const base = new URL(crawled.url);
        const collected = collectFromHtml(html, crawled.url);
        for (const href of collected.links) {
          const next = normalizePageUrl(href, base);
          if (!next || queued.has(next.href)) continue;
          if (!isSameHost(next, start)) continue;
          queued.add(next.href);
          queue.push(next.href);
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message.split("\n")[0] : String(error);
        lastError = reason;
        onProgress({
          phase: "load",
          percent: crawlPercent(pages.length, queue.length),
          message: `Skipped ${current} — ${reason}`,
          current: pages.length,
          total: pages.length + queue.length,
        });
      }
    }
  } finally {
    await browser.close().catch(() => undefined);
  }

  if (pages.length === 0) {
    throw new Error(
      `No pages finished loading${lastError ? ` — last error: ${lastError}` : ""}.`,
    );
  }

  onProgress({
    phase: "crawl",
    percent: 72,
    message: `Website fully loaded: ${pages.length} pages. Starting clone…`,
    current: pages.length,
    total: pages.length,
  });

  return { origin: start.origin, startUrl: start.href, pages };
}

export async function crawlSite(
  rawUrl: string,
  onProgress: (event: CloneProgress) => void,
): Promise<CrawledSite> {
  const start = parseHttpUrl(rawUrl);
  onProgress({
    phase: "launch",
    percent: 3,
    message: "Launching browser to load the complete website…",
  });

  // Only a real browser can wait for a complete load (scripts, fonts, lazy
  // images, galleries). There is deliberately no plain-fetch fallback: that
  // would capture a partially loaded page.
  let browserOk = false;
  try {
    const site = await crawlWithPlaywright(start, onProgress, () => {
      browserOk = true;
    });
    return site;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (!browserOk) {
      const hint = process.env.PLAYWRIGHT_WS_ENDPOINT
        ? "Check the PLAYWRIGHT_WS_ENDPOINT URL / token."
        : 'Install one with "npx playwright install chromium", or set PLAYWRIGHT_WS_ENDPOINT to a remote browser.';
      throw new Error(`Could not launch a browser (${reason}). ${hint}`);
    }
    throw new Error(`${reason} Nothing was cloned.`);
  }
}
