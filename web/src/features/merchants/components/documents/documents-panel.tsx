"use client";

import { useState } from "react";
import { Download, FileText, Plus, Pencil, Trash2, ExternalLink, HardDrive, Upload, UserRound } from "lucide-react";
import { Badge, Button, Card, EmptyState, ErrorState, Skeleton } from "@/components/ui";
import { useDocuments } from "@/features/merchants/api";
import { useCrudManager } from "@/features/merchants/hooks/use-crud-manager";
import { api } from "@/lib/api/client";
import { humanize } from "@/lib/format";
import type { Document } from "@/features/merchants/types";
import { DocumentFormDrawer } from "./document-form-drawer";
import { DeleteDocumentDialog } from "./delete-document-dialog";
import { UploadDocumentDrawer } from "./upload-document-drawer";

/**
 * Documents tab (route: /merchants/[merchantId]/documents). Lists documents —
 * both files the platform stores (uploaded, `hasFile`) and hand-recorded
 * references to external storage — with upload / record / edit / delete, live
 * against the documents API.
 *
 * Rendered as a card list — each document is a row with a file icon, name +
 * storage link, and a meta line for category/status/version/size/uploader.
 */
export function DocumentsPanel({ merchantId }: { merchantId: string }) {
  const { data: rows, isPending, isError, error, refetch } = useDocuments(merchantId);

  const { formOpen, editing, deleting, openCreate, openEdit, closeForm, requestDelete, cancelDelete } =
    useCrudManager<Document>();
  const [uploadOpen, setUploadOpen] = useState(false);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold leading-6 text-foreground">Documents</h2>
          <p className="mt-0.5 text-xs leading-4 text-muted-foreground">
            Upload files for the platform to store, or record a reference to a file that lives elsewhere.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={openCreate}>
            <Plus className="size-4" />
            Record reference
          </Button>
          <Button variant="default" size="sm" onClick={() => setUploadOpen(true)}>
            <Upload className="size-4" />
            Upload file
          </Button>
        </div>
      </div>

      {isError ? (
        <Card>
          <ErrorState title="Couldn't load documents" error={error} onRetry={() => refetch()} />
        </Card>
      ) : isPending ? (
        <DocumentsSkeleton />
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={FileText}
            title="No documents yet"
            description="Upload a contract, tax form, menu or brand asset — or record a reference to one that already lives in external storage."
            action={
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={openCreate}>
                  <Plus className="size-4" />
                  Record reference
                </Button>
                <Button variant="default" size="sm" onClick={() => setUploadOpen(true)}>
                  <Upload className="size-4" />
                  Upload file
                </Button>
              </div>
            }
          />
        </Card>
      ) : (
        <Card>
          <div className="divide-y divide-border">
            {rows.map((d) => (
              <div key={d.id} className="flex flex-wrap items-center gap-4 p-4">
                <div className="grid size-10 shrink-0 place-items-center rounded-full bg-accent text-primary-hover">
                  <FileText className="size-5" />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">{d.fileName}</span>
                    <Badge tone="neutral">{humanize(d.category)}</Badge>
                    <Badge tone={d.status === "ACTIVE" ? "success" : "neutral"}>{humanize(d.status)}</Badge>
                    {d.hasFile ? <Badge tone="success">Stored</Badge> : <Badge tone="neutral">Reference</Badge>}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-table text-muted-foreground">
                    <StorageLink url={d.storageUrl} />
                    <span>v{d.version}</span>
                    {d.sizeBytes != null && (
                      <span className="inline-flex items-center gap-1.5">
                        <HardDrive className="size-4" /> {formatBytes(d.sizeBytes)}
                      </span>
                    )}
                    {d.uploadedBy && (
                      <span className="inline-flex items-center gap-1.5">
                        <UserRound className="size-4" /> {d.uploadedBy}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  {d.hasFile && d.downloadPath && (
                    <a
                      href={api.fileUrl(d.downloadPath)}
                      download={d.fileName}
                      aria-label={`Download ${d.fileName}`}
                      className={ICON_LINK_CLASS}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Download className="size-4" />
                    </a>
                  )}
                  <Button variant="ghost" size="icon-sm" aria-label={`Edit ${d.fileName}`} onClick={() => openEdit(d)}>
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Delete ${d.fileName}`}
                    className="text-muted-foreground hover:text-text-destructive"
                    onClick={() => requestDelete(d)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <DocumentFormDrawer merchantId={merchantId} open={formOpen} onClose={closeForm} document={editing} />
      <DeleteDocumentDialog merchantId={merchantId} document={deleting} onClose={cancelDelete} />
      <UploadDocumentDrawer merchantId={merchantId} open={uploadOpen} onClose={() => setUploadOpen(false)} />
    </div>
  );
}

/** Anchor styled like `<Button variant="ghost" size="icon-sm">` for the download link. */
const ICON_LINK_CLASS =
  "inline-flex size-7 items-center justify-center rounded-md border border-transparent text-foreground transition-colors " +
  "hover:bg-secondary hover:text-foreground focus-visible:outline-none";

/** Render the storage location — a link when it's an http(s) URL, else mono text. */
function StorageLink({ url }: { url: string }) {
  const isHttp = /^https?:\/\//i.test(url);
  if (isHttp) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex max-w-[220px] items-center gap-1 truncate text-primary hover:underline"
      >
        <span className="truncate">{url}</span>
        <ExternalLink className="size-4 shrink-0" />
      </a>
    );
  }
  return (
    <span className="mono max-w-[220px] truncate text-muted-foreground" title={url}>
      {url}
    </span>
  );
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

function DocumentsSkeleton() {
  return (
    <Card>
      <div className="divide-y divide-border">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 p-4">
            <Skeleton className="size-10 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1">
              <Skeleton className="h-3.5 w-48" />
              <Skeleton className="mt-2 h-3 w-56" />
            </div>
            <Skeleton className="h-7 w-16 shrink-0" />
          </div>
        ))}
      </div>
    </Card>
  );
}
