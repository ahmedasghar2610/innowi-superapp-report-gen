import { api } from "../client";
import type { PagedEnvelope } from "@/types/api";
import type { AuditLog, AuditLogQuery, MerchantHistoryQuery } from "@/features/audit/types";

/**
 * Audit log reads (AUDIT_LOG.md §5). Both endpoints are paginated
 * (`{ data, meta }`, same PagedEnvelope shape as GET /merchants). Read-only —
 * the ledger is append-only server-side, there is no client write surface.
 */
export type { AuditLog, AuditAction, AuditOutcome, AuditLogQuery, MerchantHistoryQuery } from "@/features/audit/types";

export const audit = {
  /** GET /audit-logs — platform-wide log. ADMIN/SUPER_ADMIN only (403 otherwise). */
  list(query?: AuditLogQuery): Promise<PagedEnvelope<AuditLog>> {
    return api.getPage<AuditLog>("/audit-logs", query);
  },

  /** GET /merchants/:id/history — one merchant's own history (any staff role that can see the merchant). */
  merchantHistory(merchantId: string, query?: MerchantHistoryQuery): Promise<PagedEnvelope<AuditLog>> {
    return api.getPage<AuditLog>(`/merchants/${merchantId}/history`, query);
  },
};
