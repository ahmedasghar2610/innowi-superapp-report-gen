"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, CircleSlash, ExternalLink, Link2, Pencil, Play, Plus, RotateCcw, Search, Trash2 } from "lucide-react";
import { Badge, Button, Card, Dialog, ErrorState, Input, Select, Skeleton, Textarea, useToast } from "@/components/ui";
import { useCan } from "@/features/auth/use-can";
import { Markdown } from "@/features/library/components/markdown";
import { useTicketProjects } from "@/features/tickets/api";
import { MerchantSelect } from "@/features/tickets/components/merchant-select";
import { TicketFormDialog } from "@/features/tickets/components/ticket-form-dialog";
import { STATUS_DOT, STATUS_LABEL } from "@/features/tickets/labels";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils/cn";
import { useDeleteMeeting, useDismissAction, useInvalidateMeetings, useMeeting, useReopenAction, useUpdateMeeting } from "../api";
import type { ActionItem, MeetingDetail, TicketMini } from "../types";

const errorText = (e: unknown) => (e as { messages?: string[] })?.messages?.[0] ?? (e as Error)?.message ?? "Something went wrong";

export function MeetingDetailPage({ id }: { id: string }) {
  const { data: m, isPending, error, refetch } = useMeeting(id);
  if (isPending) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (error || !m) return <ErrorState title="Couldn't load this meeting" description={errorText(error)} onRetry={() => void refetch()} />;
  return <Loaded m={m} />;
}

