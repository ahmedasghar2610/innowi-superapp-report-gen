import { api } from "../client";
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
} from "@/features/library/types";

/** Ops CRM Library pages and credentials vault (modules/ops/library.py). */
export const library = {
  tree(merchantId?: string): Promise<LibraryPageSummary[]> {
    return api.getList<LibraryPageSummary>("/ops/library", { merchantId });
  },
  get(id: string): Promise<LibraryPage> {
    return api.get<LibraryPage>(`/ops/library/${id}`);
  },
  create(input: CreateLibraryPageInput): Promise<LibraryPage> {
    return api.post<LibraryPage>("/ops/library", input);
  },
  update(id: string, input: UpdateLibraryPageInput): Promise<LibraryPage> {
    return api.patch<LibraryPage>(`/ops/library/${id}`, input);
  },
  remove(id: string): Promise<void> {
    return api.del(`/ops/library/${id}`);
  },
  versions(id: string): Promise<LibraryVersion[]> {
    return api.getList<LibraryVersion>(`/ops/library/${id}/versions`);
  },
};

export const credentials = {
  list(merchantId?: string): Promise<CredentialsResponse> {
    return api.get<CredentialsResponse>("/ops/credentials", { merchantId });
  },
  create(input: CredentialInput): Promise<Credential> {
    return api.post<Credential>("/ops/credentials", input);
  },
  update(id: string, input: CredentialInput): Promise<Credential> {
    return api.patch<Credential>(`/ops/credentials/${id}`, input);
  },
  remove(id: string): Promise<void> {
    return api.del(`/ops/credentials/${id}`);
  },
  reveal(id: string, reason: string): Promise<{ id: string; secret: string }> {
    return api.post(`/ops/credentials/${id}/reveal`, { reason });
  },
  log(merchantId?: string): Promise<CredentialLogEntry[]> {
    return api.getList<CredentialLogEntry>("/ops/credentials/log", { merchantId });
  },
};
