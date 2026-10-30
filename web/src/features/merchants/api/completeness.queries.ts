"use client";

import { useQuery } from "@tanstack/react-query";
import { completeness } from "@/lib/api/resources/completeness";
import { queryKeys } from "@/lib/query/query-keys";
import type { ApiError } from "@/lib/api/client";
import type { QueryOpts } from "@/lib/query/hook-types";
import type { ProfileAlert, ProfileCompleteness } from "@/features/merchants/types";

/**
 * GET /merchants/:id/completeness — PROF-02/03.
 *
 * Shared by the workspace card (the headline score) and the Profile tab (the
 * missing-item breakdown). They deliberately use the same query key so the two
 * surfaces read one cached response and can never show different numbers — the
 * duplication this replaces was a hardcoded 72% next to a computed percent.
 */
export function useProfileCompleteness(
  id: string | undefined,
  options?: QueryOpts<ProfileCompleteness>,
) {
  return useQuery<ProfileCompleteness, ApiError>({
    queryKey: queryKeys.merchants.completeness(id ?? ""),
    queryFn: () => completeness.get(id as string),
    enabled: !!id,
    ...options,
  });
}

/** GET /merchants/:id/alerts — the four §6.4 attention states, severity-first. */
export function useProfileAlerts(id: string | undefined, options?: QueryOpts<ProfileAlert[]>) {
  return useQuery<ProfileAlert[], ApiError>({
    queryKey: queryKeys.merchants.alerts(id ?? ""),
    queryFn: () => completeness.alerts(id as string),
    enabled: !!id,
    ...options,
  });
}
