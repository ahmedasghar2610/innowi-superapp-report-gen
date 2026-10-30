import { z } from "zod";

/**
 * Shared Zod field primitives and date helpers for the merchant forms. Every
 * form binds its controls to strings (an empty input is ""), so the "optional"
 * helpers accept "" to mean "not set" rather than being `.optional()` — the
 * mappers decide whether "" becomes an omitted key or a `null`.
 */

/** Optional free-text: trims, caps length, "" allowed. */
export const optionalText = (max: number, label: string) =>
  z.string().trim().max(max, `${label} must be ${max} characters or fewer.`);

/**
 * Optional non-negative money from a native <input type="number">: "" or a
 * parseable amount. Kept as a string in the form (that is what the input gives
 * us) and converted to a real number by the mappers, because the API's decimal
 * DTO rejects numeric strings.
 */
export const optionalCurrency = (label: string) =>
  z
    .string()
    .trim()
    .refine((v) => v === "" || Number.isFinite(Number(v)), `Enter ${label} as a number.`)
    .refine((v) => v === "" || Number(v) >= 0, `${label} can't be negative.`);

/** A decimal string from the API ("300.00") → the value a number input wants. */
export const toCurrencyInput = (amount: string | null): string => amount ?? "";

/** Optional date from a native <input type="date">: "" or yyyy-MM-dd. */
export const optionalDate = z
  .string()
  .trim()
  .refine((v) => v === "" || /^\d{4}-\d{2}-\d{2}$/.test(v), "Enter a valid date.");

/** ISO timestamp → yyyy-MM-dd for a date input (UTC slice, no timezone shift). */
export const toDateInput = (iso: string | null): string => (iso ? iso.slice(0, 10) : "");

/** "2026-01-15" → ISO-8601 at UTC midnight. */
export const toIsoDate = (yyyyMmDd: string): string =>
  new Date(`${yyyyMmDd}T00:00:00.000Z`).toISOString();

/**
 * React Hook Form's `dirtyFields` shape for a flat string form — the mappers
 * take this to build minimal PATCH bodies (only changed fields).
 */
export type DirtyMap<TValues> = Partial<Record<keyof TValues, boolean | undefined>>;
