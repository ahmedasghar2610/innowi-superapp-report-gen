// COPIED from innowi-superapp-web/src/features/site-builder/server/slug.ts by scripts/sync-editor.cjs.
// Edit it there, then run `npm run sync-editor`.
export function slugify(input: string, fallback = "page"): string {
  const slug = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || fallback;
}

export function uniqueSlug(base: string, used: Set<string>): string {
  let slug = slugify(base);
  let n = 2;
  while (used.has(slug)) {
    slug = `${slugify(base).slice(0, 70)}-${n}`;
    n += 1;
  }
  used.add(slug);
  return slug;
}
