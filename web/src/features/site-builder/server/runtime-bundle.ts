// Access to the source files this feature ships inside generated zips
// (templates/generated/**, components/a11y/**, and a few shared lib/*.ts
// files re-exported under generated-zip-relative names).
//
// Production builds read from ./generated/runtime-files.json (created by
// scripts/bundle-runtime-files.cjs and inlined by webpack) because the keys
// there are project-relative to `src/features/site-builder/`, not to the
// Next.js app root — the bundle is what makes that indirection possible
// without reading the filesystem at request time. In `next dev` the files
// are read straight off disk when present so edits show up without rerunning
// the bundler script.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import bundled from "./generated/runtime-files.json";

const BUNDLE: Record<string, string> = bundled as Record<string, string>;
const PREFER_DISK = process.env.NODE_ENV === "development";

// All runtime-file paths (both the JSON keys and the `dir`/`file` args below)
// are relative to this feature folder, not the Next.js project root.
const FEATURE_ROOT = path.join(process.cwd(), "src", "features", "site-builder");

/** Return the contents of one bundled file (path relative to this feature folder). */
export function runtimeFile(rel: string): string {
  if (PREFER_DISK) {
    const full = path.join(FEATURE_ROOT, rel);
    if (existsSync(full)) return readFileSync(full, "utf8");
  }
  const hit = BUNDLE[rel];
  if (hit === undefined) throw new Error(`Runtime file not bundled: ${rel} (run "node scripts/bundle-runtime-files.cjs")`);
  return hit;
}

/**
 * All bundled files under `dir` (relative to this feature folder), keyed by
 * their path relative to `dir` and re-prefixed with `prefix` (e.g. "components/a11y").
 */
export function runtimeDir(dir: string, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  const key = (rel: string) => (prefix ? `${prefix}/${rel}` : rel);
  if (PREFER_DISK) {
    const full = path.join(FEATURE_ROOT, dir);
    if (existsSync(full)) {
      const walk = (d: string, rel: string) => {
        for (const entry of readdirSync(d)) {
          const p = path.join(d, entry);
          const r = rel ? `${rel}/${entry}` : entry;
          if (statSync(p).isDirectory()) walk(p, r);
          else out[key(r)] = readFileSync(p, "utf8");
        }
      };
      walk(full, "");
      return out;
    }
  }
  const base = `${dir.replace(/\/+$/, "")}/`;
  for (const [file, content] of Object.entries(BUNDLE)) {
    if (file.startsWith(base)) out[key(file.slice(base.length))] = content;
  }
  return out;
}
