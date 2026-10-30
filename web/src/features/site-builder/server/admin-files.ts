import { randomBytes } from "node:crypto";
import { runtimeDir, runtimeFile } from "@/features/site-builder/server/runtime-bundle";

function randomPassword(): string {
  return randomBytes(9).toString("base64url");
}

/**
 * Code-only files that are the same for every generated site and never edited
 * by the user: the catch-all public renderer, the password-protected /admin
 * visual editor, the effects runtime + widget styles, and the shared content
 * store copied straight from Site Builder. Re-applied on every zip download
 * so older workspaces pick up fixes.
 *
 * Sources come from the build-time bundle (runtime-bundle.ts), not from disk,
 * so this also works on hosts that deploy only the build output.
 *
 * `components/editor/*` (VisualEditor, LayersPanel, StylePanel, etc.) is the
 * same Studio editor used at /studio/[id] in this app — see the comment atop
 * VisualEditor.tsx. It's copied verbatim (its imports are all relative) and
 * consumed by `templates/generated/app/(admin)/admin/**` (dashboard at /admin,
 * login at /admin/login, editor at /admin/edit), which gates it
 * behind ADMIN_PASSWORD (see `.env.local` below and lib/admin-auth.ts).
 */
export function runtimeFiles(): Record<string, string> {
  return {
    ...runtimeDir("templates/generated"),
    "lib/content-store.ts": runtimeFile("lib/content-store.ts"),
    "lib/content-api.ts": runtimeFile("lib/content-api.ts"),
    "lib/theme-css.ts": runtimeFile("lib/theme-css.ts"),
    "lib/theme-detect.ts": runtimeFile("lib/theme-detect.ts"),
    // CSV import dependencies of content-api.
    "lib/csv-pages.ts": runtimeFile("lib/csv-pages.ts"),
    "lib/csv-map.ts": runtimeFile("lib/csv-map.ts"),
    "lib/slug.ts": runtimeFile("lib/slug.ts"),
    ...runtimeDir("components/a11y", "components/a11y"),
    ...runtimeDir("components/editor", "components/editor"),
    // Managed-host deployment helpers (entry file + WASM compiler prep).
    "server.js": runtimeFile("server.js"),
    "scripts/prepare-wasm-swc.cjs": runtimeFile("scripts/prepare-wasm-swc.cjs"),
  };
}

/** Files from earlier generator versions that must not linger in a zip. */
export const LEGACY_FILES = ["components/VisualEditor.tsx", "components/AccessibilityMenu.tsx"];

/** Runtime files plus the per-site env/gitignore boilerplate. */
export function adminFiles(): Record<string, string> {
  const password = randomPassword();
  return {
    ...runtimeFiles(),
    ".env.local": `# Password for /admin. Change it before deploying.\nADMIN_PASSWORD=${password}\n`,
    ".env.example": `ADMIN_PASSWORD=change-me\n`,
    ".gitignore": `node_modules\n.next\nout\n.env*\n!.env.example\n*.tsbuildinfo\nnext-env.d.ts\n`,
  };
}
