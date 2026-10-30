// Per-page stylesheet model. The style panel writes rules keyed by
// data-sb-id and breakpoint; this module round-trips them to CSS text that is
// stored in pages.json (`css`) and rendered by the site and the preview.
//
//   #cloned-root [data-sb-id="abc"] { color: #fff !important; }
//   @media (max-width: 1024px) { ... }   tablet
//   @media (max-width: 767px)  { ... }   mobile
//
// Anything else found in the stylesheet (hand-written CSS) is preserved in
// `extra` and re-emitted after the generated rules.

import type { Device } from "./types";

export type DeclMap = Record<string, string>;
export type StyleMap = Record<string, Partial<Record<Device, DeclMap>>>;
export type PageStyles = { map: StyleMap; extra: string };

const SELECTOR_PREFIX = '#cloned-root [data-sb-id="';
const MEDIA: Record<Exclude<Device, "desktop">, string> = {
  tablet: "@media (max-width: 1024px)",
  mobile: "@media (max-width: 767px)",
};
const MARK_START = "/* sb-styles */";
const MARK_CUSTOM = "/* sb-custom */";

export function emptyStyles(): PageStyles {
  return { map: {}, extra: "" };
}

function parseDecls(body: string): DeclMap {
  const out: DeclMap = {};
  for (const part of body.split(";")) {
    const idx = part.indexOf(":");
    if (idx < 0) continue;
    const prop = part.slice(0, idx).trim().toLowerCase();
    const value = part
      .slice(idx + 1)
      .replace(/!important\s*$/i, "")
      .trim();
    if (prop && value) out[prop] = value;
  }
  return out;
}

/** Index of the "}" matching the "{" at `open`. */
function matchBrace(css: string, open: number): number {
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return css.length - 1;
}

function parseRules(chunk: string, device: Device, map: StyleMap): string {
  let rest = "";
  let i = 0;
  while (i < chunk.length) {
    const at = chunk.indexOf(SELECTOR_PREFIX, i);
    if (at < 0) {
      rest += chunk.slice(i);
      break;
    }
    rest += chunk.slice(i, at);
    const idEnd = chunk.indexOf('"]', at + SELECTOR_PREFIX.length);
    const open = chunk.indexOf("{", at);
    if (idEnd < 0 || open < 0) {
      rest += chunk.slice(at);
      break;
    }
    const id = chunk.slice(at + SELECTOR_PREFIX.length, idEnd);
    const close = matchBrace(chunk, open);
    const decls = parseDecls(chunk.slice(open + 1, close));
    if (Object.keys(decls).length) {
      map[id] = map[id] || {};
      map[id][device] = { ...(map[id][device] || {}), ...decls };
    }
    i = close + 1;
  }
  return rest;
}

export function parsePageCss(css: string | undefined | null): PageStyles {
  const map: StyleMap = {};
  if (!css) return { map, extra: "" };
  let source = css.replace(MARK_START, "");
  let extra = "";
  const customAt = source.indexOf(MARK_CUSTOM);
  if (customAt >= 0) {
    extra = source.slice(customAt + MARK_CUSTOM.length).trim();
    source = source.slice(0, customAt);
  }
  let rest = "";
  let i = 0;
  while (i < source.length) {
    const tablet = source.indexOf(MEDIA.tablet, i);
    const mobile = source.indexOf(MEDIA.mobile, i);
    const candidates = [
      { pos: tablet, device: "tablet" as Device, token: MEDIA.tablet },
      { pos: mobile, device: "mobile" as Device, token: MEDIA.mobile },
    ].filter((c) => c.pos >= 0);
    if (!candidates.length) {
      rest += parseRules(source.slice(i), "desktop", map);
      break;
    }
    const next = candidates.sort((a, b) => a.pos - b.pos)[0];
    rest += parseRules(source.slice(i, next.pos), "desktop", map);
    const open = source.indexOf("{", next.pos);
    if (open < 0) {
      rest += source.slice(next.pos);
      break;
    }
    const close = matchBrace(source, open);
    const leftover = parseRules(source.slice(open + 1, close), next.device, map);
    if (leftover.trim()) rest += `${next.token} {${leftover}}\n`;
    i = close + 1;
  }
  const restTrim = rest.trim();
  return { map, extra: [restTrim, extra].filter(Boolean).join("\n") };
}

