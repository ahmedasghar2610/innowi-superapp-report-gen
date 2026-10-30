import axios from "axios";
import type { ApiErrorBody } from "@/types/api";

/**
 * Normalized API error. The backend's `message` is a `string` for thrown
 * exceptions and a `string[]` for validation failures (API_REFERENCE.md §1);
 * `messages` here is always an array so callers don't branch.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly messages: string[];
  readonly body?: ApiErrorBody;

  constructor(status: number, messages: string[], body?: ApiErrorBody) {
    super(messages[0] ?? "Request failed");
    this.name = "ApiError";
    this.status = status;
    this.messages = messages;
    this.body = body;
  }

  /** Convenience: is this a duplicate/conflict (e.g. restaurantName taken)? */
  get isConflict() {
    return this.status === 409;
  }
  get isNotFound() {
    return this.status === 404;
  }
  get isValidation() {
    return this.status === 400;
  }
}

/** Type guard for the normalized error. */
export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError;
}

/** Turn any thrown value (Axios error, network error, …) into an ApiError. */
export function normalizeError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;

  if (axios.isAxiosError(err)) {
    const body = err.response?.data as ApiErrorBody | undefined;
    const status = err.response?.status ?? 0;
    const raw = body?.message;
    const messages = Array.isArray(raw)
      ? raw
      : [raw ?? err.message ?? "Network error"];
    return new ApiError(status, messages, body);
  }

  return new ApiError(0, [err instanceof Error ? err.message : "Unknown error"]);
}

/**
 * Best-effort mapping of validation messages to a `{ field: message }` map for
 * inline form errors. NestJS class-validator messages start with the property
 * name (e.g. "restaurantName should not be empty"), so we key on the first word.
 */
export function fieldErrorsFrom(error: ApiError, fields: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const msg of error.messages) {
    const field = fields.find((f) => msg.startsWith(f));
    if (field && !out[field]) out[field] = msg;
  }
  return out;
}
