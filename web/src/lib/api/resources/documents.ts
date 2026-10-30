import { api } from "../client";
import type { Document, CreateDocumentInput, UpdateDocumentInput, UploadDocumentInput } from "@/features/merchants/types";

/* Documents — two ways in (§8, Step 10):
     `upload`  multipart; the platform stores the bytes and derives the metadata
     `create`  metadata only, for a hand-recorded reference the platform never held
   `hasFile` / `downloadPath` on the row tell them apart. */
export type {
  Document,
  DocumentCategory,
  DocumentStatus,
  CreateDocumentInput,
  UpdateDocumentInput,
  UploadDocumentInput,
} from "@/features/merchants/types";

export const documents = {
  /** GET /merchants/:merchantId/documents (newest first; archived included). */
  list(merchantId: string): Promise<Document[]> {
    return api.getList<Document>(`/merchants/${merchantId}/documents`);
  },

  /** POST /merchants/:merchantId/documents — metadata-only record. */
  create(merchantId: string, input: CreateDocumentInput): Promise<Document> {
    return api.post<Document>(`/merchants/${merchantId}/documents`, input);
  },

  /** POST /merchants/:merchantId/documents/upload — multipart; the platform stores the file. */
  upload(merchantId: string, file: File, input: UploadDocumentInput): Promise<Document> {
    const form = new FormData();
    form.append("file", file, file.name);
    form.append("category", input.category);
    if (input.locationId) form.append("locationId", input.locationId);
    if (input.version !== undefined) form.append("version", String(input.version));
    return api.postForm<Document>(`/merchants/${merchantId}/documents/upload`, form);
  },

  /** PATCH /documents/:id — versioning is manual (bump `version` yourself). */
  update(id: string, input: UpdateDocumentInput): Promise<Document> {
    return api.patch<Document>(`/documents/${id}`, input);
  },

  /** DELETE /documents/:id → 204. Removes the metadata row only; file untouched. */
  remove(id: string): Promise<void> {
    return api.del(`/documents/${id}`);
  },
};
