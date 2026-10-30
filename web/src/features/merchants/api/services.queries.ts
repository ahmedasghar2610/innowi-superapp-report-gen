"use client";

import { services } from "@/lib/api/resources/services";
import { queryKeys } from "@/lib/query/query-keys";
import type {
  MerchantService,
  CreateMerchantServiceInput,
  UpdateMerchantServiceInput,
} from "@/features/merchants/types";
import { createChildResourceHooks } from "./create-child-resource-hooks";

/* Service (entitlement) hooks — generated from the shared child-resource
   factory. §7. Create = activate, delete = deactivate (prefer PATCH
   {status:"INACTIVE"} to keep history — see RemoveServiceDialog). */
const hooks = createChildResourceHooks<
  MerchantService,
  CreateMerchantServiceInput,
  UpdateMerchantServiceInput
>({
  key: queryKeys.merchants.services,
  list: services.list,
  create: services.create,
  update: services.update,
  remove: services.remove,
});

export const useServices = hooks.useList;
export const useActivateService = hooks.useCreate;
export const useUpdateService = hooks.useUpdate;
export const useDeactivateService = hooks.useDelete;
