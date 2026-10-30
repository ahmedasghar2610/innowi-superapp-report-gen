"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Field, Input, Select, Textarea, useToast } from "@/components/ui";
import { useCreateConnection, useUpdateConnection } from "@/features/merchants/api";
import { FormDrawer } from "../shared/form-drawer";
import { ACCESS_CRITICALITY, ACCESS_STATUS, ACCESS_FLAG } from "@/features/merchants/types/enums";
import { isApiError } from "@/lib/api/client";
import { humanize } from "@/lib/format";
import type { Connection } from "@/features/merchants/types";
import {
  connectionSchema,
  connectionDefaults,
  connectionToFormValues,
  toCreateConnectionInput,
  toUpdateConnectionInput,
  type ConnectionFormValues,
} from "@/features/merchants/schemas/connection.schema";

const FORM_ID = "connection-form";

/**
 * Create / edit an access item (connection) in a drawer. Passing `connection`
 * puts it in edit mode (seeds the form, PATCHes only changed fields); omitting
 * it is create mode (POST). `accessItem` is unique per merchant, so a duplicate
 * name (on create or rename) surfaces the API's 409 inline on that field.
 */
export function ConnectionFormDrawer({
  merchantId,
  open,
  onClose,
  connection,
}: {
  merchantId: string;
  open: boolean;
  onClose: () => void;
  connection?: Connection;
}) {
  const { toast } = useToast();
  const isEdit = !!connection;

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, dirtyFields },
  } = useForm<ConnectionFormValues>({
    resolver: zodResolver(connectionSchema),
    defaultValues: connectionDefaults,
  });

  // Seed the form each time the drawer opens (with the connection, or blank).
  useEffect(() => {
    if (open) reset(connection ? connectionToFormValues(connection) : connectionDefaults);
  }, [open, connection, reset]);

  const createConn = useCreateConnection();
  const updateConn = useUpdateConnection();
  const busy = createConn.isPending || updateConn.isPending;

  function onDuplicate() {
    setError(
      "accessItem",
      { type: "server", message: "An access item with this name already exists." },
      { shouldFocus: true },
    );
  }
  function onFail(err: unknown, fallback: string) {
    if (isApiError(err) && err.isConflict) return onDuplicate();
    toast({
      variant: "error",
      title: fallback,
      description: isApiError(err) ? err.messages[0] : "Something went wrong. Please try again.",
    });
  }

  const onSubmit = handleSubmit((values) => {
    if (isEdit && connection) {
      const input = toUpdateConnectionInput(values, dirtyFields);
      if (Object.keys(input).length === 0) {
        toast({ variant: "info", title: "No changes to save" });
        onClose();
        return;
      }
      updateConn.mutate(
        { merchantId, id: connection.id, input },
        {
          onSuccess: (c) => {
            toast({ variant: "success", title: "Connection updated", description: c.accessItem });
            onClose();
          },
          onError: (err) => onFail(err, "Couldn't update connection"),
        },
      );
    } else {
      const input = toCreateConnectionInput(values);
      createConn.mutate(
        { merchantId, input },
        {
          onSuccess: (c) => {
            toast({ variant: "success", title: "Connection added", description: c.accessItem });
            onClose();
          },
          onError: (err) => onFail(err, "Couldn't add the access item"),
        },
      );
    }
  });

  return (
    <FormDrawer
      open={open}
      onClose={onClose}
      size="lg"
      title={isEdit ? "Edit access item" : "New access item"}
      description={
        isEdit
          ? connection?.accessItem
          : "Track a third-party access item and its request / verification state."
      }
      formId={FORM_ID}
      submitLabel={isEdit ? "Save changes" : "Add access item"}
      busy={busy}
    >
      <form id={FORM_ID} onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        <section className="flex flex-col gap-4">
          <h3 className="text-xs font-semibold text-muted-foreground">Access item</h3>

          <Field label="Access item" htmlFor="accessItem" required error={errors.accessItem?.message}>
            <Input
              id="accessItem"
              placeholder="e.g. Google Business Profile"
              aria-invalid={!!errors.accessItem}
              {...register("accessItem")}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Criticality" htmlFor="criticality" required error={errors.criticality?.message}>
              <Select id="criticality" aria-invalid={!!errors.criticality} {...register("criticality")}>
                {ACCESS_CRITICALITY.map((c) => (
                  <option key={c} value={c}>
                    {humanize(c)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Owner" htmlFor="owner" hint="Who holds or chases this access" error={errors.owner?.message}>
              <Input id="owner" placeholder="e.g. Merchant / Account manager" aria-invalid={!!errors.owner} {...register("owner")} />
            </Field>
          </div>

          <Field label="Why it matters / notes" htmlFor="notes" error={errors.notes?.message}>
            <Textarea id="notes" placeholder="What this access unlocks, and any context…" aria-invalid={!!errors.notes} {...register("notes")} />
          </Field>
        </section>

        <section className="flex flex-col gap-4">
          <h3 className="text-xs font-semibold text-muted-foreground">State</h3>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Status" htmlFor="status" error={errors.status?.message}>
              <Select id="status" aria-invalid={!!errors.status} {...register("status")}>
                {ACCESS_STATUS.map((s) => (
                  <option key={s} value={s}>
                    {humanize(s)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Flag" htmlFor="flag" error={errors.flag?.message}>
              <Select id="flag" aria-invalid={!!errors.flag} {...register("flag")}>
                {ACCESS_FLAG.map((f) => (
                  <option key={f} value={f}>
                    {humanize(f)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Verified" htmlFor="verified" error={errors.verified?.message}>
              <Select id="verified" aria-invalid={!!errors.verified} {...register("verified")}>
                <option value="false">No</option>
                <option value="true">Yes</option>
              </Select>
            </Field>
          </div>
        </section>

        <section className="flex flex-col gap-4">
          <h3 className="text-xs font-semibold text-muted-foreground">Dates</h3>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Date requested" htmlFor="dateRequested" error={errors.dateRequested?.message}>
              <Input id="dateRequested" type="date" aria-invalid={!!errors.dateRequested} {...register("dateRequested")} />
            </Field>
            <Field label="Date received" htmlFor="dateReceived" error={errors.dateReceived?.message}>
              <Input id="dateReceived" type="date" aria-invalid={!!errors.dateReceived} {...register("dateReceived")} />
            </Field>
            <Field label="Verified date" htmlFor="verifiedDate" error={errors.verifiedDate?.message}>
              <Input id="verifiedDate" type="date" aria-invalid={!!errors.verifiedDate} {...register("verifiedDate")} />
            </Field>
            <Field label="Expiry" htmlFor="expiry" hint="For credentials that lapse" error={errors.expiry?.message}>
              <Input id="expiry" type="date" aria-invalid={!!errors.expiry} {...register("expiry")} />
            </Field>
          </div>
        </section>
      </form>
    </FormDrawer>
  );
}
