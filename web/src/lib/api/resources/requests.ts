import { api } from "../client";
import type {
  ApproveInput,
  RequestDetail,
  RequestInput,
  RequestList,
  RequestQuery,
  StatusChangeInput,
} from "@/features/requests/types";

/** /requests — the team's ideas, bugs and complaints (API: app/modules/requests/router.py). */
export const requests = {
  list: (query?: RequestQuery) => api.get<RequestList>("/requests", { ...query }),
  get: (ref: string) => api.get<RequestDetail>(`/requests/${encodeURIComponent(ref)}`),
  create: (input: RequestInput) => api.post<RequestDetail>("/requests", input),
  update: (ref: string, input: Partial<RequestInput>) =>
    api.patch<RequestDetail>(`/requests/${encodeURIComponent(ref)}`, input),
  vote: (ref: string) => api.post<RequestDetail>(`/requests/${encodeURIComponent(ref)}/vote`),
  unvote: (ref: string) => api.del<RequestDetail>(`/requests/${encodeURIComponent(ref)}/vote`),
  comment: (ref: string, body: string) =>
    api.post<RequestDetail>(`/requests/${encodeURIComponent(ref)}/comments`, { body }),
  setStatus: (ref: string, input: StatusChangeInput) =>
    api.post<RequestDetail>(`/requests/${encodeURIComponent(ref)}/status`, input),
  approve: (ref: string, input: ApproveInput) =>
    api.post<RequestDetail>(`/requests/${encodeURIComponent(ref)}/approve`, input),
};
