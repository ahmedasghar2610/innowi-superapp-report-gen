import type { DocumentCategory, DocumentStatus, Id, ISODateString } from "./enums";

/**
 * Document metadata (contract, tax, menu, consent, brand asset, report).
 * Maps to Brand Assets §6.2.5 + onboarding files. Metadata only — there is no
 * upload endpoint; the file lives in external storage and `storageUrl` points
 * at it. API_REFERENCE.md §8.
 */
export interface Document {
  id: Id;
  merchantId: Id;
  locationId: Id | null; // must belong to the same merchant
  category: DocumentCategory;
  fileName: string;
  storageUrl: string; // S3 key / path — NOT URL-format validated
  mimeType: string | null;
  sizeBytes: number | null;
  version: number; // default 1; versioning is manual
  uploadedBy: string | null; // free text; becomes a user id on Day 3
  status: DocumentStatus;
  /** True when the platform holds the bytes (uploaded); false for a hand-recorded reference. */
  hasFile: boolean;
  /** Relative API path to stream the file, or null when `hasFile` is false. Use `api.fileUrl()`. */
  downloadPath: string | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

/** CreateDocumentDto — category, fileName, storageUrl required. */
export interface CreateDocumentInput {
  category: DocumentCategory;
  fileName: string;
  storageUrl: string;
  locationId?: Id;
  mimeType?: string;
  sizeBytes?: number;
  version?: number;
  uploadedBy?: string;
  status?: DocumentStatus;
}

/**
 * UpdateDocumentDto = Partial<Create>. Optional fields may also be sent as
 * `null` to clear them (each is `@IsOptional()`). The required trio
 * (category / fileName / storageUrl), version and status are never null.
 */
export type UpdateDocumentInput = {
  category?: DocumentCategory;
  fileName?: string;
  storageUrl?: string;
  version?: number;
  status?: DocumentStatus;
  locationId?: Id | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  uploadedBy?: string | null;
};

/**
 * POST /merchants/:merchantId/documents/upload — multipart. Only the form
 * fields; the file goes in the `file` part. Everything else (name, mime, size,
 * uploader) is derived server-side.
 */
export interface UploadDocumentInput {
  category: DocumentCategory;
  locationId?: string;
  version?: number;
}
