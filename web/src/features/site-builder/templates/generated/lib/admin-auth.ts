// Shared auth helpers for the /admin visual editor and its /api/admin/*
// routes. The password itself (ADMIN_PASSWORD, set in .env.local) is never
// stored or reflected back to the client — only a SHA-256 hash of it is kept
// in the sb_admin_session cookie, and every gated route/page recomputes that
// same hash to check the cookie against it.
import { createHash, timingSafeEqual } from "node:crypto";

export const ADMIN_SESSION_COOKIE = "sb_admin_session";
export const ADMIN_SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

/** SHA-256 hash of the configured ADMIN_PASSWORD, or null if it isn't set. */
export function expectedSessionValue(): string | null {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) return null;
  return createHash("sha256").update(password).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** True if a request's ADMIN_PASSWORD guess is correct. */
export function isValidPassword(candidate: string): boolean {
  const password = process.env.ADMIN_PASSWORD;
  if (!password || !candidate) return false;
  return safeEqual(candidate, password);
}

/** True if a sb_admin_session cookie value matches the current password's hash. */
export function isValidSession(value: string | undefined | null): boolean {
  const expected = expectedSessionValue();
  if (!expected || !value) return false;
  return safeEqual(expected, value);
}
