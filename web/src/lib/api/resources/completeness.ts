import { api } from "../client";
import type { ProfileAlert, ProfileCompleteness } from "@/features/merchants/types";

/* Profile completeness & alerts. API_REFERENCE.md §4a. Both are derived
   server-side on read — there is nothing to POST or PATCH here. */
export type {
  ProfileCompleteness,
  CompletenessSection,
  CompletenessSectionKey,
  MissingItem,
  MissingItemArea,
  MissingItemSeverity,
  PendingConnection,
  ConfidenceBreakdown,
  ProfileAlert,
  ProfileAlertSeverity,
  ProfileAlertType,
  ProfileAlertTargetTab,
} from "@/features/merchants/types";

export const completeness = {
  /** GET /merchants/:id/completeness → the weighted score + everything outstanding. */
  get(merchantId: string): Promise<ProfileCompleteness> {
    return api.get<ProfileCompleteness>(`/merchants/${merchantId}/completeness`);
  },

  /**
   * GET /merchants/:id/alerts → the four §6.4 attention states, severity-first.
   * Unwraps the `{ data, total }` envelope; `total` is just `data.length`.
   */
  async alerts(merchantId: string): Promise<ProfileAlert[]> {
    const res = await api.get<{ data: ProfileAlert[]; total: number }>(
      `/merchants/${merchantId}/alerts`,
    );
    return res.data;
  },
};
