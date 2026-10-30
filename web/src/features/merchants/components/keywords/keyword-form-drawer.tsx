"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Field, Input, Select, useToast } from "@/components/ui";
import { useCreateKeyword, useUpdateKeyword } from "@/features/merchants/api";
import { FormDrawer } from "../shared/form-drawer";
import { KEYWORD_TYPE } from "@/features/merchants/types/enums";
import { isApiError } from "@/lib/api/client";
import { keywordType } from "@/lib/enums";
import type { Keyword } from "@/features/merchants/types";
import {
  keywordSchema,
  keywordDefaults,
  keywordToFormValues,
  toCreateKeywordInput,
  toUpdateKeywordInput,
  type KeywordFormValues,
} from "@/features/merchants/schemas/keyword.schema";

const FORM_ID = "keyword-form";

/**
 * Create / edit a merchant keyword in a drawer. Passing `keyword` is edit mode
 * (seeds the form, PATCHes only changed fields); omitting it is create (POST).
 * (merchant, term, type) is unique — a 409 from the API is surfaced as
 * "Keyword already exists".
 */
export function KeywordFormDrawer({
  merchantId,
  open,
  onClose,
  keyword,
}: {
  merchantId: string;
  open: boolean;
  onClose: () => void;
  keyword?: Keyword;
}) {
  const { toast } = useToast();
  const isEdit = !!keyword;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, dirtyFields },
  } = useForm<KeywordFormValues>({
    resolver: zodResolver(keywordSchema),
    defaultValues: keywordDefaults,
  });

  useEffect(() => {
    if (open) reset(keyword ? keywordToFormValues(keyword) : keywordDefaults);
  }, [open, keyword, reset]);

  const createKeyword = useCreateKeyword();
  const updateKeyword = useUpdateKeyword();
  const busy = createKeyword.isPending || updateKeyword.isPending;

  function onFail(err: unknown, fallback: string) {
    if (isApiError(err) && err.isConflict) {
      toast({ variant: "error", title: "Keyword already exists", description: err.messages[0] });
      return;
    }
    toast({
      variant: "error",
      title: fallback,
      description: isApiError(err) ? err.messages[0] : "Something went wrong. Please try again.",
    });
  }

  const onSubmit = handleSubmit((values) => {
    if (isEdit && keyword) {
      const input = toUpdateKeywordInput(values, dirtyFields);
      if (Object.keys(input).length === 0) {
        toast({ variant: "info", title: "No changes to save" });
        onClose();
        return;
      }
      updateKeyword.mutate(
        { merchantId, id: keyword.id, input },
        {
          onSuccess: (k) => {
            toast({ variant: "success", title: "Keyword updated", description: k.term });
            onClose();
          },
          onError: (err) => onFail(err, "Couldn't update keyword"),
        },
      );
    } else {
      const input = toCreateKeywordInput(values);
      createKeyword.mutate(
        { merchantId, input },
        {
          onSuccess: (k) => {
            toast({ variant: "success", title: "Keyword added", description: k.term });
            onClose();
          },
          onError: (err) => onFail(err, "Couldn't add keyword"),
        },
      );
    }
  });

  return (
    <FormDrawer
      open={open}
      onClose={onClose}
      size="md"
      title={isEdit ? "Edit keyword" : "New keyword"}
      description={isEdit ? (keyword?.term ?? "Keyword") : "Add a search term this merchant targets."}
      formId={FORM_ID}
      submitLabel={isEdit ? "Save changes" : "Add keyword"}
      busy={busy}
    >
      <form id={FORM_ID} onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <Field label="Term" htmlFor="term" required error={errors.term?.message}>
          <Input id="term" placeholder="e.g. plumber near me" aria-invalid={!!errors.term} {...register("term")} />
        </Field>
        <Field label="Type" htmlFor="type" required error={errors.type?.message}>
          <Select id="type" aria-invalid={!!errors.type} {...register("type")}>
            {KEYWORD_TYPE.map((t) => (
              <option key={t} value={t}>
                {keywordType[t] ?? t}
              </option>
            ))}
          </Select>
        </Field>
      </form>
    </FormDrawer>
  );
}
