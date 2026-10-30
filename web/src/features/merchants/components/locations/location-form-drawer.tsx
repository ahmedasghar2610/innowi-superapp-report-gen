"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Field, Input, Select, Textarea, useToast } from "@/components/ui";
import { useCreateLocation, useUpdateLocation } from "@/features/merchants/api";
import { FormDrawer } from "../shared/form-drawer";
import { isApiError } from "@/lib/api/client";
import type { Location } from "@/features/merchants/types";
import {
  locationSchema,
  locationDefaults,
  locationToFormValues,
  toCreateLocationInput,
  toUpdateLocationInput,
  type LocationFormValues,
} from "@/features/merchants/schemas/location.schema";

const FORM_ID = "location-form";

/**
 * Create / edit a merchant location in a drawer. Passing `location` is edit mode
 * (seeds the form, PATCHes only changed fields); omitting it is create (POST).
 * Every field is optional.
 */
export function LocationFormDrawer({
  merchantId,
  open,
  onClose,
  location,
}: {
  merchantId: string;
  open: boolean;
  onClose: () => void;
  location?: Location;
}) {
  const { toast } = useToast();
  const isEdit = !!location;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, dirtyFields },
  } = useForm<LocationFormValues>({
    resolver: zodResolver(locationSchema),
    defaultValues: locationDefaults,
  });

  useEffect(() => {
    if (open) reset(location ? locationToFormValues(location) : locationDefaults);
  }, [open, location, reset]);

  const createLoc = useCreateLocation();
  const updateLoc = useUpdateLocation();
  const busy = createLoc.isPending || updateLoc.isPending;

  function onFail(err: unknown, fallback: string) {
    toast({
      variant: "error",
      title: fallback,
      description: isApiError(err) ? err.messages[0] : "Something went wrong. Please try again.",
    });
  }
  function labelOf(l: Location) {
    return l.address || l.city || "Location";
  }

  const onSubmit = handleSubmit((values) => {
    if (isEdit && location) {
      const input = toUpdateLocationInput(values, dirtyFields);
      if (Object.keys(input).length === 0) {
        toast({ variant: "info", title: "No changes to save" });
        onClose();
        return;
      }
      updateLoc.mutate(
        { merchantId, id: location.id, input },
        {
          onSuccess: (l) => {
            toast({ variant: "success", title: "Location updated", description: labelOf(l) });
            onClose();
          },
          onError: (err) => onFail(err, "Couldn't update location"),
        },
      );
    } else {
      const input = toCreateLocationInput(values);
      createLoc.mutate(
        { merchantId, input },
        {
          onSuccess: (l) => {
            toast({ variant: "success", title: "Location added", description: labelOf(l) });
            onClose();
          },
          onError: (err) => onFail(err, "Couldn't add location"),
        },
      );
    }
  });

  return (
    <FormDrawer
      open={open}
      onClose={onClose}
      size="md"
      title={isEdit ? "Edit location" : "New location"}
      description={isEdit ? (location ? labelOf(location) : "Location") : "Add an address for this merchant."}
      formId={FORM_ID}
      submitLabel={isEdit ? "Save changes" : "Add location"}
      busy={busy}
    >
      <form id={FORM_ID} onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <Field label="Address" htmlFor="address" error={errors.address?.message}>
          <Input id="address" placeholder="Street address" aria-invalid={!!errors.address} {...register("address")} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="City" htmlFor="city" error={errors.city?.message}>
            <Input id="city" aria-invalid={!!errors.city} {...register("city")} />
          </Field>
          <Field label="State" htmlFor="state" error={errors.state?.message}>
            <Input id="state" aria-invalid={!!errors.state} {...register("state")} />
          </Field>
          <Field label="ZIP" htmlFor="zip" error={errors.zip?.message}>
            <Input id="zip" aria-invalid={!!errors.zip} {...register("zip")} />
          </Field>
        </div>

        <Field label="Hours" htmlFor="hours" hint="Free text, e.g. Mon–Fri 11:00–22:00" error={errors.hours?.message}>
          <Textarea id="hours" rows={2} placeholder="Opening hours…" aria-invalid={!!errors.hours} {...register("hours")} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Timezone" htmlFor="timezone" hint="IANA name" error={errors.timezone?.message}>
            <Input id="timezone" placeholder="e.g. America/Los_Angeles" aria-invalid={!!errors.timezone} {...register("timezone")} />
          </Field>
          <Field label="NAP status" htmlFor="napStatus" error={errors.napStatus?.message}>
            <Input id="napStatus" placeholder="e.g. Consistent" aria-invalid={!!errors.napStatus} {...register("napStatus")} />
          </Field>
          <Field label="Primary" htmlFor="isPrimary" error={errors.isPrimary?.message}>
            <Select id="isPrimary" aria-invalid={!!errors.isPrimary} {...register("isPrimary")}>
              <option value="false">No</option>
              <option value="true">Yes</option>
            </Select>
          </Field>
        </div>
      </form>
    </FormDrawer>
  );
}
