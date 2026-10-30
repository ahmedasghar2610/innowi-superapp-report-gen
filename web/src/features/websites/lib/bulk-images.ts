/**
 * "Upload all images" for the .docx import: match a set of image files to the
 * website's image slots by file name (or by the image generator's
 * manifest.json), and read brand.json.
 *
 * File names written by the Website Images workflow (Super_app\Website Images):
 *   logo.png · hero.jpg · about.jpg · dish-01-<name>.jpg … · point-01-<title>.png …
 * Numbers follow the .docx order (dish-01 = card 1). Pure functions only, so the
 * matching can be tested without the UI.
 */

export type SlotKey = string; // "logo" | "hero" | "about" | "dish-1" … | "point-1" …

export interface Slot {
  key: SlotKey;
  /** Shown in the picker, e.g. "Dish 3 — Bac & Eggs". */
  label: string;
  /** Answer path the uploaded URL is written to. */
  path: string;
  /** Answer path for the alt text, when the slot has one. */
  altPath?: string;
}

export interface BrandValues {
  primary?: string;
  secondary?: string;
  accent?: string;
  textColor?: string;
  headingFont?: string;
  bodyFont?: string;
}

/** What manifest.json says about one file: slot key + alt text. */
export interface ManifestEntry {
  slot: SlotKey;
  alt?: string;
}

export const BRAND_KEYS = ["primary", "secondary", "accent", "textColor", "headingFont", "bodyFont"] as const;
// The hosted app runs on Vercel, which refuses request bodies over 4.5 MB, so the
// API caps uploads at 4 MB there (API: SERVERLESS_UPLOAD_LIMIT_MB).
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|svg|avif)$/i;

export const isImageFile = (name: string) => IMAGE_EXT.test(name);
const baseName = (name: string) => name.split(/[\\/]/).pop() ?? name;
const stem = (name: string) => baseName(name).toLowerCase().replace(/\.[a-z0-9]+$/i, "");
const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** Every image slot of the template for these dishes and selling points. */
export function buildSlots(dishNames: string[], pointTitles: string[]): Slot[] {
  return [
    { key: "logo", label: "Logo", path: "brand.logo" },
    { key: "hero", label: "Hero image", path: "hero.image", altPath: "hero.imageAlt" },
    { key: "about", label: "About image", path: "about.image", altPath: "about.imageAlt" },
    ...dishNames.map((name, i) => ({
      key: `dish-${i + 1}`,
      label: `Dish ${i + 1}${name ? ` — ${name}` : ""}`,
      path: `offerings.items.${i}.image`,
    })),
    ...pointTitles.map((title, i) => ({
      key: `point-${i + 1}`,
      label: `Selling point ${i + 1}${title ? ` — ${title}` : ""} (icon)`,
      path: `social.points.${i}.icon`,
    })),
  ];
}

/** Slot key for a manifest slot name ("dish-01" → "dish-1"). */
function normaliseSlotKey(raw: string): SlotKey {
  const m = /^(dish|point)-0*(\d+)$/i.exec(raw.trim());
  return m ? `${m[1].toLowerCase()}-${Number(m[2])}` : raw.trim().toLowerCase();
}

/** manifest.json → { file base name (lower-case) → slot + alt }. Ignores anything malformed. */
export function parseManifest(json: unknown): Record<string, ManifestEntry> {
  const out: Record<string, ManifestEntry> = {};
  const slots = (json as { slots?: unknown })?.slots;
  if (!Array.isArray(slots)) return out;
  for (const s of slots) {
    if (!s || typeof s !== "object") continue;
    const { slot, file, alt } = s as { slot?: unknown; file?: unknown; alt?: unknown };
    if (typeof slot !== "string" || typeof file !== "string" || !file) continue;
    out[baseName(file).toLowerCase()] = { slot: normaliseSlotKey(slot), alt: typeof alt === "string" ? alt : undefined };
  }
  return out;
}

/** brand.json → the six brand fields (colours must be #rgb/#rrggbb). */
export function parseBrand(json: unknown): BrandValues {
  const out: BrandValues = {};
  if (!json || typeof json !== "object") return out;
  const src = json as Record<string, unknown>;
  for (const k of BRAND_KEYS) {
    const v = src[k];
    if (typeof v !== "string" || !v.trim()) continue;
    const value = v.trim();
    if (k.endsWith("Font")) out[k] = value;
    else if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) out[k] = value.toUpperCase();
  }
  return out;
}

/** The slot a file name points at, or null. `dishNames` enables matching by dish name. */
export function slotFromFileName(fileName: string, dishNames: string[] = [], pointTitles: string[] = []): SlotKey | null {
  const s = stem(fileName);
  if (/^logo\b/.test(s) || s === "logo") return "logo";
  if (/^(hero|banner|header-image|cover)\b/.test(s)) return "hero";
  if (/^about\b/.test(s)) return "about";
  let m = /^(?:dish|menu|item)[-_ ]?0*(\d+)/.exec(s);
  if (m) return `dish-${Number(m[1])}`;
  m = /^(?:point|icon|feature|why)[-_ ]?0*(\d+)/.exec(s);
  if (m) return `point-${Number(m[1])}`;
  // A photo named after the dish ("Chorizo Burrito.jpg"), or after a selling point.
  const fs = slug(s);
  if (fs.length >= 3) {
    const dish = dishNames.findIndex((n) => slug(n) && (fs === slug(n) || fs.includes(slug(n))));
    if (dish >= 0) return `dish-${dish + 1}`;
    const point = pointTitles.findIndex((t) => slug(t) && (fs === slug(t) || fs.includes(slug(t))));
    if (point >= 0) return `point-${point + 1}`;
  }
  return null;
}

export interface MatchInput {
  name: string;
  size: number;
}

export interface Match {
  /** Index into the input list. */
  index: number;
  slot: SlotKey | null;
  alt?: string;
  /** Why it isn't placed automatically. */
  problem?: "unknown-name" | "no-such-slot" | "duplicate" | "too-large";
}

/**
 * Decide a slot for every image. manifest.json wins over the file name; a slot
 * the site doesn't have (dish-9 when the .docx lists 8 dishes) or a second file
 * for a taken slot is left for the user to place.
 */
export function matchFiles(
  files: MatchInput[],
  slots: Slot[],
  manifest: Record<string, ManifestEntry> = {},
  dishNames: string[] = [],
  pointTitles: string[] = [],
): Match[] {
  const known = new Set(slots.map((s) => s.key));
  const taken = new Set<SlotKey>();
  return files.map((f, index) => {
    if (f.size > MAX_IMAGE_BYTES) return { index, slot: null, problem: "too-large" as const };
    const fromManifest = manifest[baseName(f.name).toLowerCase()];
    const slot = fromManifest?.slot ?? slotFromFileName(f.name, dishNames, pointTitles);
    if (!slot) return { index, slot: null, problem: "unknown-name" as const };
    if (!known.has(slot)) return { index, slot: null, problem: "no-such-slot" as const };
    if (taken.has(slot)) return { index, slot: null, problem: "duplicate" as const };
    taken.add(slot);
    return { index, slot, alt: fromManifest?.alt };
  });
}
