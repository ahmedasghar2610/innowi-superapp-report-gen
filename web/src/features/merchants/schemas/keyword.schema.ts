import { z } from "zod";
import { KEYWORD_TYPE } from "@/features/merchants/types/enums";
import type { Keyword, CreateKeywordInput, UpdateKeywordInput } from "@/features/merchants/types";
import type { DirtyMap } from "./_shared";

/**
 * Validation for the Keyword form, mirroring CreateKeywordDto. Both fields are
 * required: `term` is the search phrase (≤ 200 chars) and `type` is the
 * workbook column it came from (Primary / Secondary / Location).
 */

export const keywordSchema = z.object({
  term: z
    .string()
    .trim()
    .min(1, "Term is required.")
    .max(200, "Term must be 200 characters or fewer."),
  type: z.enum(KEYWORD_TYPE),
});

export type KeywordFormValues = z.infer<typeof keywordSchema>;

export const keywordDefaults: KeywordFormValues = {
  term: "",
  type: "PRIMARY",
};

export function keywordToFormValues(k: Keyword): KeywordFormValues {
  return {
    term: k.term,
    type: k.type,
  };
}

/** Build the POST body — both fields are always sent. */
export function toCreateKeywordInput(values: KeywordFormValues): CreateKeywordInput {
  return { term: values.term.trim(), type: values.type };
}

/** Build a PATCH body from only changed fields. */
export function toUpdateKeywordInput(
  values: KeywordFormValues,
  dirty: DirtyMap<KeywordFormValues>,
): UpdateKeywordInput {
  const out: UpdateKeywordInput = {};
  if (dirty.term) out.term = values.term.trim();
  if (dirty.type) out.type = values.type;
  return out;
}
