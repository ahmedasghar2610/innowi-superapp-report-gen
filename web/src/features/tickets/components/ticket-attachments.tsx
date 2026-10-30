"use client";

import { useRef, useState } from "react";
import { Download, File as FileIcon, Paperclip, Trash2, Upload } from "lucide-react";
import { Button, Card, CardBody, useToast } from "@/components/ui";
import { api } from "@/lib/api/client";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils/cn";
import { useRemoveAttachment, useUploadAttachment } from "../api";
import type { TicketAttachment, TicketDetail } from "../types";

// The hosted API runs on Vercel, which refuses request bodies over 4.5 MB (API: SERVERLESS_UPLOAD_LIMIT_MB).
const MAX_MB = 4;

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Files on a ticket: drop or pick files; images show a thumbnail. Anyone on
 *  staff can attach; the uploader or a ticket manager can remove. */
export function TicketAttachments({ ticket }: { ticket: TicketDetail }) {
  const items = ticket.attachments ?? [];
  const upload = useUploadAttachment(ticket.key);
  const remove = useRemoveAttachment(ticket.key);
  const { toast } = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(0);

  const send = async (files: FileList | File[]) => {
    const list = Array.from(files);
    for (const f of list) {
      if (f.size > MAX_MB * 1024 * 1024) {
        toast({ variant: "error", title: `${f.name} is too big`, description: `Files can be up to ${MAX_MB} MB.` });
        continue;
      }
      setBusy((b) => b + 1);
      try {
        await upload.mutateAsync(f);
      } catch (e) {
        const err = e as { messages?: string[]; message?: string };
        toast({ variant: "error", title: `Couldn't attach ${f.name}`, description: err.messages?.[0] ?? err.message });
      } finally {
        setBusy((b) => b - 1);
      }
    }
  };

  return (
    <Card>
      <CardBody className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <h2 className="flex-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Attachments{items.length ? ` · ${items.length}` : ""}
          </h2>
          <Button size="sm" variant="outline" loading={busy > 0} onClick={() => input.current?.click()}>
            <Paperclip className="size-4" />
            Add files
          </Button>
          <input
            ref={input}
            type="file"
            multiple
            hidden
            aria-label="Attach files"
            onChange={(e) => {
              if (e.target.files?.length) void send(e.target.files);
              e.target.value = "";
            }}
          />
        </div>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            if (e.dataTransfer.files.length) void send(e.dataTransfer.files);
          }}
          className={cn(
            "flex items-center justify-center gap-2 rounded-lg border border-dashed px-3 py-3 text-xs text-muted-foreground transition-colors",
            drag ? "border-primary bg-accent text-primary-subtle-foreground" : "border-border",
          )}
        >
          <Upload className="size-4" aria-hidden />
          {busy > 0 ? `Uploading ${busy} file${busy === 1 ? "" : "s"}…` : `Drop files here — images, PDFs, documents up to ${MAX_MB} MB`}
        </div>

        {items.length > 0 && (
          <ul className="grid gap-2 sm:grid-cols-2">
            {items.map((a) => (
              <AttachmentRow
                key={a.id}
                a={a}
                deleting={remove.isPending && remove.variables === a.id}
                onDelete={() =>
                  remove.mutate(a.id, {
                    onSuccess: () => toast({ title: `Removed ${a.fileName}` }),
                    onError: (e) => toast({ variant: "error", title: "Couldn't remove it", description: e.messages?.[0] }),
                  })
                }
              />
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function AttachmentRow({ a, onDelete, deleting }: { a: TicketAttachment; onDelete: () => void; deleting: boolean }) {
  const href = api.fileUrl(a.downloadPath);
  return (
    <li className="flex items-center gap-3 rounded-lg border border-border p-2">
      <a
        href={a.isImage ? `${href}?inline=1` : href}
        target={a.isImage ? "_blank" : undefined}
        rel="noopener noreferrer"
        className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-md bg-muted"
        title={a.isImage ? "Open the image" : "Download"}
      >
        {a.isImage ? (
          // eslint-disable-next-line @next/next/no-img-element -- authenticated API image, not a static asset
          <img src={`${href}?inline=1`} alt={a.fileName} className="size-full object-cover" loading="lazy" />
        ) : (
          <FileIcon className="size-5 text-muted-foreground" aria-hidden />
        )}
      </a>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-foreground" title={a.fileName}>
          {a.fileName}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {formatBytes(a.sizeBytes)} · {a.uploadedBy?.name ?? "—"} · {formatDateTime(a.createdAt)}
        </div>
      </div>
      <a href={href} aria-label={`Download ${a.fileName}`} title="Download" className="grid size-7 place-items-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground">
        <Download className="size-4" />
      </a>
      {a.canDelete && (
        <Button size="icon-sm" variant="ghost" aria-label={`Remove ${a.fileName}`} title="Remove" loading={deleting} onClick={onDelete}>
          <Trash2 />
        </Button>
      )}
    </li>
  );
}
