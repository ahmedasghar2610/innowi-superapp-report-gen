"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Paperclip, X } from "lucide-react";
import { Button, Field, Input, Select, useToast } from "@/components/ui";
import { useLocations, useUploadDocument } from "@/features/merchants/api";
import { DOCUMENT_CATEGORY } from "@/features/merchants/types";
import { documentCategory } from "@/lib/enums";
import { isApiError } from "@/lib/api/client";
import type { Location } from "@/features/merchants/types";
import { FormDrawer } from "../shared/form-drawer";

const FORM_ID = "upload-document-form";

const uploadSchema = z.object({
  category: z.enum(DOCUMENT_CATEGORY),
  locationId: z.string(), // "" = merchant-level
  version: z
    .string()
    .trim()
    .refine((v) => /^\d+$/.test(v) && Number(v) >= 1, "Version must be a whole number of 1 or more."),
});

type UploadFormValues = z.infer<typeof uploadSchema>;

const uploadDefaults: UploadFormValues = { category: "CONTRACT", locationId: "", version: "1" };

function locationLabel(l: Location) {
  return l.address || [l.city, l.state].filter(Boolean).join(", ") || `Location ${l.id.slice(0, 6)}`;
}

/** Bytes → compact human size (e.g. 248000 → "242 KB"). */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
}

/**
 * Upload a file to the merchant's documents (multipart). The file goes in the
 * `file` part; category / location / version are the only form fields — name,
 * MIME type, size and uploader are derived server-side.
 */
export function UploadDocumentDrawer({
  merchantId,
  open,
  onClose,
}: {
  merchantId: string;
  open: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const fileInputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const { data: locations } = useLocations(merchantId, { enabled: open });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<UploadFormValues>({
    resolver: zodResolver(uploadSchema),
    defaultValues: uploadDefaults,
  });

  useEffect(() => {
    if (open) {
      reset(uploadDefaults);
      setFile(null);
      setFileError(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [open, reset]);

  const upload = useUploadDocument();

  function onFail(err: unknown) {
    const description = isApiError(err)
      ? err.status === 413
        ? "File is larger than the upload limit."
        : err.messages[0]
      : "Something went wrong. Please try again.";
    toast({ variant: "error", title: "Couldn't upload file", description });
  }

  const onSubmit = handleSubmit((values) => {
    if (!file) {
      setFileError("Choose a file to upload.");
      return;
    }
    upload.mutate(
      {
        merchantId,
        file,
        input: {
          category: values.category,
          version: Number(values.version),
          ...(values.locationId ? { locationId: values.locationId } : {}),
        },
      },
      {
        onSuccess: (d) => {
          toast({ variant: "success", title: `Uploaded ${d.fileName}` });
          onClose();
        },
        onError: onFail,
      },
    );
  });

  function clearFile() {
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <FormDrawer
      open={open}
      onClose={onClose}
      size="md"
      title="Upload file"
      description="The platform stores the file and records its metadata for you."
      formId={FORM_ID}
      submitLabel="Upload"
      busy={upload.isPending}
    >
      <form id={FORM_ID} onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <Field
          label="File"
          htmlFor={fileInputId}
          required
          hint="Up to 4 MB."
          error={fileError ?? undefined}
        >
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              id={fileInputId}
              type="file"
              className="sr-only"
              onChange={(e) => {
                const next = e.target.files?.[0] ?? null;
                setFile(next);
                if (next) setFileError(null);
              }}
            />
            <Button variant="outline" type="button" onClick={() => fileInputRef.current?.click()}>
              <Paperclip className="size-4" />
              Choose file
            </Button>
            {file ? (
              <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-muted px-2.5 py-1.5 text-table">
                <span className="min-w-0 flex-1 truncate text-foreground" title={file.name}>
                  {file.name}
                </span>
                <span className="shrink-0 text-muted-foreground">{formatBytes(file.size)}</span>
                <Button variant="ghost" size="icon-sm" type="button" aria-label="Remove file" onClick={clearFile}>
                  <X className="size-4" />
                </Button>
              </div>
            ) : (
              <span className="text-table text-muted-foreground">No file chosen</span>
            )}
          </div>
        </Field>

        <Field label="Category" htmlFor="upload-category" required error={errors.category?.message}>
          <Select id="upload-category" aria-invalid={!!errors.category} {...register("category")}>
            {DOCUMENT_CATEGORY.map((c) => (
              <option key={c} value={c}>
                {documentCategory[c] ?? c}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Attach to location"
          htmlFor="upload-locationId"
          hint="Optional — must belong to this merchant."
          error={errors.locationId?.message}
        >
          <Select id="upload-locationId" aria-invalid={!!errors.locationId} {...register("locationId")}>
            <option value="">Merchant-level</option>
            {(locations ?? []).map((l) => (
              <option key={l.id} value={l.id}>
                {locationLabel(l)}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Version" htmlFor="upload-version" error={errors.version?.message} className="sm:w-40">
          <Input
            id="upload-version"
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            aria-invalid={!!errors.version}
            {...register("version")}
          />
        </Field>
      </form>
    </FormDrawer>
  );
}
