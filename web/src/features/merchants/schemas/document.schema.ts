import { z } from "zod";
import { DOCUMENT_CATEGORY, DOCUMENT_STATUS } from "@/features/merchants/types/enums";
import type { CreateDocumentInput, Document, UpdateDocumentInput } from "@/features/merchants/types";
import { optionalText, type DirtyMap } from "./_shared";

/**
 * Validation for the Document form, mirroring CreateDocumentDto (API §8).
 * Metadata only — there is no upload; the file lives in external storage and
 * `storageUrl` records where (an S3 key or path, not URL-format validated).
 * `category`, `fileName` and `storageUrl` are required; `sizeBytes` and
 * `version` are numeric text fields; the rest are optional.
 */

const optionalInt = (label: string) =>
  z.string().trim().refine((v) => v === "" || /^\d+$/.test(v), `${label} must be a whole number.`);

export const documentSchema = z.object({
  category: z.enum(DOCUMENT_CATEGORY),
  fileName: z.string().trim().min(1, "File name is required.").max(260, "File name must be 260 characters or fewer."),
  storageUrl: z
    .string()
    .trim()
    .min(1, "Storage URL is required.")
    .max(1024, "Storage URL must be 1024 characters or fewer."),
  status: z.enum(DOCUMENT_STATUS),
  locationId: z.string(), // "" = none; otherwise a location id
  mimeType: optionalText(160, "MIME type"),
  sizeBytes: optionalInt("Size").refine((v) => v === "" || Number(v) <= 5_000_000_000, "Size looks too large."),
  version: z
    .string()
    .trim()
    .refine((v) => /^\d+$/.test(v) && Number(v) >= 1, "Version must be a whole number of 1 or more."),
  uploadedBy: optionalText(160, "Uploaded by"),
});

export type DocumentFormValues = z.infer<typeof documentSchema>;

export const documentDefaults: DocumentFormValues = {
  category: "CONTRACT",
  fileName: "",
  storageUrl: "",
  status: "ACTIVE",
  locationId: "",
  mimeType: "",
  sizeBytes: "",
  version: "1",
  uploadedBy: "",
};

export function documentToFormValues(d: Document): DocumentFormValues {
  return {
    category: d.category,
    fileName: d.fileName ?? "",
    storageUrl: d.storageUrl ?? "",
    status: d.status,
    locationId: d.locationId ?? "",
    mimeType: d.mimeType ?? "",
    sizeBytes: d.sizeBytes != null ? String(d.sizeBytes) : "",
    version: d.version != null ? String(d.version) : "1",
    uploadedBy: d.uploadedBy ?? "",
  };
}

/** Build the POST body — required trio always, optionals only when present. */
export function toCreateDocumentInput(values: DocumentFormValues): CreateDocumentInput {
  const out: CreateDocumentInput = {
    category: values.category,
    fileName: values.fileName.trim(),
    storageUrl: values.storageUrl.trim(),
    status: values.status,
    version: Number(values.version),
  };
  if (values.locationId) out.locationId = values.locationId;
  if (values.mimeType.trim()) out.mimeType = values.mimeType.trim();
  if (values.sizeBytes) out.sizeBytes = Number(values.sizeBytes);
  if (values.uploadedBy.trim()) out.uploadedBy = values.uploadedBy.trim();
  return out;
}

/** Build a PATCH body from only changed fields; cleared optionals → null. */
export function toUpdateDocumentInput(
  values: DocumentFormValues,
  dirty: DirtyMap<DocumentFormValues>,
): UpdateDocumentInput {
  const out: UpdateDocumentInput = {};
  if (dirty.category) out.category = values.category;
  if (dirty.fileName) out.fileName = values.fileName.trim();
  if (dirty.storageUrl) out.storageUrl = values.storageUrl.trim();
  if (dirty.status) out.status = values.status;
  if (dirty.version) out.version = Number(values.version);
  if (dirty.locationId) out.locationId = values.locationId || null;
  if (dirty.mimeType) out.mimeType = values.mimeType.trim() || null;
  if (dirty.sizeBytes) out.sizeBytes = values.sizeBytes ? Number(values.sizeBytes) : null;
  if (dirty.uploadedBy) out.uploadedBy = values.uploadedBy.trim() || null;
  return out;
}
