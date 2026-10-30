"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { credentials, library } from "@/lib/api/resources/library";
import { queryKeys } from "@/lib/query/query-keys";
import type { ApiError } from "@/lib/api/client";
import type {
  CreateLibraryPageInput,
  Credential,
  CredentialInput,
  CredentialLogEntry,
  CredentialsResponse,
  LibraryPage,
  LibraryPageSummary,
  LibraryVersion,
  UpdateLibraryPageInput,
} from "./types";

export function useLibraryTree() {
  return useQuery<LibraryPageSummary[], ApiError>({ queryKey: queryKeys.library.tree(), queryFn: () => library.tree() });
}

export function useLibraryPage(id: string | undefined) {
  return useQuery<LibraryPage, ApiError>({
    queryKey: queryKeys.library.page(id ?? ""),
    queryFn: () => library.get(id as string),
    enabled: !!id,
  });
}

export function useLibraryVersions(id: string, enabled: boolean) {
  return useQuery<LibraryVersion[], ApiError>({
    queryKey: queryKeys.library.versions(id),
    queryFn: () => library.versions(id),
    enabled,
  });
}

export function useCreateLibraryPage() {
  const qc = useQueryClient();
  return useMutation<LibraryPage, ApiError, CreateLibraryPageInput>({
    mutationFn: (input) => library.create(input),
    onSuccess: (page) => {
      qc.setQueryData(queryKeys.library.page(page.id), page);
      qc.invalidateQueries({ queryKey: queryKeys.library.tree() });
    },
  });
}

export function useUpdateLibraryPage(id: string) {
  const qc = useQueryClient();
  return useMutation<LibraryPage, ApiError, UpdateLibraryPageInput>({
    mutationFn: (input) => library.update(id, input),
    onSuccess: (page) => {
      qc.setQueryData(queryKeys.library.page(id), page);
      qc.invalidateQueries({ queryKey: queryKeys.library.tree() });
      qc.invalidateQueries({ queryKey: queryKeys.library.versions(id) });
    },
  });
}

export function useDeleteLibraryPage() {
  const qc = useQueryClient();
  return useMutation<void, ApiError, string>({
    mutationFn: (id) => library.remove(id),
    onSuccess: (_, id) => {
      qc.removeQueries({ queryKey: queryKeys.library.page(id) });
      qc.invalidateQueries({ queryKey: queryKeys.library.tree() });
    },
  });
}

export function useCredentials(merchantId?: string) {
  return useQuery<CredentialsResponse, ApiError>({
    queryKey: queryKeys.credentials.list(merchantId),
    queryFn: () => credentials.list(merchantId),
  });
}

export function useCredentialLog(merchantId: string | undefined, enabled: boolean) {
  return useQuery<CredentialLogEntry[], ApiError>({
    queryKey: queryKeys.credentials.log(merchantId),
    queryFn: () => credentials.log(merchantId),
    enabled,
  });
}

function useInvalidateCredentials() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: queryKeys.credentials.all });
}

export function useSaveCredential() {
  const invalidate = useInvalidateCredentials();
  return useMutation<Credential, ApiError, { id?: string; input: CredentialInput }>({
    mutationFn: ({ id, input }) => (id ? credentials.update(id, input) : credentials.create(input)),
    onSuccess: () => invalidate(),
  });
}

export function useDeleteCredential() {
  const invalidate = useInvalidateCredentials();
  return useMutation<void, ApiError, string>({ mutationFn: (id) => credentials.remove(id), onSuccess: () => invalidate() });
}

export function useRevealCredential() {
  const invalidate = useInvalidateCredentials();
  return useMutation<{ id: string; secret: string }, ApiError, { id: string; reason: string }>({
    mutationFn: ({ id, reason }) => credentials.reveal(id, reason),
    onSuccess: () => invalidate(), // the access log changed
  });
}
