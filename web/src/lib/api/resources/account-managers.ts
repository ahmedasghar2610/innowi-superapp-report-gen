import { api } from "../client";
import type {
  AccountManager,
  CreateAccountManagerInput,
  UpdateAccountManagerInput,
} from "@/features/merchants/types";

/* Account managers — flat reference list (not merchant-scoped). No delete endpoint. */
export type {
  AccountManager,
  MerchantAccountManager,
  CreateAccountManagerInput,
  UpdateAccountManagerInput,
} from "@/features/merchants/types";

export const accountManagers = {
  /** GET /account-managers (alphabetical, with merchant counts). */
  list(): Promise<AccountManager[]> {
    return api.getList<AccountManager>("/account-managers");
  },
  /** GET /account-managers/:id */
  get(id: string): Promise<AccountManager> {
    return api.get<AccountManager>(`/account-managers/${id}`);
  },
  /** POST /account-managers — manager/admin only; 409 on a duplicate email. */
  create(input: CreateAccountManagerInput): Promise<AccountManager> {
    return api.post<AccountManager>("/account-managers", input);
  },
  /** PATCH /account-managers/:id — manager/admin only. */
  update(id: string, input: UpdateAccountManagerInput): Promise<AccountManager> {
    return api.patch<AccountManager>(`/account-managers/${id}`, input);
  },
};
