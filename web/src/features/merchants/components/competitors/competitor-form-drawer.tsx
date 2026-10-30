"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Field, Input, useToast } from "@/components/ui";
import { useCreateCompetitor, useUpdateCompetitor } from "@/features/merchants/api";
import { FormDrawer } from "../shared/form-drawer";
import { isApiError } from "@/lib/api/client";
import type { Competitor } from "@/features/merchants/types";
import {
  competitorSchema,
  competitorDefaults,
  competitorToFormValues,
  toCreateCompetitorInput,
  toUpdateCompetitorInput,
  type CompetitorFormValues,
} from "@/features/merchants/schemas/competitor.schema";

const FORM_ID = "competitor-form";

/**
 * Create / edit a merchant competitor in a drawer. Passing `competitor` is
 * edit mode (seeds the form, PATCHes only changed fields); omitting it is
 * create (POST). `name` is required; `rank` is optional (blank = unranked).
 */
export function CompetitorFormDrawer({
  merchantId,
  open,
  onClose,
  competitor,
}: {
  merchantId: string;
  open: boolean;
  onClose: () => void;
  competitor?: Competitor;
}) {
  const { toast } = useToast();
  const isEdit = !!competitor;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, dirtyFields },
  } = useForm<CompetitorFormValues>({
    resolver: zodResolver(competitorSchema),
    defaultValues: competitorDefaults,
  });

  useEffect(() => {
    if (open) reset(competitor ? competitorToFormValues(competitor) : competitorDefaults);
  }, [open, competitor, reset]);

  const createCompetitor = useCreateCompetitor();
  const updateCompetitor = useUpdateCompetitor();
  const busy = createCompetitor.isPending || updateCompetitor.isPending;

  function onFail(err: unknown, fallback: string) {
    toast({
      variant: "error",
      title: fallback,
      description: isApiError(err) ? err.messages[0] : "Something went wrong. Please try again.",
    });
  }

  const onSubmit = handleSubmit((values) => {
    if (isEdit && competitor) {
      const input = toUpdateCompetitorInput(values, dirtyFields);
      if (Object.keys(input).length === 0) {
        toast({ variant: "info", title: "No changes to save" });
        onClose();
        return;
      }
      updateCompetitor.mutate(
        { merchantId, id: competitor.id, input },
        {
          onSuccess: (c) => {
            toast({ variant: "success", title: "Competitor updated", description: c.name });
            onClose();
          },
          onError: (err) => onFail(err, "Couldn't update competitor"),
        },
      );
    } else {
      const input = toCreateCompetitorInput(values);
      createCompetitor.mutate(
        { merchantId, input },
        {
          onSuccess: (c) => {
            toast({ variant: "success", title: "Competitor added", description: c.name });
            onClose();
          },
          onError: (err) => onFail(err, "Couldn't add competitor"),
        },
      );
    }
  });

  return (
    <FormDrawer
      open={open}
      onClose={onClose}
      size="md"
      title={isEdit ? "Edit competitor" : "New competitor"}
      description={isEdit ? (competitor?.name ?? "Competitor") : "Add a local business this merchant competes with."}
      formId={FORM_ID}
      submitLabel={isEdit ? "Save changes" : "Add competitor"}
      busy={busy}
    >
      <form id={FORM_ID} onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <Field label="Name" htmlFor="name" required error={errors.name?.message}>
          <Input id="name" placeholder="Business name" aria-invalid={!!errors.name} {...register("name")} />
        </Field>
        <Field
          label="Rank"
          htmlFor="rank"
          hint="1 = primary competitor. Leave blank if unranked."
          error={errors.rank?.message}
        >
          <Input
            id="rank"
            type="number"
            inputMode="numeric"
            min={1}
            max={99}
            step={1}
            placeholder="e.g. 1"
            aria-invalid={!!errors.rank}
            {...register("rank")}
          />
        </Field>
      </form>
    </FormDrawer>
  );
}
