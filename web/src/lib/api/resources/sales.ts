import { api } from "../client";
import type {
  CaseQuery,
  CasePage,
  Customer,
  Deal,
  SupportCase,
  Visit,
  CreatedLogin,
  CustomerDetail,
  CustomerPage,
  CustomerQuery,
  DealDetail,
  DealPage,
  DealQuery,
  Owner,
  Person,
  Pipeline,
  PipelineQuery,
  SalesMe,
  SalesRole,
  Summary,
  Insights,
  SyncRun,
  SyncStatus,
  TeamMember,
  VisitPage,
  VisitQuery,
  OwnerQuery,
  CaseFilters,
  CaseInsights,
} from "@/features/sales/types";

/**
 * Sales module (/sales/*) — Innowi's Salesforce data, copied into the SuperApp
 * by the sync. Everything here is read-only towards Salesforce. The API
 * decides what each person sees: reps get only their own records.
 */
export const sales = {
  me: () => api.get<SalesMe>("/sales/me"),
  summary: (q?: OwnerQuery) => api.get<Summary>("/sales/summary", q),
  insights: (q?: OwnerQuery) => api.get<Insights>("/sales/insights", q),
  pipeline: (q?: PipelineQuery) => api.get<Pipeline>("/sales/pipeline", q),
  deals: (q?: DealQuery): Promise<DealPage> => api.getPage<Deal>("/sales/deals", q),
  deal: (id: string) => api.get<DealDetail>(`/sales/deals/${encodeURIComponent(id)}`),
  customers: (q?: CustomerQuery): Promise<CustomerPage> => api.getPage<Customer>("/sales/customers", q),
  customer: (id: string) => api.get<CustomerDetail>(`/sales/customers/${encodeURIComponent(id)}`),
  visits: (q?: VisitQuery): Promise<VisitPage> => api.getPage<Visit>("/sales/visits", q),
  visitTypes: () => api.get<string[]>("/sales/visit-types"),
  cases: (q?: CaseQuery): Promise<CasePage> => api.getPage<SupportCase>("/sales/cases", q),
  caseInsights: (q?: OwnerQuery & CaseFilters): Promise<CaseInsights> => api.get<CaseInsights>("/sales/cases/insights", q),
  owners: () => api.get<Owner[]>("/sales/owners"),
  team: () => api.get<TeamMember[]>("/sales/team"),
  people: () => api.get<Person[]>("/sales/people"),
  createLogin: (sfUserId: string, body: { role: SalesRole; email?: string }) =>
    api.post<CreatedLogin>(`/sales/people/${encodeURIComponent(sfUserId)}/login`, body),
  linkLogin: (sfUserId: string, userId: string) =>
    api.put<Person>(`/sales/people/${encodeURIComponent(sfUserId)}/link`, { userId }),
  unlinkLogin: (sfUserId: string) => api.del(`/sales/people/${encodeURIComponent(sfUserId)}/link`),
  syncStatus: () => api.get<SyncStatus>("/sales/sync"),
  runSync: (full = false) => api.post<SyncRun>("/sales/sync/run", { full }),
};
