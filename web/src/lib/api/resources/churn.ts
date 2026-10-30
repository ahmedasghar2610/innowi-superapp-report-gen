import { api } from "../client";
import type { PagedEnvelope } from "@/types/api";
import type {
  ChurnDetail,
  ChurnImportReport,
  ChurnQuery,
  ChurnRow,
  ChurnSummary,
  MarkChurnedInput,
  UpdateChurnInput,
} from "@/features/churn/types";

/** /churn — churned merchants and the win-back list (API: app/modules/churn). */
export const churn = {
  list(query?: ChurnQuery): Promise<PagedEnvelope<ChurnRow>> {
    return api.getPage<ChurnRow>("/churn", query);
  },
  summary(): Promise<ChurnSummary> {
    return api.get<ChurnSummary>("/churn/summary");
  },
  get(merchantId: string): Promise<ChurnDetail> {
    return api.get<ChurnDetail>(`/churn/${merchantId}`);
  },
  update(merchantId: string, input: UpdateChurnInput): Promise<ChurnDetail> {
    return api.patch<ChurnDetail>(`/churn/${merchantId}`, input);
  },
  mark(merchantId: string, input: MarkChurnedInput): Promise<ChurnDetail> {
    return api.post<ChurnDetail>(`/churn/${merchantId}`, input);
  },
  addNote(merchantId: string, body: string): Promise<ChurnDetail> {
    return api.post<ChurnDetail>(`/churn/${merchantId}/notes`, { body });
  },
  import(file: File, dryRun: boolean): Promise<ChurnImportReport> {
    const form = new FormData();
    form.append("file", file);
    return api.postForm<ChurnImportReport>(`/churn/import?dryRun=${dryRun ? "true" : "false"}`, form);
  },
};
