import type { Role } from "@/features/auth/types";

/**
 * Audit log types — mirrors AUDIT_LOG.md §2/§5/§6. An append-only ledger of
 * every mutating write made through the API, captured automatically by a
 * global interceptor (`@Audit(...)` decorator on the backend). Two read
 * surfaces:
 *   - GET /audit-logs           — platform-wide, ADMIN/SUPER_ADMIN only
 *   - GET /merchants/:id/history — one merchant's own history, any staff role
 */

export type AuditAction = "CREATE" | "UPDATE" | "DELETE";
export type AuditOutcome = "SUCCESS" | "FAILURE";

export interface AuditLog {
  id: string;
  actorId: string | null;
  actorEmail: string | null;
  actorRole: Role | null;
  action: AuditAction;
  entityType: string;
  entityId: string | null;
  merchantId: string | null;
  /** Full JSON snapshot immediately before the write; null for CREATE. */
  before: Record<string, unknown> | null;
  /** Full JSON snapshot immediately after the write; null for DELETE. */
  after: Record<string, unknown> | null;
  /** Top-level keys that differ between before/after (UPDATE only). */
  changedFields: string[];
  method: string;
  path: string;
  outcome: AuditOutcome;
  statusCode: number;
  errorMessage: string | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}

/** GET /audit-logs query (AUDIT_LOG.md §5) — all filters optional, ANDed. */
export interface AuditLogQuery {
  page?: number;
  limit?: number;
  order?: "asc" | "desc";
  actorId?: string;
  entityType?: string;
  entityId?: string;
  merchantId?: string;
  action?: AuditAction;
  outcome?: AuditOutcome;
  from?: string; // ISO 8601
  to?: string; // ISO 8601
}

/** GET /merchants/:id/history query — pagination only. */
export interface MerchantHistoryQuery {
  page?: number;
  limit?: number;
}
