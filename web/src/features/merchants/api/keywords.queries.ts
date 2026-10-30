"use client";

import { keywords } from "@/lib/api/resources/keywords";
import { queryKeys } from "@/lib/query/query-keys";
import type { Keyword, CreateKeywordInput, UpdateKeywordInput } from "@/features/merchants/types";
import { createChildResourceHooks } from "./create-child-resource-hooks";

/* Keyword hooks — generated from the shared child-resource factory. Keywords are
   not a scored completeness section, but the factory's derived-view
   invalidation is cheap and keeps the behaviour uniform. */
const hooks = createChildResourceHooks<Keyword, CreateKeywordInput, UpdateKeywordInput>({
  key: queryKeys.merchants.keywords,
  list: keywords.list,
  create: keywords.create,
  update: keywords.update,
  remove: keywords.remove,
});

export const useKeywords = hooks.useList;
export const useCreateKeyword = hooks.useCreate;
export const useUpdateKeyword = hooks.useUpdate;
export const useDeleteKeyword = hooks.useDelete;
