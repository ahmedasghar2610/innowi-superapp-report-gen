// Bundles the source files this app copies into every generated clone/SEO
// zip (templates/generated/**, the shared content store/API, the
// accessibility widget, and the managed-host deployment helpers) into
// src/features/site-builder/server/generated/runtime-files.json.
//
// The JSON is imported by src/features/site-builder/server/runtime-bundle.ts,
// so webpack inlines it into the server build — reading these sources from
// disk at request time would fail on hosts that deploy only the build
// output. Runs on predev / prebuild (see package.json).
//
// Ported from site-builder-source-for-developer/scripts/bundle-runtime-files.cjs.
// Includes components/editor/** (the Studio visual editor), the same
// files used at /studio/[id] in this app, so generated zips can gate them
// behind ADMIN_PASSWORD at /admin.
const fs = require("node:fs");
const path = require("node:path");

const featureRoot = path.resolve(__dirname, "..", "src", "features", "site-builder");
const out = path.join(featureRoot, "server", "generated", "runtime-files.json");

// Keys in the JSON are always relative to `featureRoot` (e.g.
// "templates/generated/public/sb-effects.js"); runtime-bundle.ts strips the
// directory prefix when a caller asks for a whole folder.
const ENTRIES = [
  { dir: "templates/generated" },
  { file: "server/content-store.ts", as: "lib/content-store.ts" },
  { file: "server/content-api.ts", as: "lib/content-api.ts" },
  { file: "server/theme-css.ts", as: "lib/theme-css.ts" },
  { file: "server/theme-detect.ts", as: "lib/theme-detect.ts" },
  { file: "server/csv-pages.ts", as: "lib/csv-pages.ts" },
  { file: "server/csv-map.ts", as: "lib/csv-map.ts" },
  { file: "server/slug.ts", as: "lib/slug.ts" },
  { dir: "components/a11y" },
  { dir: "components/editor" },
  // Deployment helpers shared with generated sites.
  { file: "deploy/server.js", as: "server.js" },
  { file: "deploy/prepare-wasm-swc.cjs", as: "scripts/prepare-wasm-swc.cjs" },
];

function walk(dir, prefix, into) {
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    const rel = prefix ? `${prefix}/${entry}` : entry;
    if (fs.statSync(full).isDirectory()) walk(full, rel, into);
    else into[rel] = fs.readFileSync(full, "utf8");
  }
}

const files = {};
for (const e of ENTRIES) {
  if (e.dir) {
    walk(path.join(featureRoot, e.dir), e.dir, files);
  } else {
    const key = e.as || e.file;
    files[key] = fs.readFileSync(path.join(featureRoot, e.file), "utf8");
  }
}

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(files));
const kb = Math.round(fs.statSync(out).size / 1024);
console.log(`[runtime-files] bundled ${Object.keys(files).length} files (${kb} KB) -> ${path.relative(process.cwd(), out)}`);
