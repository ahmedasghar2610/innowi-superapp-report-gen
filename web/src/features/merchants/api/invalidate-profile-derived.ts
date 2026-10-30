import type { QueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/query-keys";

/**
 * Invalidate the two server-derived profile views (PROF-02/03 and the §6.4
 * alerts) for one merchant.
 *
 * Both are computed from the whole merchant aggregate, so almost any write in
 * this module can move them: adding a contact closes a required-contact gap,
 * uploading a menu closes a Missing Files alert, marking a connection Verified
 * clears a pending one. Rather than leave each mutation to remember that, every
 * mutation calls this — which is why it lives in one file instead of being
 * inlined seven times.
 *
 * `fields` and `profile` are included even though they look like field-only
 * queries: both embed the same completeness object (API §4a.1), and the Profile
 * tab's outstanding-items card reads it from `fields`. Leaving them out is how
 * the two cards drift — add an owner contact from the Contacts tab and the
 * workspace card would drop the alert while "What's outstanding" one screenful
 * below still listed the contact as missing, until the 30s staleTime elapsed.
 *
 * The merchant record and the directory list are invalidated too, because
 * `profileCompletionPct` on the Merchant row is a write-behind cache of the
 * same percent (API §4a.3) and both read it.
 */
export function invalidateProfileDerived(qc: QueryClient, merchantId: string): void {
  qc.invalidateQueries({ queryKey: queryKeys.merchants.completeness(merchantId), exact: true });
  qc.invalidateQueries({ queryKey: queryKeys.merchants.alerts(merchantId), exact: true });
  qc.invalidateQueries({ queryKey: queryKeys.merchants.fields(merchantId), exact: true });
  qc.invalidateQueries({ queryKey: queryKeys.merchants.profile(merchantId), exact: true });
  qc.invalidateQueries({ queryKey: queryKeys.merchants.detail(merchantId), exact: true });
  qc.invalidateQueries({ queryKey: queryKeys.merchants.lists() });
  // The portfolio Data Quality view reads the same cached percent.
  qc.invalidateQueries({ queryKey: queryKeys.profiling.all });
}
