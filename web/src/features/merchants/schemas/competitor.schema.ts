import { z } from "zod";
import type { Competitor, CreateCompetitorInput, UpdateCompetitorInput } from "@/features/merchants/types";
import type { DirtyMap } from "./_shared";

/**
 * Validation for the Competitor form, mirroring CreateCompetitorDto. `name` is
 * required (≤ 200 chars). `rank` comes from a native number input so it is kept
 * as a string: "" means unranked, otherwise an integer 1–99. The mappers turn
 * it into a real number (or `null` on a cleared update).
 */

export const competitorSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required.")
    .max(200, "Name must be 200 characters or fewer."),
  rank: z
    .string()
    .trim()
    .refine((v) => v === "" || /^\d+$/.test(v), "Rank must be a whole number.")
    .refine((v) => v === "" || (Number(v) >= 1 && Number(v) <= 99), "Rank must be between 1 and 99."),
});

export type CompetitorFormValues = z.infer<typeof competitorSchema>;

export const competitorDefaults: CompetitorFormValues = {
  name: "",
  rank: "",
};

export function competitorToFormValues(c: Competitor): CompetitorFormValues {
  return {
    name: c.name,
    rank: c.rank === null ? "" : String(c.rank),
  };
}

/** Build the POST body — name always, rank only when set. */
export function toCreateCompetitorInput(values: CompetitorFormValues): CreateCompetitorInput {
  const out: CreateCompetitorInput = { name: values.name.trim() };
  if (values.rank.trim()) out.rank = Number(values.rank);
  return out;
}

/** Build a PATCH body from only changed fields; a cleared rank → null. */
export function toUpdateCompetitorInput(
  values: CompetitorFormValues,
  dirty: DirtyMap<CompetitorFormValues>,
): UpdateCompetitorInput {
  const out: UpdateCompetitorInput = {};
  if (dirty.name) out.name = values.name.trim();
  if (dirty.rank) out.rank = values.rank.trim() ? Number(values.rank) : null;
  return out;
}
