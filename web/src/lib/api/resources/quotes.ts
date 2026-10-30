import { api } from "../client";
import type { PagedEnvelope } from "@/types/api";
import type {
  CreateLinkInput,
  LinkCreated,
  Priced,
  PriceItem,
  PriceItemUpdate,
  QuoteLink,
  QuoteRequest,
  QuoteSummary,
  RequestStatus,
  Section,
  Selection,
  SignInput,
  UpdateLinkInput,
  HardwarePlan,
} from "@/features/quotes/types";

export interface LinkQuery {
  page?: number;
  limit?: number;
  q?: string;
  status?: "ACTIVE" | "REVOKED";
  mine?: boolean;
}

export interface RequestQuery {
  page?: number;
  limit?: number;
  q?: string;
  status?: RequestStatus;
  linkId?: string;
}

/** /quotes — the quote builder, staff side (API: app/modules/quotes/router.py). */
export const quotes = {
  priceList: () => api.getList<PriceItem>("/quotes/price-list"),
  sections: () => api.getList<Section>("/quotes/sections"),
  updatePriceItem: (id: string, input: PriceItemUpdate) => api.patch<PriceItem>(`/quotes/price-list/${id}`, input),
  summary: () => api.get<QuoteSummary>("/quotes/summary"),
  links: (query?: LinkQuery): Promise<PagedEnvelope<QuoteLink>> => api.getPage<QuoteLink>("/quotes/links", { ...query }),
  link: (id: string) => api.get<QuoteLink>(`/quotes/links/${id}`),
  createLink: (input: CreateLinkInput) => api.post<LinkCreated>("/quotes/links", input),
  updateLink: (id: string, input: UpdateLinkInput) => api.patch<QuoteLink>(`/quotes/links/${id}`, input),
  revokeLink: (id: string) => api.post<QuoteLink>(`/quotes/links/${id}/revoke`),
  newLinkUrl: (id: string) => api.post<LinkCreated>(`/quotes/links/${id}/new-url`),
  previewLink: (id: string, items: Selection[], hardwarePlan: HardwarePlan) =>
    api.post<Priced>(`/quotes/links/${id}/price`, { items, hardwarePlan }),
  requests: (query?: RequestQuery): Promise<PagedEnvelope<QuoteRequest>> =>
    api.getPage<QuoteRequest>("/quotes/requests", { ...query }),
  request: (id: string) => api.get<QuoteRequest>(`/quotes/requests/${id}`),
  updateRequest: (id: string, input: { status?: RequestStatus; staffNote?: string | null }) =>
    api.patch<QuoteRequest>(`/quotes/requests/${id}`, input),
  /** A staff counter-offer: a new revision priced from the link. */
  reviseRequest: (id: string, input: { items: Selection[]; hardwarePlan: HardwarePlan; note?: string; revealPrices?: boolean }) =>
    api.post<QuoteRequest>(`/quotes/requests/${id}/revise`, input),
  /** Innowi's countersignature on a client-signed revision. */
  countersignRequest: (id: string, input: Omit<SignInput, "revisionNo">) =>
    api.post<QuoteRequest>(`/quotes/requests/${id}/countersign`, input),
  /** Same-origin URL (through the /api/v1 proxy, which adds the login) for the proposal PDF. */
  requestPdfUrl: (id: string, rev?: number) => `/api/v1/quotes/requests/${id}/pdf${rev ? `?rev=${rev}` : ""}`,
};
