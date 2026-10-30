"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { History, Pencil, Trash2 } from "lucide-react";
import { Badge, Button, Card, CardBody, Dialog, ErrorState, Input, Skeleton, Textarea, useToast } from "@/components/ui";
import { useTickets } from "@/features/tickets/api";
import { PriorityBadge, StatusLabel } from "@/features/tickets/components/ticket-bits";
import type { TicketStatus } from "@/features/tickets/types";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils/cn";
import { useDeleteLibraryPage, useLibraryPage, useLibraryVersions, useUpdateLibraryPage } from "../api";
import { SECTION_LABEL, type LibraryPage } from "../types";
import { CredentialsPanel } from "./credentials-panel";
import { useCan } from "@/features/auth/use-can";
import { Markdown } from "./markdown";

/** /ops/library/[id] — read a page, edit it (Markdown with preview), see its history. */
export function LibraryPageView({ pageId }: { pageId: string }) {
  const { data: page, isPending, isError, error, refetch } = useLibraryPage(pageId);
  if (isPending)
    return (
      <Card>
        <CardBody className="flex flex-col gap-3">
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
        </CardBody>
      </Card>
    );
  if (isError || !page)
    return (
      <ErrorState
        title={error?.status === 404 ? "Page not found" : "Couldn't load this page"}
        error={error}
        onRetry={error?.status === 404 ? undefined : () => refetch()}
      />
    );
  return <PageBody key={page.id} page={page} />;
}