function serializeDecls(decls: DeclMap): string {
  return Object.entries(decls)
    .filter(([, v]) => v !== "" && v !== undefined)
    .map(([k, v]) => `${k}: ${v} !important;`)
    .join(" ");
}

export function serializePageCss(styles: PageStyles): string {
  const lines: string[] = [];
  const perDevice: Record<Device, string[]> = { desktop: [], tablet: [], mobile: [] };
  for (const [id, devices] of Object.entries(styles.map)) {
    for (const device of ["desktop", "tablet", "mobile"] as Device[]) {
      const decls = devices[device];
      if (!decls) continue;
      const body = serializeDecls(decls);
      if (!body) continue;
      perDevice[device].push(`${SELECTOR_PREFIX}${id}"] { ${body} }`);
    }
  }
  const hasRules = perDevice.desktop.length || perDevice.tablet.length || perDevice.mobile.length;
  if (hasRules) {
    lines.push(MARK_START);
    lines.push(...perDevice.desktop);
    if (perDevice.tablet.length) lines.push(`${MEDIA.tablet} {`, ...perDevice.tablet.map((r) => `  ${r}`), "}");
    if (perDevice.mobile.length) lines.push(`${MEDIA.mobile} {`, ...perDevice.mobile.map((r) => `  ${r}`), "}");
  }
  if (styles.extra.trim()) {
    lines.push(MARK_CUSTOM);
    lines.push(styles.extra.trim());
  }
  return lines.join("\n");
}

export function getDecl(styles: PageStyles, id: string, device: Device, prop: string): string {
  return styles.map[id]?.[device]?.[prop] ?? "";
}

/** Returns a new PageStyles with the declaration set (empty value removes it). */
export function setDecl(
  styles: PageStyles,
  id: string,
  device: Device,
  prop: string,
  value: string,
): PageStyles {
  const map: StyleMap = { ...styles.map };
  const devices = { ...(map[id] || {}) };
  const decls = { ...(devices[device] || {}) };
  if (value.trim() === "") delete decls[prop];
  else decls[prop] = value.trim();
  if (Object.keys(decls).length) devices[device] = decls;
  else delete devices[device];
  if (Object.keys(devices).length) map[id] = devices;
  else delete map[id];
  return { ...styles, map };
}

export function setDecls(
  styles: PageStyles,
  id: string,
  device: Device,
  decls: DeclMap,
): PageStyles {
  let next = styles;
  for (const [prop, value] of Object.entries(decls)) next = setDecl(next, id, device, prop, value);
  return next;
}

export function removeIds(styles: PageStyles, ids: string[]): PageStyles {
  const map: StyleMap = { ...styles.map };
  for (const id of ids) delete map[id];
  return { ...styles, map };
}

export function copyStyles(styles: PageStyles, fromId: string, toId: string): PageStyles {
  const src = styles.map[fromId];
  if (!src) return styles;
  const copy: Partial<Record<Device, DeclMap>> = {};
  for (const [device, decls] of Object.entries(src) as Array<[Device, DeclMap]>) copy[device] = { ...decls };
  return { ...styles, map: { ...styles.map, [toId]: copy } };
}

/** Drop rules whose ids no longer exist in the document. */
export function pruneStyles(styles: PageStyles, existingIds: Set<string>): PageStyles {
  const map: StyleMap = {};
  for (const [id, devices] of Object.entries(styles.map)) {
    if (existingIds.has(id)) map[id] = devices;
  }
  return { ...styles, map };
}
