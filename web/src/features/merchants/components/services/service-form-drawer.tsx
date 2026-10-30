"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Field, Input, Select, Textarea, useToast } from "@/components/ui";
import { useActivateService, useUpdateService, useServiceCatalog } from "@/features/merchants/api";
import { FormDrawer } from "../shared/form-drawer";
import { MERCHANT_SERVICE_STATUS } from "@/features/merchants/types/enums";
import { isApiError } from "@/lib/api/client";
import { humanize } from "@/lib/format";
import type { MerchantService } from "@/features/merchants/types";
import {
  serviceSchema,
  serviceDefaults,
  serviceToFormValues,
  toCreateMerchantServiceInput,
  toUpdateMerchantServiceInput,
  type ServiceFormValues,
} from "@/features/merchants/schemas/service.schema";

const FORM_ID = "service-form";

/**
 * Add (activate) or edit a merchant service. Add mode shows the catalogue
 * picker (via `useServiceCatalog`, backed by the Catalog API's
 * `GET /services` — services already linked are filtered out to avoid the
 * 409); edit mode shows the service read-only (`serviceId` isn't updatable
 * per the DTO) and lets you change status / activated date / notes.
 */
export function ServiceFormDrawer({
  merchantId,
  open,
  onClose,
  service,
  takenServiceIds,
}: {
  merchantId: string;
  open: boolean;
  onClose: () => void;
  service?: MerchantService;
  takenServiceIds: string[];
}) {
  const { toast } = useToast();
  const isEdit = !!service;

  const { data: catalog } = useServiceCatalog();
  const taken = new Set(takenServiceIds);
  const available = (catalog ?? []).filter((c) => !taken.has(c.id));

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, dirtyFields },
  } = useForm<ServiceFormValues>({
    resolver: zodResolver(serviceSchema),
    defaultValues: serviceDefaults,
  });

  useEffect(() => {
    if (open) reset(service ? serviceToFormValues(service) : serviceDefaults);
  }, [open, service, reset]);

  const activate = useActivateService();
  const update = useUpdateService();
  const busy = activate.isPending || update.isPending;

  function onFail(err: unknown, fallback: string) {
    toast({
      variant: "error",
      title: fallback,
      description: isApiError(err) ? err.messages[0] : "Something went wrong. Please try again.",
    });
  }

  const onSubmit = handleSubmit((values) => {
    if (isEdit && service) {
      const input = toUpdateMerchantServiceInput(values, dirtyFields);
      if (Object.keys(input).length === 0) {
        toast({ variant: "info", title: "No changes to save" });
        onClose();
        return;
      }
      update.mutate(
        { merchantId, id: service.id, input },
        {
          onSuccess: (s) => {
            toast({ variant: "success", title: "Service updated", description: s.serviceName });
            onClose();
          },
          onError: (err) => onFail(err, "Couldn't update service"),
        },
      );
    } else {
      if (!values.serviceId) {
        setError("serviceId", { type: "manual", message: "Choose a service to add." }, { shouldFocus: true });
        return;
      }
      const input = toCreateMerchantServiceInput(values);
      activate.mutate(
        { merchantId, input },
        {
          onSuccess: (s) => {
            toast({ variant: "success", title: "Service added", description: s.serviceName });
            onClose();
          },
          onError: (err) => {
            if (isApiError(err) && err.isConflict) {
              setError(
                "serviceId",
                { type: "server", message: "This service is already active for the merchant." },
                { shouldFocus: true },
              );
              return;
            }
            onFail(err, "Couldn't add service");
          },
        },
      );
    }
  });

  return (
    <FormDrawer
      open={open}
      onClose={onClose}
      size="md"
      title={isEdit ? "Edit service" : "Add service"}
      description={isEdit ? service?.serviceName : "Activate a catalogue service for this merchant."}
      formId={FORM_ID}
      submitLabel={isEdit ? "Save changes" : "Add service"}
      busy={busy}
      submitDisabled={!isEdit && available.length === 0}
    >
      <form id={FORM_ID} onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {isEdit ? (
          <Field label="Service">
            <div className="flex h-8 items-center rounded-md border border-border bg-muted px-2.5 text-table text-foreground">
              {service?.serviceName}
              <span className="ml-2 text-xs text-muted-foreground">({humanize(service?.serviceCategory ?? "")})</span>
            </div>
          </Field>
        ) : available.length === 0 ? (
          <div className="rounded-md border border-border bg-muted px-3 py-6 text-center text-table text-muted-foreground">
            Every catalogue service is already linked to this merchant.
          </div>
        ) : (
          <Field label="Service" htmlFor="serviceId" required hint="From the catalogue (temporary list until the catalogue API ships)." error={errors.serviceId?.message}>
            <Select id="serviceId" aria-invalid={!!errors.serviceId} {...register("serviceId")}>
              <option value="">Select a service…</option>
              {available.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} — {humanize(s.category)}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Status" htmlFor="status" error={errors.status?.message}>
            <Select id="status" aria-invalid={!!errors.status} {...register("status")}>
              {MERCHANT_SERVICE_STATUS.map((s) => (
                <option key={s} value={s}>
                  {humanize(s)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Activated date" htmlFor="activatedAt" error={errors.activatedAt?.message}>
            <Input id="activatedAt" type="date" aria-invalid={!!errors.activatedAt} {...register("activatedAt")} />
          </Field>
        </div>

        <Field label="Notes" htmlFor="notes" error={errors.notes?.message}>
          <Textarea id="notes" placeholder="Anything relevant to this entitlement…" aria-invalid={!!errors.notes} {...register("notes")} />
        </Field>
      </form>
    </FormDrawer>
  );
}
