import { a11yFiles } from "@/features/site-builder/server/a11y-files";
import { adminFiles } from "@/features/site-builder/server/admin-files";
import type { PageChrome } from "@/features/site-builder/server/clone-chrome";

// Plain CSS on purpose: no Tailwind/PostCSS/LightningCSS in generated sites.
// The cloned stylesheet is public/cloned.css and is never compiled, and the
// native LightningCSS binary does not load on old-glibc hosts (Hostinger).
const TINY_RESET = `html,
body {
  margin: 0;
}

#cloned-root {
  min-height: 100%;
}
`;

export function cloneStarterFiles(
  chrome: PageChrome,
  startUrl: string,
  hasRealFavicon = false,
): Record<string, string> {
  const fontLinks = chrome.fontHrefs
    .map((href) => `        <link rel="stylesheet" href=${JSON.stringify(href)} />`)
    .join("\n");

  // Root layout for the public site only. /admin lives in its own root layout
  // (app/(admin)/layout.tsx) so it never inherits the cloned CSS.
  const layout = `import AccessibilityWidget from "@/components/a11y/AccessibilityWidget";
import EffectsRuntime from "@/components/EffectsRuntime";
import type { Metadata } from "next";
import { store } from "@/lib/site-store";
import { serializeThemeCss } from "@/lib/theme-css";
import "../globals.css";

export const metadata: Metadata = {
  title: ${JSON.stringify(chrome.title || "Cloned site")},
  description: ${JSON.stringify(`Local replica of ${startUrl}`)},
};

export default async function SiteLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const site = await store.site();
  const themeCss = serializeThemeCss(site.theme);
  return (
    <html suppressHydrationWarning lang={site.lang || ${JSON.stringify(chrome.lang || "en")}} className={${JSON.stringify(chrome.htmlClass)}} ${
      chrome.dataTheme
        ? `data-theme={${JSON.stringify(chrome.dataTheme)}}`
        : ""
    }>
      <head>
${fontLinks}
        {site.faviconPath ? <link rel="icon" href={site.faviconPath} /> : null}
        <link rel="stylesheet" href="/cloned.css" />
        <link rel="stylesheet" href="/sb-effects.css" />
        <link rel="stylesheet" href="/sb-widgets.css" />
        <link rel="stylesheet" href="/sb-a11y.css" />
        {themeCss ? <style id="sb-theme-css" dangerouslySetInnerHTML={{ __html: themeCss }} /> : null}
      </head>
      <body className={${JSON.stringify(chrome.bodyClass)}}>
        {/* WCAG 2.4.1 bypass block: first focusable element on every page. */}
        <a className="sb-skip" href="#cloned-root">
          Skip to content
        </a>
        {children}
        <EffectsRuntime />
        <AccessibilityWidget statementHref="/accessibility" />
      </body>
    </html>
  );
}
`;

  return {
    ...a11yFiles(),
    ...adminFiles(),
    "app/globals.css": TINY_RESET,
    "app/(site)/layout.tsx": layout,
    // Only ship the generic Site Builder icon when the source site's own
    // favicon couldn't be downloaded (clone-chrome.ts / html-to-next.ts) —
    // Next's file-convention icon (app/icon.<ext> / app/favicon.ico,
    // written alongside these files when a real one exists) would otherwise
    // compete with this for the browser tab, and there's no reliable way to
    // predict which one wins.
    ...(hasRealFavicon ? {} : { "app/icon.svg": cloneIconSvg() }),
    // Same deployment setup as Site Builder itself so the zip builds on
    // managed hosts with an old glibc: plain JS config, webpack build, the
    // WebAssembly SWC compiler pre-installed, and server.js as entry file.
    "package.json": JSON.stringify(
      {
        name: "cloned-site",
        version: "0.1.0",
        private: true,
        scripts: {
          dev: "next dev",
          build: "next build --webpack",
          start: "next start",
          "start:server": "node server.js",
          postinstall: "node scripts/prepare-wasm-swc.cjs",
        },
        engines: { node: ">=20" },
        dependencies: {
          "@next/swc-wasm-nodejs": "16.3.5",
          next: "16.3.5",
          // Used at runtime by lib/theme-detect.ts (the /admin Theme
          // panel's "Detect from site" button parses public/cloned.css).
          postcss: "8.4.49",
          react: "19.2.8",
          "react-dom": "19.2.8",
        },
        devDependencies: {
          "@types/node": "^20",
          "@types/react": "^19",
          "@types/react-dom": "^19",
          typescript: "^5",
        },
      },
      null,
      2,
    ),
    "tsconfig.json": JSON.stringify(
      {
        compilerOptions: {
          target: "ES2017",
          lib: ["dom", "dom.iterable", "esnext"],
          allowJs: true,
          skipLibCheck: true,
          strict: true,
          noEmit: true,
          esModuleInterop: true,
          module: "esnext",
          moduleResolution: "bundler",
          resolveJsonModule: true,
          isolatedModules: true,
          jsx: "react-jsx",
          incremental: true,
          plugins: [{ name: "next" }],
          paths: { "@/*": ["./*"] },
        },
        include: ["next-env.d.ts", "**/*.ts", "**/*.tsx"],
        exclude: ["node_modules"],
      },
      null,
      2,
    ),
    "next.config.mjs": `/** @type {import('next').NextConfig} */
const nextConfig = {};

export default nextConfig;
`,
    "next-env.d.ts": `/// <reference types="next" />
/// <reference types="next/image-types/global" />

export {};
`,
    "README.md": `# Cloned site

Next.js replica generated by Site Builder. Cloned CSS lives in \`public/cloned.css\` (never compiled).

\`\`\`bash
npm install
npm run dev
\`\`\`

## Content

Every public page is a key in \`content/pages.json\` (\`{ "pages": { "/": { title, description, html, css } } }\`).
\`app/(site)/[[...slug]]/page.tsx\` renders whichever key matches the URL, so adding a key adds a page — no new route files needed.
A snapshot of the content is also compiled into the build (\`lib/site-store.ts\`), so the site works on hosts that keep only the build output.

## Admin

Open \`/admin\` to edit pages visually. The password is \`ADMIN_PASSWORD\` — a random one is in \`.env.local\`; on a host, set it as an environment variable instead. Uploaded images land in \`public/assets/uploads/\`.

## Deploy

- **Vercel / Netlify**: import the project, no settings needed. The filesystem there is read-only, so \`/admin\` edits will not persist — edit in Site Builder and redeploy instead.
- **Hostinger Web App / other managed Node hosts**: upload this folder as a zip (without \`node_modules\`), framework Next.js, Node 20 or 22, build command \`npm run build\`, output directory \`.next\`, entry file \`server.js\`. Add environment variable \`ADMIN_PASSWORD\`. Edits made in \`/admin\` persist until the next redeploy.
- **Docker / VPS**: \`npm ci && npm run build && npm start\`.
`,
  };
}