function PageBody({ page }: { page: LibraryPage }) {
  const router = useRouter();
  const params = useSearchParams();
  const { toast } = useToast();
  const update = useUpdateLibraryPage(page.id);
  const del = useDeleteLibraryPage();
  const can = useCan();
  const [editing, setEditing] = useState(params.get("edit") === "1");
  const [title, setTitle] = useState(page.title);
  const [body, setBody] = useState(page.body);
  const [baseVersion, setBaseVersion] = useState(page.version);
  const [showHistory, setShowHistory] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const startEdit = () => {
    setTitle(page.title);
    setBody(page.body);
    setBaseVersion(page.version);
    setSaveError(null);
    setEditing(true);
  };
  useEffect(() => {
    if (params.get("edit") === "1") router.replace(`/ops/library/${page.id}`, { scroll: false });
  }, [params, page.id, router]);

  const dirty = title !== page.title || body !== page.body;
  // Warn before leaving the tab with unsaved edits.
  useEffect(() => {
    if (!editing || !dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [editing, dirty]);

  const save = () => {
    setSaveError(null);
    if (!title.trim()) return setSaveError("The title can't be empty");
    update.mutate(
      { title: title.trim(), body, baseVersion },
      {
        onSuccess: () => {
          setEditing(false);
          toast({ variant: "success", title: "Page saved" });
        },
        onError: (e) => setSaveError(e.messages?.join(" · ") ?? e.message),
      },
    );
  };

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardBody className="flex flex-col gap-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              {editing ? (
                <>
                  <label htmlFor="lp-edit-title" className="sr-only">
                    Title
                  </label>
                  <Input
                    id="lp-edit-title"
                    value={title}
                    maxLength={200}
                    onChange={(e) => setTitle(e.target.value)}
                    className="h-10 text-lg font-semibold"
                  />
                </>
              ) : (
                <h2 className="text-xl font-semibold text-foreground">
                  {page.merchant ? `${page.merchant.name} · ` : ""}
                  {page.title}
                </h2>
              )}
              <p className="mt-1 text-xs text-muted-foreground">
                {SECTION_LABEL[page.section]}
                {page.owner ? ` · Owner: ${page.owner.name}` : ""} · updated {formatDateTime(page.updatedAt)}
                {page.updatedBy ? ` by ${page.updatedBy.name}` : ""}
                {page.merchant ? (
                  <>
                    {" · "}
                    <Link href={`/merchants/${page.merchant.id}/overview`} className="text-primary hover:underline">
                      Open merchant
                    </Link>
                  </>
                ) : null}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="outline" icon={false}>
                v{page.version}
              </Badge>
              {editing ? (
                <>
                  <Button variant="outline" size="sm" onClick={() => setEditing(false)} disabled={update.isPending}>
                    Cancel
                  </Button>
                  <Button variant="default" size="sm" onClick={save} loading={update.isPending} disabled={!dirty}>
                    Save
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="outline" size="sm" onClick={() => setShowHistory(true)} disabled={page.version === 1}>
                    <History className="size-4" />
                    History
                  </Button>
                  {page.canDelete ? (
                    <Button variant="outline" size="sm" onClick={() => setConfirmDelete(true)}>
                      <Trash2 className="size-4" />
                      Delete
                    </Button>
                  ) : null}
                  {can("library.edit") && (
                    <Button variant="default" size="sm" onClick={startEdit}>
                      <Pencil className="size-4" />
                      Edit
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>

          {saveError ? (
            <p role="alert" className="rounded-lg bg-destructive-subtle px-3 py-2 text-sm text-text-destructive">
              {saveError}
            </p>
          ) : null}

          {editing ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="lp-body" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Markdown
                </label>
                <Textarea
                  id="lp-body"
                  rows={22}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  className="font-mono text-[13px] leading-relaxed"
                  placeholder={"## Logo\nUse the wordmark on all storefront and print.\n\n## Colours\n- Tea green #1F6F5C\n- Honey #F4C95D"}
                />
                <p className="text-xs text-muted-foreground">
                  ## heading · - bullet · **bold** · *italic* · [link](https://…) · hex codes like #1F6F5C show a swatch
                </p>
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Preview</span>
                <div className="min-h-40 rounded-lg border border-dashed border-border p-4">
                  <Markdown source={body} />
                </div>
              </div>
            </div>
          ) : (
            <Markdown source={page.body} />
          )}
        </CardBody>
      </Card>

      {page.linkedTickets?.length && !editing ? (
        <Card>
          <CardBody className="flex flex-col gap-2">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Linked tickets · {page.linkedTickets.length}</h3>
            <ul className="flex flex-col divide-y divide-border">
              {page.linkedTickets.map((t) => (
                <li key={t.key} className="flex items-center gap-3 py-2">
                  <Link href={`/ops/tickets/${t.key}`} className="shrink-0 text-sm font-medium text-primary tabular hover:underline">
                    {t.key}
                  </Link>
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">{t.title}</span>
                  <StatusLabel status={t.status as TicketStatus} className="shrink-0 text-xs" />
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}

      {page.merchant && !editing ? (
        <>
          <MerchantTickets merchantId={page.merchant.id} merchantName={page.merchant.name} />
          {can("credentials.view") && (
            <CredentialsPanel merchantId={page.merchant.id} title={`Logins for ${page.merchant.name}`} compact />
          )}
        </>
      ) : null}

      <HistoryDialog page={page} open={showHistory} onClose={() => setShowHistory(false)} />

      <Dialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        tone="danger"
        icon={<Trash2 className="size-5" />}
        title={`Delete “${page.title}”?`}
        description="The page and its history are removed for everyone. This can't be undone."
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              loading={del.isPending}
              onClick={() =>
                del.mutate(page.id, {
                  onSuccess: () => {
                    toast({ variant: "success", title: "Page deleted" });
                    router.replace("/ops/library");
                  },
                  onError: (e) => toast({ variant: "error", title: "Not deleted", description: e.message }),
                })
              }
            >
              Delete page
            </Button>
          </>
        }
      />
    </div>
  );
}

function MerchantTickets({ merchantId, merchantName }: { merchantId: string; merchantName: string }) {
  const { data, isPending } = useTickets({ merchantId, view: "open", limit: 6, sort: "priority" });
  const rows = data?.data ?? [];
  return (
    <Card>
      <CardBody className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Open tickets for {merchantName}</h3>
          <Link href={`/merchants/${merchantId}/tickets`} className="text-xs text-primary hover:underline">
            All tickets
          </Link>
        </div>
        {isPending ? (
          <Skeleton className="h-4 w-2/3" />
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No open tickets.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {rows.map((t) => (
              <li key={t.id}>
                <Link href={`/ops/tickets/${t.key}`} className="flex items-center gap-3 py-2 text-sm hover:bg-muted/50">
                  <span className="w-20 shrink-0 text-xs text-muted-foreground tabular">{t.key}</span>
                  <PriorityBadge priority={t.priority} />
                  <span className="min-w-0 flex-1 truncate font-medium text-foreground">{t.title}</span>
                  <StatusLabel status={t.status} className="hidden sm:inline-flex" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function HistoryDialog({ page, open, onClose }: { page: LibraryPage; open: boolean; onClose: () => void }) {
  const { data, isPending } = useLibraryVersions(page.id, open);
  const [selected, setSelected] = useState<number | null>(null);
  const shown = data?.find((v) => v.version === selected) ?? data?.[0];
  return (
    <Dialog open={open} onClose={onClose} size="3xl" title="Page history" description={`Now on version ${page.version}. Earlier versions:`}>
      {isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : !data?.length ? (
        <p className="text-sm text-muted-foreground">No earlier versions.</p>
      ) : (
        <div className="grid max-h-[60vh] gap-4 sm:grid-cols-[12rem_minmax(0,1fr)]">
          <ul className="flex flex-col gap-1 overflow-y-auto">
            {data.map((v) => (
              <li key={v.version}>
                <button
                  type="button"
                  onClick={() => setSelected(v.version)}
                  className={cn(
                    "w-full rounded-md px-2 py-1.5 text-left text-sm",
                    shown?.version === v.version ? "bg-accent text-primary-subtle-foreground" : "hover:bg-muted",
                  )}
                >
                  <span className="font-medium">v{v.version}</span>
                  <span className="block text-xs text-muted-foreground">
                    {v.editedBy ? `by ${v.editedBy.name} · ` : ""}replaced {formatDateTime(v.createdAt)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {shown ? (
            <div className="overflow-y-auto rounded-lg border border-border p-4">
              <p className="mb-2 text-sm font-semibold text-foreground">{shown.title}</p>
              <Markdown source={shown.body} />
            </div>
          ) : null}
        </div>
      )}
    </Dialog>
  );
}
