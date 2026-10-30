import { api } from "../client";
import type { Connection, CreateConnectionInput, UpdateConnectionInput } from "@/features/merchants/types";

/* Connections (access items) — back the onboarding "blockers" view. §9.
   `accessItem` is unique per merchant (409 on create AND rename). The API sorts
   most-critical first, which is the order the blockers view wants. */
export type {
  Connection,
  AccessCriticality,
  AccessStatus,
  AccessFlag,
  CreateConnectionInput,
  UpdateConnectionInput,
} from "@/features/merchants/types";

export const connections = {
  /** GET /merchants/:merchantId/connections (not paginated; critical first). */
  list(merchantId: string): Promise<Connection[]> {
    return api.getList<Connection>(`/merchants/${merchantId}/connections`);
  },

  /** POST /merchants/:merchantId/connections — 409 on duplicate accessItem. */
  create(merchantId: string, input: CreateConnectionInput): Promise<Connection> {
    return api.post<Connection>(`/merchants/${merchantId}/connections`, input);
  },

  /** PATCH /connections/:id — 409 if a rename collides with an existing item. */
  update(id: string, input: UpdateConnectionInput): Promise<Connection> {
    return api.patch<Connection>(`/connections/${id}`, input);
  },

  /** DELETE /connections/:id → 204. */
  remove(id: string): Promise<void> {
    return api.del(`/connections/${id}`);
  },
};
