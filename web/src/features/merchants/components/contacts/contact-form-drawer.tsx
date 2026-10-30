"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Field, Input, Select, useToast } from "@/components/ui";
import { useCreateContact, useUpdateContact } from "@/features/merchants/api";
import { FormDrawer } from "../shared/form-drawer";
import { CONTACT_ROLE, PREFERRED_CHANNEL, RESPONSIVENESS } from "@/features/merchants/types/enums";
import { isApiError } from "@/lib/api/client";
import { humanize } from "@/lib/format";
import type { Contact } from "@/features/merchants/types";
import {
  contactSchema,
  contactDefaults,
  contactToFormValues,
  toCreateContactInput,
  toUpdateContactInput,
  type ContactFormValues,
} from "@/features/merchants/schemas/contact.schema";

const FORM_ID = "contact-form";

/**
 * Create / edit a merchant contact in a drawer. Passing `contact` is edit mode
 * (seeds the form, PATCHes only changed fields); omitting it is create (POST).
 * `role` is required; everything else is optional.
 */
export function ContactFormDrawer({
  merchantId,
  open,
  onClose,
  contact,
}: {
  merchantId: string;
  open: boolean;
  onClose: () => void;
  contact?: Contact;
}) {
  const { toast } = useToast();
  const isEdit = !!contact;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, dirtyFields },
  } = useForm<ContactFormValues>({
    resolver: zodResolver(contactSchema),
    defaultValues: contactDefaults,
  });

  useEffect(() => {
    if (open) reset(contact ? contactToFormValues(contact) : contactDefaults);
  }, [open, contact, reset]);

  const createContact = useCreateContact();
  const updateContact = useUpdateContact();
  const busy = createContact.isPending || updateContact.isPending;

  function onFail(err: unknown, fallback: string) {
    toast({
      variant: "error",
      title: fallback,
      description: isApiError(err) ? err.messages[0] : "Something went wrong. Please try again.",
    });
  }

  const onSubmit = handleSubmit((values) => {
    if (isEdit && contact) {
      const input = toUpdateContactInput(values, dirtyFields);
      if (Object.keys(input).length === 0) {
        toast({ variant: "info", title: "No changes to save" });
        onClose();
        return;
      }
      updateContact.mutate(
        { merchantId, id: contact.id, input },
        {
          onSuccess: (c) => {
            toast({ variant: "success", title: "Contact updated", description: c.name ?? humanize(c.role) });
            onClose();
          },
          onError: (err) => onFail(err, "Couldn't update contact"),
        },
      );
    } else {
      const input = toCreateContactInput(values);
      createContact.mutate(
        { merchantId, input },
        {
          onSuccess: (c) => {
            toast({ variant: "success", title: "Contact added", description: c.name ?? humanize(c.role) });
            onClose();
          },
          onError: (err) => onFail(err, "Couldn't add contact"),
        },
      );
    }
  });

  return (
    <FormDrawer
      open={open}
      onClose={onClose}
      size="md"
      title={isEdit ? "Edit contact" : "New contact"}
      description={isEdit ? (contact?.name ?? "Contact") : "Add a person tied to this merchant."}
      formId={FORM_ID}
      submitLabel={isEdit ? "Save changes" : "Add contact"}
      busy={busy}
    >
      <form id={FORM_ID} onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Role" htmlFor="role" required error={errors.role?.message}>
            <Select id="role" aria-invalid={!!errors.role} {...register("role")}>
              {CONTACT_ROLE.map((r) => (
                <option key={r} value={r}>
                  {humanize(r)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Name" htmlFor="name" error={errors.name?.message}>
            <Input id="name" placeholder="Full name" aria-invalid={!!errors.name} {...register("name")} />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Email" htmlFor="email" error={errors.email?.message}>
            <Input id="email" type="email" inputMode="email" placeholder="name@example.com" aria-invalid={!!errors.email} {...register("email")} />
          </Field>
          <Field label="Phone" htmlFor="phone" error={errors.phone?.message}>
            <Input id="phone" inputMode="tel" placeholder="e.g. +1 555 010 1234" aria-invalid={!!errors.phone} {...register("phone")} />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Preferred channel" htmlFor="preferredChannel" error={errors.preferredChannel?.message}>
            <Select id="preferredChannel" aria-invalid={!!errors.preferredChannel} {...register("preferredChannel")}>
              <option value="">Not set</option>
              {PREFERRED_CHANNEL.map((ch) => (
                <option key={ch} value={ch}>
                  {humanize(ch)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Language" htmlFor="language" error={errors.language?.message}>
            <Input id="language" placeholder="e.g. English" aria-invalid={!!errors.language} {...register("language")} />
          </Field>
          <Field label="Responsiveness" htmlFor="responsiveness" error={errors.responsiveness?.message}>
            <Select id="responsiveness" aria-invalid={!!errors.responsiveness} {...register("responsiveness")}>
              <option value="">Not set</option>
              {RESPONSIVENESS.map((r) => (
                <option key={r} value={r}>
                  {humanize(r)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </form>
    </FormDrawer>
  );
}
