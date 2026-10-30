"use client";

import { connections } from "@/lib/api/resources/connections";
import { queryKeys } from "@/lib/query/query-keys";
import type { Connection, CreateConnectionInput, UpdateConnectionInput } from "@/features/merchants/types";
import { createChildResourceHooks } from "./create-child-resource-hooks";

/* Connections hooks — generated from the shared child-resource factory. §9. */
const hooks = createChildResourceHooks<Connection, CreateConnectionInput, UpdateConnectionInput>({
  key: queryKeys.merchants.connections,
  list: connections.list,
  create: connections.create,
  update: connections.update,
  remove: connections.remove,
});

export const useConnections = hooks.useList;
export const useCreateConnection = hooks.useCreate;
export const useUpdateConnection = hooks.useUpdate;
export const useDeleteConnection = hooks.useDelete;
