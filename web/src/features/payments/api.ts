import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ApiError } from "@/lib/api/client";
import { queryKeys } from "@/lib/query/query-keys";
import type { MerchantPayments, PaymentMonth, PaymentsImport } from "./types";

const key = (merchantId: string) => [...queryKeys.merchants.all, merchantId, "payments"] as const;

export function useMerchantPayments(merchantId: string) {
  return useQuery<MerchantPayments, ApiError>({ queryKey: key(merchantId), queryFn: () => api.get(`/merchants/${merchantId}/payments`) });
}

export interface PaymentsImportInput {
  file: File;
  dryRun: boolean;
  sheet?: string;
  /** YYYY-MM */
  month?: string;
  /** row key → merchantId | "skip" */
  choices?: Record<string, string>;
}

export function useImportPayments() {
  const qc = useQueryClient();
  return useMutation<PaymentsImport, ApiError, PaymentsImportInput>({
    mutationFn: ({ file, dryRun, sheet, month, choices }) => {
      const form = new FormData();
      form.append("file", file);
      if (sheet) form.append("sheet", sheet);
      if (month) form.append("month", month);
      if (choices) form.append("choices", JSON.stringify(choices));
      return api.postForm<PaymentsImport>(`/merchant-payments/import?dryRun=${dryRun ? "true" : "false"}`, form);
    },
    onSuccess: (_d, vars) => {
      if (!vars.dryRun) void qc.invalidateQueries({ queryKey: queryKeys.merchants.all });
    },
  });
}

export interface PaymentInput {
  month?: string;
  status?: string | null;
  packageType?: string | null;
  contract?: number | null;
  charged?: number | null;
  variance?: number | null;
  ordersRevenue?: number | null;
  commission?: number | null;
  notes?: string | null;
}

function useRefresh(merchantId: string) {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: key(merchantId) });
}

/** Add one month by hand. */
export function useAddPayment(merchantId: string) {
  const refresh = useRefresh(merchantId);
  return useMutation<PaymentMonth, ApiError, PaymentInput>({
    mutationFn: (body) => api.post(`/merchants/${merchantId}/payments`, body),
    onSuccess: refresh,
  });
}

export function useUpdatePayment(merchantId: string) {
  const refresh = useRefresh(merchantId);
  return useMutation<PaymentMonth, ApiError, { id: string; body: PaymentInput }>({
    mutationFn: ({ id, body }) => api.patch(`/merchant-payments/${id}`, body),
    onSuccess: refresh,
  });
}

export function useDeletePayment(merchantId: string) {
  const refresh = useRefresh(merchantId);
  return useMutation<void, ApiError, string>({
    mutationFn: (id) => api.del(`/merchant-payments/${id}`),
    onSuccess: refresh,
  });
}
