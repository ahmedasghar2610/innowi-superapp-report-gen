import type {
  Website,
  WebsiteField,
  WebsiteFormStep,
  WebsiteProgress,
  WebsiteRepeat,
  WebsiteRepeatRow,
  WebsiteValues,
} from "../types";
import { WEBSITE_CONTENT_STEPS, WEBSITE_FORM_STEPS } from "../data/website-form-steps";

/* ------------------------------------------------------- nested get / set */

/** Read a dotted path (`business.name`, `offerings.items.0.price`). */
export function getAt(values: WebsiteValues, path: string): unknown {
  return path.split(".").reduce<unknown>((node, key) => {
    if (node == null || typeof node !== "object") return undefined;
    return (node as Record<string, unknown>)[key];
  }, values);
}

/** Read a dotted path as a trimmed string ("" when absent). */
export function getString(values: WebsiteValues, path: string): string {
  const value = getAt(values, path);
  return value == null ? "" : String(value);
}

/**
 * Immutably write a dotted path, creating objects (or arrays, when the next
 * segment is numeric) along the way. Returns a new tree so React sees a change.
 */
export function setAt(values: WebsiteValues, path: string, value: unknown): WebsiteValues {
  const keys = path.split(".");

  const write = (node: unknown, depth: number): unknown => {
    const key = keys[depth];
    const last = depth === keys.length - 1;
    const isIndex = /^\d+$/.test(key);

    if (isIndex) {
      const list = Array.isArray(node) ? [...node] : [];
      list[Number(key)] = last ? value : write(list[Number(key)], depth + 1);
      return list;
    }

    const obj = node && typeof node === "object" && !Array.isArray(node) ? { ...(node as Record<string, unknown>) } : {};
    obj[key] = last ? value : write(obj[key], depth + 1);
    return obj;
  };

  return write(values, 0) as WebsiteValues;
}

/** The rows of a repeatable section, always an array. */
export function getRows(values: WebsiteValues, path: string): WebsiteRepeatRow[] {
  const list = getAt(values, path);
  return Array.isArray(list) ? (list as WebsiteRepeatRow[]) : [];
}

/* --------------------------------------------------------------- defaults */

function blankRow(repeat: WebsiteRepeat): WebsiteRepeatRow {
  const row: WebsiteRepeatRow = {};
  for (const f of repeat.fields) row[f.key] = f.defaultValue ?? "";
  return row;
}

export { blankRow };

/** Seed colour swatches, selects and the minimum rows of each repeatable. */
export function withDefaults(initial: WebsiteValues = {}): WebsiteValues {
  let next = initial;

  for (const step of WEBSITE_FORM_STEPS) {
    for (const entry of step.entries) {
      if (entry.kind === "field") {
        if (entry.defaultValue != null && getAt(next, entry.key) === undefined) {
          next = setAt(next, entry.key, entry.defaultValue);
        }
        continue;
      }
      if (entry.kind !== "repeat") continue;

      const rows = getRows(next, entry.key);
      if (rows.length >= entry.min && Array.isArray(getAt(next, entry.key))) continue;

      const filled = [...rows];
      while (filled.length < entry.min) filled.push(blankRow(entry));
      next = setAt(next, entry.key, filled);
    }
  }

  return next;
}

/* ------------------------------------------------------------- validation */

/**
 * Master switch for client-side validation. `false` lets every step through
 * untouched — handy while filling the form in with placeholder content. The
 * `required` flags in the schema stay as they are either way, so flipping this
 * needs no other edit.
 */
export const VALIDATE = true;

const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const RE_URL = /^(https?:\/\/|\/|#)\S*$/i;
const RE_TEL = /^[0-9+()\s.\-]{6,}$/;

/** An error message for one answer, or "" when it is acceptable. */
export function checkValue(field: WebsiteField, raw: unknown): string {
  if (!VALIDATE) return "";
  const value = String(raw ?? "").trim();
  if (!value) return field.required ? `${field.label} is required.` : "";
  if (field.type === "email" && !RE_EMAIL.test(value)) return "That doesn't look like an email address.";
  if (field.type === "url" && !RE_URL.test(value)) return "Links should start with https://";
  if (field.type === "tel" && !RE_TEL.test(value)) return "Use digits, spaces and + ( ) - only.";
  return "";
}

export interface FieldPair {
  /** Absolute dotted path into the answers. */
  path: string;
  field: WebsiteField;
}

/** Every answerable field on a step, with repeatable rows expanded. */
export function stepFieldPairs(step: WebsiteFormStep, values: WebsiteValues): FieldPair[] {
  const pairs: FieldPair[] = [];

  for (const entry of step.entries) {
    if (entry.kind === "group") continue;
    if (entry.kind === "field") {
      pairs.push({ path: entry.key, field: entry });
      continue;
    }
    getRows(values, entry.key).forEach((_row, i) => {
      for (const sub of entry.fields) pairs.push({ path: `${entry.key}.${i}.${sub.key}`, field: sub });
    });
  }

  return pairs;
}

/** The fields on a step that currently fail validation. */
export function stepProblems(step: WebsiteFormStep, values: WebsiteValues): FieldPair[] {
  return stepFieldPairs(step, values).filter((p) => checkValue(p.field, getAt(values, p.path)));
}

/** Per-path error messages for a step, ready to hand to the renderer. */
export function stepErrorMap(step: WebsiteFormStep, values: WebsiteValues): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const p of stepProblems(step, values)) {
    errors[p.path] = checkValue(p.field, getAt(values, p.path));
  }
  return errors;
}

/* --------------------------------------------------------------- progress */

export function websiteProgress(values: WebsiteValues): WebsiteProgress {
  let complete = 0;
  let missing = 0;

  for (const step of WEBSITE_CONTENT_STEPS) {
    const problems = stepProblems(step, values);
    missing += problems.length;
    if (problems.length === 0) complete += 1;
  }

  return { complete, total: WEBSITE_CONTENT_STEPS.length, missing };
}

/* ----------------------------------------------------------------- record */

/** Pull the flat list columns back out of the answer tree. */
export function summarise(values: WebsiteValues): Pick<Website, "name" | "tagline" | "contactEmail"> {
  return {
    name: getString(values, "business.name").trim() || "Untitled website",
    tagline: getString(values, "business.tagline").trim(),
    contactEmail: getString(values, "business.email").trim(),
  };
}
