"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Paperclip, X } from "lucide-react";
import { Button, Field, Input, Select, useToast } from "@/components/ui";
import { useUploadBrandAsset } from "@/features/merchants/api";
import { BRAND_ASSET_TYPE, type BrandAssetType } from "@/features/merchants/types";
import { brandAssetType as brandAssetTypeLabels } from "@/lib/enums";
import { isApiError } from "@/lib/api/client";
import { FormDrawer } from "../shared/form-drawer";

const FORM_ID = "upload-brand-asset-form";

const uploadSchema = z.object({
  type: z.enum(BRAND_ASSET_TYPE),
  name: z.string().trim().max(160, "Name must be 160 characters or fewer."),
});

type UploadFormValues = z.infer<typeof uploadSchema>;

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
 * Upload a brand asset (multipart). The file goes in the `file` part; type and
 * an optional display name are the only form fields — MIME, size and uploader
 * are derived server-side. `defaultType` pre-selects the asset class.
 */
export function UploadBrandAssetDrawer({
  merchantId,
  open,
  onClose,
  defaultType = "LOGO",
}: {
  merchantId: string;
  open: boolean;
  onClose: () => void;
  defaultType?: BrandAssetType;
}) {
  const { toast } = useToast();
  const fileInputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<UploadFormValues>({
    resolver: zodResolver(uploadSchema),
    defaultValues: { type: defaultType, name: "" },
  });

  useEffect(() => {
    if (open) {
      reset({ type: defaultType, name: "" });
      setFile(null);
      setFileError(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [open, defaultType, reset]);

  const upload = useUploadBrandAsset();

  function onFail(err: unknown) {
    const description = isApiError(err)
      ? err.status === 413
        ? "File is larger than the upload limit."
        : err.messages[0]
      : "Something went wrong. Please try again.";
    toast({ variant: "error", title: "Couldn't upload asset", description });
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
        input: { type: values.type, ...(values.name ? { name: values.name } : {}) },
      },
      {
        onSuccess: (a) => {
          toast({ variant: "success", title: `Uploaded ${a.name ?? file.name}` });
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
      title="Upload asset"
      description="Logo, menu, image, video or guidelines the platform will hold for this brand."
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

        <Field label="Type" htmlFor="asset-type" required error={errors.type?.message}>
          <Select id="asset-type" aria-invalid={!!errors.type} {...register("type")}>
            {BRAND_ASSET_TYPE.map((t) => (
              <option key={t} value={t}>
                {brandAssetTypeLabels[t] ?? t}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Name" htmlFor="asset-name" error={errors.name?.message}>
          <Input
            id="asset-name"
            placeholder="Defaults to the file name"
            aria-invalid={!!errors.name}
            {...register("name")}
          />
        </Field>
      </form>
    </FormDrawer>
  );
}
