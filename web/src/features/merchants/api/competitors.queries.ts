"use client";

import { competitors } from "@/lib/api/resources/competitors";
import { queryKeys } from "@/lib/query/query-keys";
import type { Competitor, CreateCompetitorInput, UpdateCompetitorInput } from "@/features/merchants/types";
import { createChildResourceHooks } from "./create-child-resource-hooks";

/* Competitor hooks — generated from the shared child-resource factory. */
const hooks = createChildResourceHooks<Competitor, CreateCompetitorInput, UpdateCompetitorInput>({
  key: queryKeys.merchants.competitors,
  list: competitors.list,
  create: competitors.create,
  update: competitors.update,
  remove: competitors.remove,
});

export const useCompetitors = hooks.useList;
export const useCreateCompetitor = hooks.useCreate;
export const useUpdateCompetitor = hooks.useUpdate;
export const useDeleteCompetitor = hooks.useDelete;
