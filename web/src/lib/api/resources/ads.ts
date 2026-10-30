import { api } from "../client";
import type {
  AccountDetail,
  AccountListItem,
  AdsComment,
  AdsStatus,
  Asset,
  Breakdown,
  ImportResult,
  MerchantSuggestion,
  MonthlyReport,
  Offers,
  PeriodQuery,
  Portfolio,
  PortfolioRow,
  SyncRun,
  Trend,
  Unmapped,
} from "@/features/ads/types";

/** Google Ads reporting (API modules/ads). Read-only towards Google. */
export const ads = {
  status(): Promise<AdsStatus> {
    return api.get<AdsStatus>("/ads/status");
  },
  connect(returnTo: "ads" | "settings" = "ads"): Promise<{ url: string }> {
    return api.post<{ url: string }>(`/ads/connect?returnTo=${returnTo}`);
  },
  disconnect(): Promise<void> {
    return api.del("/ads/connection");
  },
  sync(mode: "quick" | "full" = "quick"): Promise<SyncRun> {
    return api.postLong<SyncRun>(`/ads/sync?mode=${mode}`);
  },
  runs(limit = 10): Promise<SyncRun[]> {
    return api.getList<SyncRun>("/ads/sync-runs", { limit });
  },
  loadSampleData(): Promise<{ accounts: number; campaigns: number; days: number }> {
    return api.post("/ads/sample-data");
  },
  removeSampleData(): Promise<{ removed: number }> {
    return api.del("/ads/sample-data");
  },
  portfolio(q: PeriodQuery): Promise<Portfolio> {
    return api.get<Portfolio>("/ads/portfolio", { ...q });
  },
  monthlyReport(month?: string): Promise<MonthlyReport> {
    return api.get<MonthlyReport>("/ads/monthly-report", { month });
  },
  unmapped(): Promise<Unmapped> {
    return api.get<Unmapped>("/ads/unmapped");
  },
  accounts(state?: "active" | "archived" | "ignored"): Promise<AccountListItem[]> {
    return api.getList<AccountListItem>("/ads/accounts", { state });
  },
  addAccount(customerId: string, name: string): Promise<unknown> {
    return api.post("/ads/accounts", { customerId, name });
  },
  importAccounts(file: File): Promise<ImportResult> {
    const form = new FormData();
    form.append("file", file);
    return api.postForm<ImportResult>("/ads/accounts/import", form);
  },
  account(id: string, q: PeriodQuery): Promise<AccountDetail> {
    return api.get<AccountDetail>(`/ads/accounts/${id}`, { ...q });
  },
  updateAccount(
    id: string,
    patch: { name?: string; state?: "active" | "archived" | "ignored"; ticketTotalSales?: number | null; ticketOrderCount?: number | null },
  ): Promise<unknown> {
    return api.patch(`/ads/accounts/${id}`, patch);
  },
  assets(id: string): Promise<Asset[]> {
    return api.getList<Asset>(`/ads/accounts/${id}/assets`);
  },
  offers(id: string): Promise<Offers> {
    return api.get<Offers>(`/ads/accounts/${id}/offers`);
  },
  trend(id: string, q: PeriodQuery & { campaign?: string }): Promise<Trend> {
    return api.get<Trend>(`/ads/accounts/${id}/trend`, { ...q });
  },
  breakdown(id: string, month?: string): Promise<Breakdown> {
    return api.get<Breakdown>(`/ads/accounts/${id}/breakdown`, { month });
  },
  suggestions(id: string): Promise<MerchantSuggestion[]> {
    return api.getList<MerchantSuggestion>(`/ads/accounts/${id}/merchant-suggestions`);
  },
  link(id: string, merchantId: string): Promise<unknown> {
    return api.put(`/ads/accounts/${id}/merchant`, { merchantId });
  },
  unlink(id: string): Promise<unknown> {
    return api.del(`/ads/accounts/${id}/merchant`);
  },
  comments(id: string): Promise<AdsComment[]> {
    return api.getList<AdsComment>(`/ads/accounts/${id}/comments`);
  },
  addComment(id: string, body: string): Promise<AdsComment> {
    return api.post<AdsComment>(`/ads/accounts/${id}/comments`, { body });
  },
  editComment(commentId: string, body: string): Promise<AdsComment> {
    return api.patch<AdsComment>(`/ads/comments/${commentId}`, { body });
  },
  deleteComment(commentId: string): Promise<void> {
    return api.del(`/ads/comments/${commentId}`);
  },
  merchantAccounts(merchantId: string): Promise<{ period: { start: string; end: string; days: number }; data: PortfolioRow[] }> {
    return api.get(`/merchants/${merchantId}/ads`);
  },
};
