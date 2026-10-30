"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Field, Input, Select, useToast } from "@/components/ui";
import { useCreateDocument, useUpdateDocument, useLocations } from "@/features/merchants/api";
import { FormDrawer } from "../shared/form-drawer";
import { DOCUMENT_CATEGORY, DOCUMENT_STATUS } from "@/features/merchants/types/enums";
import { isApiError } from "@/lib/api/client";
import { humanize } from "@/lib/format";
import type { Document, Location } from "@/features/merchants/types";
import {
  documentSchema,
  documentDefaults,
  documentToFormValues,
  toCreateDocumentInput,
  toUpdateDocumentInput,
  type DocumentFormValues,
} from "@/features/merchants/schemas/document.schema";

const FORM_ID = "document-form";

function locationLabel(l: Location) {
  return l.address || [l.city, l.state].filter(Boolean).join(", ") || `Location ${l.id.slice(0, 6)}`;
}

/**
 * Create / edit a document (metadata only — NO file upload). The file is assumed
 * to already live in external storage; this records its `storageUrl` plus
 * category, name and metadata. Passing `document` is edit mode (seeds + PATCHes
 * only changed fields); omitting it is create (POST).
 */
export function DocumentFormDrawer({
  merchantId,
  open,
  onClose,
  document,
}: {
  merchantId: string;
  open: boolean;
  onClose: () => void;
  document?: Document;
}) {
  const { toast } = useToast();
  const isEdit = !!document;

  // Locations power the optional "attach to location" select (real API).
  const { data: locations } = useLocations(merchantId, { enabled: open });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, dirtyFields },
  } = useForm<DocumentFormValues>({
    resolver: zodResolver(documentSchema),
    defaultValues: documentDefaults,
  });

  useEffect(() => {
    if (open) reset(document ? documentToFormValues(document) : documentDefaults);
  }, [open, document, reset]);

  const createDoc = useCreateDocument();
  const updateDoc = useUpdateDocument();
  const busy = createDoc.isPending || updateDoc.isPending;

  function onFail(err: unknown, fallback: string) {
    toast({
      variant: "error",
      title: fallback,
      description: isApiError(err) ? err.messages[0] : "Something went wrong. Please try again.",
    });
  }

  const onSubmit = handleSubmit((values) => {
    if (isEdit && document) {
      const input = toUpdateDocumentInput(values, dirtyFields);
      if (Object.keys(input).length === 0) {
        toast({ variant: "info", title: "No changes to save" });
        onClose();
        return;
      }
      updateDoc.mutate(
        { merchantId, id: document.id, input },
        {
          onSuccess: (d) => {
            toast({ variant: "success", title: "Document updated", description: d.fileName });
            onClose();
          },
          onError: (err) => onFail(err, "Couldn't update document"),
        },
      );
    } else {
      const input = toCreateDocumentInput(values);
      createDoc.mutate(
        { merchantId, input },
        {
          onSuccess: (d) => {
            toast({ variant: "success", title: "Document added", description: d.fileName });
            onClose();
          },
          onError: (err) => onFail(err, "Couldn't add document"),
        },
      );
    }
  });

  return (
    <FormDrawer
      open={open}
      onClose={onClose}
      size="md"
      title={isEdit ? "Edit document" : "New document"}
      description={
        isEdit ? (document?.fileName ?? "Document") : "Record a file that already lives in external storage."
      }
      formId={FORM_ID}
      submitLabel={isEdit ? "Save changes" : "Add document"}
      busy={busy}
    >
      <form id={FORM_ID} onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Category" htmlFor="category" required error={errors.category?.message}>
            <Select id="category" aria-invalid={!!errors.category} {...register("category")}>
              {DOCUMENT_CATEGORY.map((c) => (
                <option key={c} value={c}>
                  {humanize(c)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Status" htmlFor="status" error={errors.status?.message}>
            <Select id="status" aria-invalid={!!errors.status} {...register("status")}>
              {DOCUMENT_STATUS.map((s) => (
                <option key={s} value={s}>
                  {humanize(s)}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="File name" htmlFor="fileName" required error={errors.fileName?.message}>
          <Input id="fileName" placeholder="e.g. Master Services Agreement.pdf" aria-invalid={!!errors.fileName} {...register("fileName")} />
        </Field>

        <Field
          label="Storage URL"
          htmlFor="storageUrl"
          required
          hint="Where the file already lives — an S3 key or path (no upload here)."
          error={errors.storageUrl?.message}
        >
          <Input id="storageUrl" placeholder="e.g. s3://innowi-docs/merchant/contract.pdf" aria-invalid={!!errors.storageUrl} {...register("storageUrl")} />
        </Field>

        <Field label="Attach to location" htmlFor="locationId" hint="Optional — must belong to this merchant." error={errors.locationId?.message}>
          <Select id="locationId" aria-invalid={!!errors.locationId} {...register("locationId")}>
            <option value="">None (merchant-level)</option>
            {(locations ?? []).map((l) => (
              <option key={l.id} value={l.id}>
                {locationLabel(l)}
              </option>
            ))}
          </Select>
        </Field>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="MIME type" htmlFor="mimeType" error={errors.mimeType?.message}>
            <Input id="mimeType" placeholder="e.g. application/pdf" aria-invalid={!!errors.mimeType} {...register("mimeType")} />
          </Field>
          <Field label="Size (bytes)" htmlFor="sizeBytes" error={errors.sizeBytes?.message}>
            <Input id="sizeBytes" inputMode="numeric" placeholder="e.g. 248000" aria-invalid={!!errors.sizeBytes} {...register("sizeBytes")} />
          </Field>
          <Field label="Version" htmlFor="version" required error={errors.version?.message}>
            <Input id="version" inputMode="numeric" aria-invalid={!!errors.version} {...register("version")} />
          </Field>
        </div>

        <Field label="Uploaded by" htmlFor="uploadedBy" error={errors.uploadedBy?.message}>
          <Input id="uploadedBy" placeholder="e.g. onboarding@innowi.com" aria-invalid={!!errors.uploadedBy} {...register("uploadedBy")} />
        </Field>
      </form>
    </FormDrawer>
  );
}
