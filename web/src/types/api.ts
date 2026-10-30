/**
 * Shared API envelope types (API_REFERENCE.md §1).
 * The backend uses three response shapes consistently:
 *   - bare object            → single resource
 *   - { data: T[] }          → child-collection lists
 *   - { data: T[], meta }    → GET /merchants (the only paginated endpoint)
 */

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  pageCount: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface ListEnvelope<T> {
  data: T[];
}

export interface PagedEnvelope<T> {
  data: T[];
  meta: PageMeta;
}

/** Uniform error body from AllExceptionsFilter (message is string | string[]). */
export interface ApiErrorBody {
  statusCode: number;
  error: string;
  message: string | string[];
  path?: string;
  timestamp?: string;
}
