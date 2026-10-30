const FILE_EXT =
  /\.(pdf|zip|rar|7z|tar|gz|mp4|mp3|avi|mov|wmv|webm|mkv|doc|docx|xls|xlsx|ppt|pptx|csv|json|xml|rss|atom|css|js|mjs|map|woff2?|ttf|otf|eot|ico|png|jpe?g|gif|webp|svg|avif|bmp|tiff?)$/i;

export function parseHttpUrl(raw: string): URL {
  const trimmed = raw.trim();
  const withScheme = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  const url = new URL(withScheme);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http(s) URLs are supported.");
  }
  return url;
}

export function hostKey(hostname: string): string {
  return hostname.replace(/^www\./i, "").toLowerCase();
}

export function isSameHost(a: URL, b: URL): boolean {
  return hostKey(a.hostname) === hostKey(b.hostname);
}

export function normalizePageUrl(raw: string, base: URL): URL | null {
  let absolute: URL;
  try {
    absolute = new URL(raw, base);
  } catch {
    return null;
  }
  if (absolute.protocol !== "http:" && absolute.protocol !== "https:") {
    return null;
  }
  if (!isSameHost(absolute, base)) return null;
  if (absolute.pathname.startsWith("/cdn-cgi/")) return null;
  if (FILE_EXT.test(absolute.pathname)) return null;
  absolute.hash = "";
  absolute.search = "";
  if (absolute.pathname.length > 1) {
    absolute.pathname = absolute.pathname.replace(/\/+$/, "");
  }
  return absolute;
}

export function urlToAppPath(url: URL): string {
  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  return pathname;
}

export function appPathToFile(appPath: string): string {
  if (appPath === "/") return "app/page.tsx";
  const segments = appPath
    .split("/")
    .filter(Boolean)
    .map((seg) => decodeURIComponent(seg));
  return `app/${segments.join("/")}/page.tsx`;
}

export function shortHash(input: string): string {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export function assetFileName(assetUrl: string, fallbackExt: string): string {
  let pathname = "/file";
  try {
    pathname = new URL(assetUrl).pathname;
  } catch {
    /* keep fallback */
  }
  const base = pathname.split("/").filter(Boolean).pop() || `file.${fallbackExt}`;
  const safe = base.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  const hasExt = /\.[a-z0-9]{1,8}$/i.test(safe);
  const named = hasExt ? safe : `${safe}.${fallbackExt}`;
  return `${shortHash(assetUrl)}-${named}`;
}
