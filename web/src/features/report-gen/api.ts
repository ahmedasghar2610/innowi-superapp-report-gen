"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ApiError } from "@/lib/api/client";
import type { Queue, Report, ReportGenStatus, SendOutcome, TextPatch } from "./types";

/*
 * The resource client and the query keys live inside the feature on purpose:
 * the shared lib/api/resources and lib/query/query-keys files stay untouched so
 * the feature merges cleanly into the main repository (file 11, decision 2).
 */
export const reportGen = {
  status(): Promise<ReportGenStatus> {
    return api.get<ReportGenStatus>("/report-gen/status");
  },
  queue(month?: string): Promise<Queue> {
    return api.get<Queue>("/report-gen/queue", { month });
  },
  generate(merchantId: string, month?: string): Promise<Report> {
    return api.postLong<Report>(`/report-gen/merchants/${merchantId}/reports`, { month });
  },
  report(id: string): Promise<Report> {
    return api.get<Report>(`/report-gen/reports/${id}`);
  },
  editText(id: string, patch: TextPatch): Promise<Report> {
    return api.patch<Report>(`/report-gen/reports/${id}/text`, patch);
  },
  approve(id: string): Promise<Report> {
    return api.post<Report>(`/report-gen/reports/${id}/approve`);
  },
  remove(id: string): Promise<Report> {
    return api.del<Report>(`/report-gen/reports/${id}`);
  },
  send(id: string, recipients?: string[]): Promise<Report & { send: SendOutcome }> {
    return api.post<Report & { send: SendOutcome }>(`/report-gen/reports/${id}/send`, { recipients });
  },
};

export const keys = {
  all: ["report-gen"] as const,
  status: () => [...keys.all, "status"] as const,
  queue: (month?: string) => [...keys.all, "queue", month ?? ""] as const,
  report: (id: string) => [...keys.all, "report", id] as const,
};

export function useReportGenStatus() {
  return useQuery<ReportGenStatus, ApiError>({ queryKey: keys.status(), queryFn: () => reportGen.status() });
}

export function useQueue(month?: string) {
  return useQuery<Queue, ApiError>({ queryKey: keys.queue(month), queryFn: () => reportGen.queue(month), placeholderData: keepPreviousData });
}

export function useReport(id: string) {
  return useQuery<Report, ApiError>({ queryKey: keys.report(id), queryFn: () => reportGen.report(id) });
}

function useInvalidate() {
  const qc = useQueryClient();
  return (r?: Report) => {
    if (r) qc.setQueryData(keys.report(r.id), r);
    void qc.invalidateQueries({ queryKey: keys.all });
  };
}

export function useGenerate() {
  const done = useInvalidate();
  return useMutation<Report, ApiError, { merchantId: string; month?: string }>({
    mutationFn: ({ merchantId, month }) => reportGen.generate(merchantId, month),
    onSuccess: (r) => done(r),
  });
}

export function useEditText() {
  const done = useInvalidate();
  return useMutation<Report, ApiError, { id: string; patch: TextPatch }>({
    mutationFn: ({ id, patch }) => reportGen.editText(id, patch),
    onSuccess: (r) => done(r),
  });
}

export function useApprove() {
  const done = useInvalidate();
  return useMutation<Report, ApiError, string>({ mutationFn: (id) => reportGen.approve(id), onSuccess: (r) => done(r) });
}

export function useDeleteReport() {
  const done = useInvalidate();
  return useMutation<Report, ApiError, string>({ mutationFn: (id) => reportGen.remove(id), onSuccess: (r) => done(r) });
}

export function useSendReport() {
  const done = useInvalidate();
  return useMutation<Report & { send: SendOutcome }, ApiError, { id: string; recipients?: string[] }>({
    mutationFn: ({ id, recipients }) => reportGen.send(id, recipients),
    onSuccess: (r) => done(r),
  });
}
