"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { audit } from "@/lib/api/resources/audit";
import { queryKeys } from "@/lib/query/query-keys";
import type { ApiError, PagedEnvelope } from "@/lib/api/client";
import type { QueryOpts } from "@/lib/query/hook-types";
import type { AuditLog, AuditLogQuery, MerchantHistoryQuery } from "./types";

/** GET /audit-logs — platform-wide log (ADMIN/SUPER_ADMIN). */
export function useAuditLogs(query?: AuditLogQuery, options?: QueryOpts<PagedEnvelope<AuditLog>>) {
  return useQuery<PagedEnvelope<AuditLog>, ApiError>({
    queryKey: queryKeys.audit.list(query ?? {}),
    queryFn: () => audit.list(query),
    placeholderData: keepPreviousData,
    ...options,
  });
}

/** GET /merchants/:id/history — one merchant's history. */
export function useMerchantHistory(
  merchantId: string | undefined,
  query?: MerchantHistoryQuery,
  options?: QueryOpts<PagedEnvelope<AuditLog>>,
) {
  return useQuery<PagedEnvelope<AuditLog>, ApiError>({
    queryKey: queryKeys.audit.merchantHistory(merchantId ?? "", query ?? {}),
    queryFn: () => audit.merchantHistory(merchantId as string, query),
    enabled: !!merchantId,
    placeholderData: keepPreviousData,
    ...options,
  });
}
