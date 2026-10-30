"use client";

import { promotions } from "@/lib/api/resources/promotions";
import { queryKeys } from "@/lib/query/query-keys";
import type { Promotion, CreatePromotionInput, UpdatePromotionInput } from "@/features/merchants/types";
import { createChildResourceHooks } from "./create-child-resource-hooks";

/* Promotions hooks — generated from the shared child-resource factory.
   PRD Appendix C-7 / PROF-01 §6.2.4. */
const hooks = createChildResourceHooks<Promotion, CreatePromotionInput, UpdatePromotionInput>({
  key: queryKeys.merchants.promotions,
  list: promotions.list,
  create: promotions.create,
  update: promotions.update,
  remove: promotions.remove,
});

export const usePromotions = hooks.useList;
export const useCreatePromotion = hooks.useCreate;
export const useUpdatePromotion = hooks.useUpdate;
export const useDeletePromotion = hooks.useDelete;
