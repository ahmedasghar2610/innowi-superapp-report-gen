import type { Metadata } from "next";
import { Providers } from "@/providers";
import "./globals.css";

export const metadata: Metadata = {
  // Default for pages that don't set their own title (each module page does).
  title: "Innowi Super App",
  description: "Innowi Marketing Operations Portal.",
};

// Applies the persisted theme before first paint (no flash of the wrong theme).
const themeScript = `
try {
  var t = localStorage.getItem('theme');
  if (t === 'dark' || (!t && window.matchMedia('(prefers-color-scheme: dark)').matches && false)) {
    document.documentElement.classList.add('dark');
  }
} catch (e) {}
`;

// A tab left open across several releases still holds the old page, whose CSS/JS files may no
// longer exist on the server (Vercel keeps old builds' files only for the Skew Protection window).
// When one of the app's own files fails to load, reload once to pick up the current build.
// The sessionStorage guard stops a reload loop if the files are genuinely unavailable.
const staleBuildScript = `
(function () {
  var KEY = 'innowi:stale-reload';
  function reloadOnce() {
    try {
      var last = Number(sessionStorage.getItem(KEY) || 0);
      if (Date.now() - last < 60000) return;
      sessionStorage.setItem(KEY, String(Date.now()));
    } catch (e) { return; }
    location.reload();
  }
  function ours(url) { return typeof url === 'string' && url.indexOf('/_next/static/') !== -1; }
  window.addEventListener('error', function (ev) {
    var t = ev.target;
    if (!t || t === window) return;
    if (t.tagName === 'SCRIPT' && ours(t.src)) reloadOnce();
  }, true);
  window.addEventListener('load', function () {
    // Files that failed before this script ran (Next puts its tags first): the browser's
    // resource log records their HTTP status where supported (Chrome, Edge, Firefox).
    try {
      var res = performance.getEntriesByType('resource');
      for (var j = 0; j < res.length; j++) {
        if (ours(res[j].name) && res[j].responseStatus >= 400) { reloadOnce(); return; }
      }
    } catch (e) {}
    var links = document.querySelectorAll('link[rel="stylesheet"]');
    for (var i = 0; i < links.length; i++) {
      if (!ours(links[i].href)) continue;
      // A stylesheet that 404'd still has a (empty) sheet object, so count its rules.
      var rules = 0;
      try { rules = links[i].sheet ? links[i].sheet.cssRules.length : 0; } catch (e) { continue; }
      if (rules === 0) { reloadOnce(); return; }
    }
  });
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Inter via stylesheet (Brand Book). Swap to next/font/google for
            self-hosting once your build has network access to Google Fonts. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <script dangerouslySetInnerHTML={{ __html: staleBuildScript }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
