"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { documents } from "@/lib/api/resources/documents";
import { queryKeys } from "@/lib/query/query-keys";
import type { ApiError } from "@/lib/api/client";
import type { MutationOpts } from "@/lib/query/hook-types";
import type { Document, CreateDocumentInput, UpdateDocumentInput, UploadDocumentInput } from "@/features/merchants/types";
import { createChildResourceHooks } from "./create-child-resource-hooks";
import { invalidateProfileDerived } from "./invalidate-profile-derived";

/* Documents hooks — generated from the shared child-resource factory. §8. */
const hooks = createChildResourceHooks<Document, CreateDocumentInput, UpdateDocumentInput>({
  key: queryKeys.merchants.documents,
  list: documents.list,
  create: documents.create,
  update: documents.update,
  remove: documents.remove,
});

export const useDocuments = hooks.useList;
export const useCreateDocument = hooks.useCreate;
export const useUpdateDocument = hooks.useUpdate;
export const useDeleteDocument = hooks.useDelete;

/**
 * POST /merchants/:merchantId/documents/upload — multipart. Not part of the
 * factory (it takes a File, not a JSON input) but invalidates the same caches:
 * the document list, and the derived completeness views since a menu upload
 * can close a "Missing Files" gap.
 */
export function useUploadDocument(
  options?: MutationOpts<Document, { merchantId: string; file: File; input: UploadDocumentInput }>,
) {
  const qc = useQueryClient();
  return useMutation<Document, ApiError, { merchantId: string; file: File; input: UploadDocumentInput }>({
    mutationFn: ({ merchantId, file, input }) => documents.upload(merchantId, file, input),
    ...options,
    onSuccess: (data, vars, ctx) => {
      qc.invalidateQueries({ queryKey: queryKeys.merchants.documents(vars.merchantId) });
      invalidateProfileDerived(qc, vars.merchantId);
      options?.onSuccess?.(data, vars, ctx);
    },
  });
}
