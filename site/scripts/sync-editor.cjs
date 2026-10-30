/* =============================================================================
 * scripts/sync-editor.cjs — copy the Site Builder visual editor into this app.
 *
 * The /<slug>/admin editor is the same one the Super App uses for cloned sites
 * (innowi-superapp-web/src/features/site-builder). Its source lives there; this
 * script copies it here so this template builds and deploys on its own:
 *
 *   components/editor/**            the editor UI
 *   lib/site-builder/*.ts           content store/API helpers it talks to
 *   public/sb-*.{css,js}            effects, widget and a11y runtime for pages
 *
 * Run after the editor changes in the Super App:   npm run sync-editor
 * Skipped silently when the Super App checkout isn't next to this one (a
 * standalone deploy) — the copies committed here are used as they are.
 * ========================================================================== */
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const source = path.resolve(
  process.env.SITE_BUILDER_SRC || path.join(root, "..", "innowi-superapp-web", "src", "features", "site-builder"),
);

if (!fs.existsSync(source)) {
  console.log(`[sync-editor] ${source} not found — keeping the committed copies.`);
  process.exit(0);
}

const HEADER = (from) =>
  `// COPIED from innowi-superapp-web/src/features/site-builder/${from} by scripts/sync-editor.cjs.\n// Edit it there, then run \`npm run sync-editor\`.\n`;

function copy(from, to, { header = true } = {}) {
  const src = path.join(source, from);
  const dest = path.join(root, to);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  let text = fs.readFileSync(src, "utf8");
  if (header && /\.(tsx?|js)$/.test(from)) {
    // Keep "use client" as the very first statement.
    const m = text.match(/^\s*(["']use client["'];?\s*\n)/);
    text = m ? m[1] + HEADER(from) + text.slice(m[0].length) : HEADER(from) + text;
  }
  fs.writeFileSync(dest, text);
}

function copyDir(from, to) {
  for (const entry of fs.readdirSync(path.join(source, from))) {
    const rel = path.join(from, entry);
    if (fs.statSync(path.join(source, rel)).isDirectory()) copyDir(rel, path.join(to, entry));
    else copy(rel, path.join(to, entry));
  }
}

copyDir("components/editor", "components/editor");
for (const f of ["content-store", "content-api", "theme-css", "theme-detect", "csv-pages", "csv-map", "slug"]) {
  copy(`server/${f}.ts`, `lib/site-builder/${f}.ts`);
}
for (const f of ["sb-effects.js", "sb-effects.css", "sb-widgets.css", "sb-a11y.css"]) {
  copy(`templates/generated/public/${f}`, `public/${f}`, { header: false });
}
console.log("[sync-editor] editor copied from", source);