function Loaded({ m }: { m: MeetingDetail }) {
  const router = useRouter();
  const can = useCan();
  const { toast } = useToast();
  const remove = useDeleteMeeting();
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href="/ops/meetings" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Meetings
        </Link>
        <div className="mt-2 flex flex-wrap items-start gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              {m.hasSummary ? <Badge tone="success">Notes ready</Badge> : <Badge tone="neutral">Processing</Badge>}
              {m.project && <Badge tone="outline" icon={false}>{m.project.name}</Badge>}
              {m.source === "DEMO" && <Badge tone="outline" icon={false}>Sample</Badge>}
            </div>
            <h1 className="mt-2 text-2xl font-semibold tracking-[-0.011em] text-foreground">{m.title}</h1>
            <p className="mt-1 text-table text-muted-foreground">
              {m.startedAt ? formatDateTime(m.startedAt) : "Date unknown"}
              {m.durationMinutes != null ? ` · ${m.durationMinutes} min` : ""}
              {m.merchant ? (
                <>
                  {" · "}
                  <Link href={`/merchants/${m.merchant.id}/profile`} className="text-primary hover:underline">
                    {m.merchant.name}
                  </Link>
                </>
              ) : (
                " · Internal"
              )}
              {m.recordedBy ? ` · recorded by ${m.recordedBy}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {m.fathomUrl && (
              <a href={m.fathomUrl} target="_blank" rel="noopener noreferrer">
                <Button size="sm">
                  <ExternalLink className="size-4" />
                  Open in Fathom
                </Button>
              </a>
            )}
            {m.shareUrl && (
              <Button
                size="sm"
                onClick={() =>
                  navigator.clipboard?.writeText(m.shareUrl!).then(() => toast({ title: "Share link copied", description: "Paste it in Teams or an email." }))
                }
              >
                <Link2 className="size-4" />
                Copy share link
              </Button>
            )}
            {can("settings.manage") && (
              <Button size="sm" variant="ghost" aria-label="Delete meeting" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="size-4" />
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-5">
          <SummaryCard m={m} />
          <ActionItemsCard m={m} />
          <TranscriptCard m={m} />
        </div>
        <div className="flex flex-col gap-5">
          <DetailsCard m={m} />
          <AttendeesCard m={m} />
          {m.linkedTickets.length > 0 && (
            <SideCard title="Tickets from this meeting">
              <ul className="flex flex-col gap-2">
                {m.linkedTickets.map((t) => (
                  <li key={t.key}>
                    <TicketChip t={t} />
                  </li>
                ))}
              </ul>
            </SideCard>
          )}
        </div>
      </div>

      <Dialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        tone="danger"
        title="Delete this meeting?"
        description="Removes the notes, transcript and open action items from the Super App. Tickets already made from it stay. The recording in Fathom isn't touched."
        footer={
          <>
            <Button onClick={() => setConfirmDelete(false)}>Cancel</Button>
            <Button
              variant="destructive"
              loading={remove.isPending}
              onClick={() =>
                remove.mutate(m.id, {
                  onSuccess: () => {
                    toast({ title: "Meeting deleted" });
                    router.push("/ops/meetings");
                  },
                  onError: (e) => toast({ variant: "error", title: "Couldn't delete", description: errorText(e) }),
                })
              }
            >
              Delete
            </Button>
          </>
        }
      />
    </div>
  );
}

function CardShell({ title, action, children, hint }: { title: string; action?: React.ReactNode; children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-[18px] py-[13px]">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
        {action}
      </div>
      <div className="p-[18px]">{children}</div>
    </Card>
  );
}

function SideCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="p-4">
      <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h2>
      {children}
    </Card>
  );
}

function TicketChip({ t }: { t: TicketMini }) {
  return (
    <Link href={`/ops/tickets/${t.key}`} className="group flex items-center gap-2 text-sm">
      <span className={cn("size-2 shrink-0 rounded-full", STATUS_DOT[t.status])} aria-hidden />
      <span className="shrink-0 whitespace-nowrap font-medium text-primary group-hover:underline">{t.key}</span>
      <span className="truncate text-foreground">{t.title}</span>
      <span className="ml-auto shrink-0 text-xs text-muted-foreground">{STATUS_LABEL[t.status]}</span>
    </Link>
  );
}

/* --------------------------------------------------------------- summary -- */
function SummaryCard({ m }: { m: MeetingDetail }) {
  const update = useUpdateMeeting(m.id);
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(m.summary ?? "");
  return (
    <CardShell
      title="Summary"
      hint={m.source === "DEMO" ? "Sample notes in Fathom's format" : "From Fathom · editable"}
      action={
        m.canManage &&
        !editing && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setText(m.summary ?? "");
              setEditing(true);
            }}
          >
            <Pencil className="size-4" />
            Edit
          </Button>
        )
      }
    >
      {editing ? (
        <div className="flex flex-col gap-2">
          <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={12} aria-label="Summary (Markdown)" className="font-mono text-sm" />
          <div className="flex justify-end gap-2">
            <Button onClick={() => setEditing(false)}>Cancel</Button>
            <Button
              variant="default"
              loading={update.isPending}
              onClick={() =>
                update.mutate(
                  { summary: text },
                  {
                    onSuccess: () => {
                      setEditing(false);
                      toast({ variant: "success", title: "Summary saved" });
                    },
                    onError: (e) => toast({ variant: "error", title: "Couldn't save", description: errorText(e) }),
                  },
                )
              }
            >
              Save
            </Button>
          </div>
        </div>
      ) : m.summary ? (
        // Fathom's summary starts with its own "## Summary" heading; the card has one.
        <Markdown source={m.summary.replace(/^\s*#{1,3}\s*Summary\s*\n/i, "")} />
      ) : (
        <p className="text-sm text-muted-foreground">Fathom hasn&apos;t sent the summary yet. It usually arrives a few minutes after the call.</p>
      )}
    </CardShell>
  );
}

/* ---------------------------------------------------------- action items -- */
function ActionItemsCard({ m }: { m: MeetingDetail }) {
  const dismiss = useDismissAction(m.id);
  const reopen = useReopenAction(m.id);
  const invalidate = useInvalidateMeetings();
  const { toast } = useToast();
  const [creating, setCreating] = useState<ActionItem>();
  const open = m.actionItems.filter((a) => a.status === "OPEN").length;

  return (
    <CardShell
      title={`Action items${m.actionItems.length ? ` · ${open} to review` : ""}`}
      hint={
        m.canManage
          ? "Assignees are matched by email. Turn each one into a ticket or dismiss it."
          : "Aima and Maheen turn these into tickets."
      }
    >
      {m.actionItems.length === 0 ? (
        <p className="text-sm text-muted-foreground">No action items in this meeting.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {m.actionItems.map((a) => (
            <li key={a.id} className={cn("flex flex-wrap items-start gap-3 py-3 first:pt-0 last:pb-0", a.status === "DISMISSED" && "opacity-60")}>
              <div className="min-w-0 flex-1">
                <p className={cn("text-sm text-foreground", a.status === "DISMISSED" && "line-through")}>{a.description}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {a.assignee ? (
                    <>→ {a.assignee.name}</>
                  ) : a.assigneeName ? (
                    <>
                      → {a.assigneeName}
                      {a.assigneeEmail ? ` (${a.assigneeEmail})` : ""} · not on the team
                    </>
                  ) : (
                    "No assignee heard"
                  )}
                  {a.recordingTimestamp && (
                    <>
                      {" · "}
                      {a.playbackUrl ? (
                        <a href={a.playbackUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-primary hover:underline">
                          <Play className="size-3" aria-hidden />
                          {a.recordingTimestamp}
                        </a>
                      ) : (
                        a.recordingTimestamp
                      )}
                    </>
                  )}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {a.status === "TICKET" && a.ticket ? (
                  <Link href={`/ops/tickets/${a.ticket.key}`}>
                    <Badge tone="success" icon={Check}>
                      {a.ticket.key} · {STATUS_LABEL[a.ticket.status]}
                    </Badge>
                  </Link>
                ) : a.status === "DISMISSED" ? (
                  <>
                    <span className="text-xs text-muted-foreground">Dismissed{a.decidedBy ? ` by ${a.decidedBy}` : ""}</span>
                    {m.canManage && (
                      <Button size="icon-sm" variant="ghost" aria-label="Reopen" title="Reopen" onClick={() => reopen.mutate(a.id)}>
                        <RotateCcw />
                      </Button>
                    )}
                  </>
                ) : m.canManage ? (
                  <>
                    <Button size="sm" variant="default" onClick={() => setCreating(a)}>
                      <Plus className="size-4" />
                      Create ticket
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={dismiss.isPending && dismiss.variables === a.id}
                      onClick={() =>
                        dismiss.mutate(a.id, {
                          onSuccess: () => toast({ title: "Dismissed", action: { label: "Undo", onClick: () => reopen.mutate(a.id) } }),
                        })
                      }
                    >
                      <CircleSlash className="size-4" />
                      Dismiss
                    </Button>
                  </>
                ) : (
                  <Badge tone="warning">To review</Badge>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <TicketFormDialog
        open={!!creating}
        onClose={() => setCreating(undefined)}
        actionItemId={creating?.id}
        prefill={
          creating
            ? {
                title: creating.description.slice(0, 200),
                description: `From the meeting “${m.title}”${m.startedAt ? ` on ${formatDateTime(m.startedAt)}` : ""}.${
                  creating.playbackUrl ? `\n\nIn the recording: ${creating.playbackUrl}` : ""
                }`,
                assigneeId: creating.assignee?.id ?? "",
                merchant: m.merchant,
                ...(m.project ? { projectId: m.project.id } : {}),
              }
            : undefined
        }
        onCreated={(key) => {
          void invalidate();
          toast({ variant: "success", title: `${key} created from the meeting` });
        }}
      />
    </CardShell>
  );
}

/* ------------------------------------------------------------ transcript -- */
function TranscriptCard({ m }: { m: MeetingDetail }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const lines = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? m.transcript.filter((l) => l.text.toLowerCase().includes(t) || l.speaker.toLowerCase().includes(t)) : m.transcript;
  }, [m.transcript, q]);
  if (!m.transcript.length) return null;
  return (
    <CardShell
      title="Transcript"
      hint={`${m.transcript.length} lines`}
      action={
        <Button size="sm" variant="ghost" onClick={() => setOpen((v) => !v)}>
          {open ? "Hide" : "Show"}
        </Button>
      }
    >
      {open ? (
        <div className="flex flex-col gap-3">
          <label className="relative max-w-xs">
            <span className="sr-only">Search the transcript</span>
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the transcript" className="pl-8" />
          </label>
          <ol className="flex max-h-[28rem] flex-col gap-2 overflow-y-auto pr-1">
            {lines.map((l, i) => (
              <li key={i} className="text-sm">
                <span className="mr-2 font-mono text-xs text-muted-foreground">{l.timestamp}</span>
                <span className="font-medium text-foreground">{l.speaker}:</span> <span className="text-foreground">{l.text}</span>
              </li>
            ))}
            {!lines.length && <li className="text-sm text-muted-foreground">Nothing matches “{q}”.</li>}
          </ol>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">The full conversation, word for word. Click Show to read or search it.</p>
      )}
    </CardShell>
  );
}

/* --------------------------------------------------------------- details -- */
function DetailsCard({ m }: { m: MeetingDetail }) {
  const update = useUpdateMeeting(m.id);
  const projects = useTicketProjects();
  const { toast } = useToast();
  const fail = (e: unknown) => toast({ variant: "error", title: "Couldn't save", description: errorText(e) });
  return (
    <SideCard title="Details">
      <div className="flex flex-col gap-3">
        <div>
          <div className="mb-1 text-xs text-muted-foreground">Merchant</div>
          {m.canManage ? (
            <MerchantSelect
              value={m.merchant}
              placeholder="Internal — or search a merchant…"
              onChange={(v) => update.mutate({ merchantId: v?.id ?? null }, { onError: fail })}
            />
          ) : (
            <span className="text-sm text-foreground">{m.merchant?.name ?? "Internal"}</span>
          )}
          <div className="mt-1 text-xs text-muted-foreground">
            {m.merchantMatch === "auto" ? "Matched from a guest's email" : m.merchantMatch === "manual" ? "Set by hand" : "No merchant guest matched"}
          </div>
        </div>
        <div>
          <div className="mb-1 text-xs text-muted-foreground">Project</div>
          {m.canManage ? (
            <Select
              aria-label="Project"
              value={m.project?.id ?? ""}
              onChange={(e) => update.mutate({ projectId: e.target.value || null }, { onError: fail })}
            >
              <option value="">None</option>
              {(projects.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          ) : (
            <span className="text-sm text-foreground">{m.project?.name ?? "—"}</span>
          )}
          <div className="mt-1 text-xs text-muted-foreground">New tickets from this meeting go here.</div>
        </div>
        {m.callUrl && (
          <a href={m.callUrl} target="_blank" rel="noopener noreferrer" className="truncate text-xs text-primary hover:underline">
            Call link
          </a>
        )}
      </div>
    </SideCard>
  );
}

function AttendeesCard({ m }: { m: MeetingDetail }) {
  if (!m.attendees.length) return null;
  const sorted = [...m.attendees].sort((a, b) => Number(a.isExternal) - Number(b.isExternal));
  return (
    <SideCard title={`Attendees · ${m.attendees.length}`}>
      <ul className="flex flex-col gap-2">
        {sorted.map((a, i) => (
          <li key={(a.email ?? a.name) + i} className="flex items-center gap-2 text-sm">
            <span
              className={cn(
                "grid size-7 shrink-0 place-items-center rounded-full text-[11px] font-semibold",
                a.isExternal ? "bg-muted text-foreground" : "bg-primary text-primary-foreground",
              )}
            >
              {a.name
                .split(/\s+/)
                .slice(0, 2)
                .map((w) => w[0]?.toUpperCase())
                .join("")}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-foreground">
                {a.name}
                {a.isExternal && <span className="text-muted-foreground"> · guest</span>}
              </div>
              {a.email && <div className="truncate text-xs text-muted-foreground">{a.email}</div>}
            </div>
            <span className="shrink-0 text-xs text-muted-foreground" title={a.spoke ? "Spoke on the call" : "Invited; not heard in the transcript"}>
              {a.spoke ? "spoke" : "quiet / absent"}
            </span>
          </li>
        ))}
      </ul>
    </SideCard>
  );
}