export function seoStarterFiles(siteName: string): Record<string, string> {
  return {
    ...a11yFiles(),
    "package.json": JSON.stringify(
      {
        name: "seo-site",
        version: "0.1.0",
        private: true,
        scripts: {
          dev: "next dev --turbopack",
          build: "next build",
          start: "next start",
        },
        dependencies: {
          next: "16.3.5",
          react: "19.2.8",
          "react-dom": "19.2.8",
        },
        devDependencies: {
          "@tailwindcss/postcss": "^4",
          "@types/node": "^20",
          "@types/react": "^19",
          "@types/react-dom": "^19",
          tailwindcss: "^4",
          typescript: "^5",
        },
      },
      null,
      2,
    ),
    "tsconfig.json": JSON.stringify(
      {
        compilerOptions: {
          target: "ES2017",
          lib: ["dom", "dom.iterable", "esnext"],
          allowJs: true,
          skipLibCheck: true,
          strict: true,
          noEmit: true,
          esModuleInterop: true,
          module: "esnext",
          moduleResolution: "bundler",
          isolatedModules: true,
          jsx: "react-jsx",
          incremental: true,
          plugins: [{ name: "next" }],
          paths: { "@/*": ["./*"] },
        },
        include: ["next-env.d.ts", "**/*.ts", "**/*.tsx"],
        exclude: ["node_modules"],
      },
      null,
      2,
    ),
    "next.config.ts": `import type { NextConfig } from "next";

const nextConfig: NextConfig = {};

export default nextConfig;
`,
    "postcss.config.mjs": `const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
`,
    "next-env.d.ts": `/// <reference types="next" />
/// <reference types="next/image-types/global" />

export {};
`,
    "README.md": `# ${siteName}

Programmatic SEO site generated by Site Builder.

\`\`\`bash
npm install
npm run dev
\`\`\`
`,
  };
}

function cloneIconSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none">
  <rect width="32" height="32" rx="6" fill="#1a1612"/>
  <rect x="7" y="9" width="14" height="16" rx="1.5" stroke="#f4efe4" stroke-width="1.6"/>
  <rect x="11" y="6" width="14" height="16" rx="1.5" fill="#c45c26"/>
</svg>
`;
}
