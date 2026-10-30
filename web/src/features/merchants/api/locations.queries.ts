"use client";

import { locations } from "@/lib/api/resources/locations";
import { queryKeys } from "@/lib/query/query-keys";
import type { Location, CreateLocationInput, UpdateLocationInput } from "@/features/merchants/types";
import { createChildResourceHooks } from "./create-child-resource-hooks";

/* Locations hooks — generated from the shared child-resource factory. §6. */
const hooks = createChildResourceHooks<Location, CreateLocationInput, UpdateLocationInput>({
  key: queryKeys.merchants.locations,
  list: locations.list,
  create: locations.create,
  update: locations.update,
  remove: locations.remove,
});

export const useLocations = hooks.useList;
export const useCreateLocation = hooks.useCreate;
export const useUpdateLocation = hooks.useUpdate;
export const useDeleteLocation = hooks.useDelete;
