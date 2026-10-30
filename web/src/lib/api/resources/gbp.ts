import { api } from "../client";
import type {
  GbpNote,
  GbpStatus,
  LocationReport,
  MerchantListing,
  MerchantSuggestion,
  Overview,
  RangeQuery,
  SyncRun,
} from "@/features/gbp/types";

/** Google Business Profile reporting (API modules/gbp). Read-only towards Google. */
export const gbp = {
  status(): Promise<GbpStatus> {
    return api.get<GbpStatus>("/gbp/status");
  },
  connect(returnTo: "gbp" | "settings" = "gbp"): Promise<{ url: string }> {
    return api.post<{ url: string }>(`/gbp/connect?returnTo=${returnTo}`);
  },
  disconnect(): Promise<void> {
    return api.del("/gbp/connection");
  },
  sync(): Promise<SyncRun> {
    return api.postLong<SyncRun>("/gbp/sync");
  },
  loadSampleData(): Promise<{ listings: number }> {
    return api.post("/gbp/sample-data");
  },
  removeSampleData(): Promise<{ removed: number }> {
    return api.del("/gbp/sample-data");
  },
  runs(limit = 10): Promise<SyncRun[]> {
    return api.getList<SyncRun>("/gbp/sync-runs", { limit });
  },
  overview(q: RangeQuery): Promise<Overview> {
    return api.get<Overview>("/gbp/overview", { ...q });
  },
  report(id: string, q: RangeQuery & { keywordMonth?: string }): Promise<LocationReport> {
    return api.get<LocationReport>(`/gbp/locations/${id}/report`, { ...q });
  },
  notes(id: string): Promise<GbpNote[]> {
    return api.getList<GbpNote>(`/gbp/locations/${id}/notes`);
  },
  addNote(id: string, body: string): Promise<GbpNote> {
    return api.post<GbpNote>(`/gbp/locations/${id}/notes`, { body });
  },
  editNote(noteId: string, body: string): Promise<GbpNote> {
    return api.patch<GbpNote>(`/gbp/notes/${noteId}`, { body });
  },
  deleteNote(noteId: string): Promise<void> {
    return api.del(`/gbp/notes/${noteId}`);
  },
  suggestions(id: string): Promise<MerchantSuggestion[]> {
    return api.getList<MerchantSuggestion>(`/gbp/locations/${id}/merchant-suggestions`);
  },
  link(id: string, merchantId: string): Promise<unknown> {
    return api.put(`/gbp/locations/${id}/merchant`, { merchantId });
  },
  unlink(id: string): Promise<unknown> {
    return api.del(`/gbp/locations/${id}/merchant`);
  },
  merchantListings(merchantId: string): Promise<{ range: { start: string; end: string; days: number }; data: MerchantListing[] }> {
    return api.get(`/merchants/${merchantId}/gbp`);
  },
};
