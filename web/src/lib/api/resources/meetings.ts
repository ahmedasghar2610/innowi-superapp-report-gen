import { api } from "../client";
import type { PagedEnvelope } from "@/types/api";
import type { FathomStatus, MeetingDetail, MeetingListQuery, MeetingSummary, UpdateMeetingInput } from "@/features/meetings/types";

/** Ops CRM meetings from Fathom (modules/ops/meetings.py). */
export const meetings = {
  list(query: MeetingListQuery = {}): Promise<PagedEnvelope<MeetingSummary>> {
    return api.getPage<MeetingSummary>("/ops/meetings", query);
  },
  get(id: string): Promise<MeetingDetail> {
    return api.get<MeetingDetail>(`/ops/meetings/${id}`);
  },
  status(): Promise<FathomStatus> {
    return api.get<FathomStatus>("/ops/meetings/status");
  },
  sync(): Promise<{ fetched: number; added: number; updated: number }> {
    return api.postLong("/ops/meetings/sync");
  },
  update(id: string, input: UpdateMeetingInput): Promise<MeetingDetail> {
    return api.patch<MeetingDetail>(`/ops/meetings/${id}`, input);
  },
  remove(id: string): Promise<void> {
    return api.del(`/ops/meetings/${id}`);
  },
  dismiss(id: string, actionId: string): Promise<MeetingDetail> {
    return api.post<MeetingDetail>(`/ops/meetings/${id}/actions/${actionId}/dismiss`);
  },
  reopen(id: string, actionId: string): Promise<MeetingDetail> {
    return api.post<MeetingDetail>(`/ops/meetings/${id}/actions/${actionId}/reopen`);
  },
};
