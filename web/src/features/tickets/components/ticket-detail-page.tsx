"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { Badge, Button, Card, CardBody, Dialog, ErrorState, Input, Skeleton, useToast } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils/cn";
import { useCan } from "@/features/auth/use-can";
import { useAddSubtask, useDeleteTicket, useRemoveSubtask, useTicket, useUpdateSubtask, useUpdateTicket } from "../api";
import {
  REQUEST_TYPE_LABEL,
  STATUS_DOT,
  STATUS_LABEL,
  STATUS_ORDER,
  TYPE_LABEL,
  formatDuration,
  formatTarget,
} from "../labels";
import type { TicketDetail, TicketSla, TicketStatus } from "../types";
import { DueDate, PersonChip, PriorityBadge, SlaLabel, TypeLabel } from "./ticket-bits";
import { TicketActivity } from "./ticket-activity";
import { TicketFormDialog } from "./ticket-form-dialog";
import { TicketAttachments } from "./ticket-attachments";
import { TicketWatchers } from "./ticket-watchers";
import { TicketLibraryCard, TicketMerchantCard } from "./ticket-context";
import { TeamsMeetingButton } from "./teams-meeting-dialog";

/** /ops/tickets/[key] — one ticket: status, description, sub-tasks, activity. */
export function TicketDetailPage({ ticketKey }: { ticketKey: string }) {
  const { data: ticket, isPending, isError, error, refetch } = useTicket(ticketKey);

  if (isPending) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (isError || !ticket) {
    return (
      <ErrorState
        title={error?.status === 404 ? "Ticket not found" : "Couldn't load this ticket"}
        error={error}
        onRetry={error?.status === 404 ? undefined : () => refetch()}
      />
    );
  }
  return <TicketView ticket={ticket} />;
}

function TicketView({ ticket }: { ticket: TicketDetail }) {
  const router = useRouter();
  const can = useCan();
  const { toast } = useToast();
  const update = useUpdateTicket(ticket.key);
  const del = useDeleteTicket();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { canManage, canWork } = ticket.viewer;

  const setStatus = (status: TicketStatus) => {
    if (status === ticket.status) return;
    update.mutate(
      { status },
      { onError: (e) => toast({ variant: "error", title: "Status not changed", description: e.message }) },
    );
  };

  return (
    <div className="flex flex-col gap-5">
      {/* header */}
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium text-muted-foreground tabular">{ticket.key}</span>
            <PriorityBadge priority={ticket.priority} />
            <Badge tone="neutral" icon={false}>
              {TYPE_LABEL[ticket.type]} · {ticket.category}
            </Badge>
            <Badge tone="outline" icon={false}>
              {ticket.project.name}
            </Badge>
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-[-0.011em] text-foreground">{ticket.title}</h1>
          <p className="mt-1 text-table text-muted-foreground">
            {ticket.merchant ? (
              <>
                For{" "}
                <Link href={`/merchants/${ticket.merchant.id}/tickets`} className="text-primary hover:underline">
                  {ticket.merchant.name}
                </Link>
              </>
            ) : (
              "Internal"
            )}
            {ticket.createdBy ? ` · opened by ${ticket.createdBy.name}` : ""} · {formatDateTime(ticket.createdAt)}
            {ticket.meeting ? (
              <>
                {" · from meeting "}
                {can("meetings.view") ? (
                  <Link href={`/ops/meetings/${ticket.meeting.id}`} className="text-primary hover:underline">
                    {ticket.meeting.title}
                  </Link>
                ) : (
                  ticket.meeting.title
                )}
              </>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <TeamsMeetingButton ticket={ticket} />
          {canManage ? (
            <>
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                <Pencil className="size-4" />
                Edit
              </Button>
              <Button variant="outline" size="sm" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="size-4" />
                Delete
              </Button>
            </>
          ) : null}
          {canWork && ticket.status !== "DONE" ? (
            <Button variant="default" size="sm" onClick={() => setStatus("DONE")} loading={update.isPending}>
              <Check className="size-4" />
              Mark done
            </Button>
          ) : null}
        </div>
      </div>

      {/* status bar */}
      <Card>
        <CardBody className="flex flex-wrap items-center gap-2 py-3">
          <span className="mr-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Status</span>
          {STATUS_ORDER.map((s) => {
            const active = s === ticket.status;
            return (
              <button
                key={s}
                type="button"
                disabled={!canWork || update.isPending}
                onClick={() => setStatus(s)}
                aria-pressed={active}
                className={cn(
                  "inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors",
                  active ? "border-foreground bg-foreground text-background" : "border-border bg-card text-foreground",
                  canWork && !active ? "hover:bg-accent" : "",
                  !canWork ? "cursor-default" : "",
                  !canWork && !active ? "opacity-60" : "",
                )}
              >
                <span className={cn("size-2 rounded-full", STATUS_DOT[s])} aria-hidden />
                {STATUS_LABEL[s]}
              </button>
            );
          })}
          {!canWork ? (
            <span className="ml-auto text-xs text-muted-foreground">Only the assignee or a ticket manager can change the status.</span>
          ) : null}
        </CardBody>
      </Card>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-5">
          <Card>
            <CardBody className="flex flex-col gap-2">
              <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Description</h2>
              {ticket.description ? (
                <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">{ticket.description}</p>
              ) : (
                <p className="text-sm text-muted-foreground">No description.</p>
              )}
            </CardBody>
          </Card>

          <Subtasks ticket={ticket} />

          <TicketAttachments ticket={ticket} />

          <Card>
            <CardBody>
              <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Activity</h2>
              <TicketActivity ticketKey={ticket.key} hasMerchant={!!ticket.merchant} />
            </CardBody>
          </Card>
        </div>

        {/* SLA + properties */}
        <div className="flex flex-col gap-5 self-start">
        {ticket.sla ? <SlaPanel sla={ticket.sla} /> : null}
        <TicketWatchers ticket={ticket} />
        <TicketMerchantCard ticket={ticket} />
        <TicketLibraryCard ticket={ticket} />
        <Card>
          <CardBody className="flex flex-col divide-y divide-border py-1">
            <Prop label="Assignee">
              <PersonChip person={ticket.assignee} emptyLabel="Unassigned — reassign this ticket" />
            </Prop>
            <Prop label="Due date">
              <DueDate dueDate={ticket.dueDate} overdue={ticket.isOverdue} />
              {ticket.isOverdue ? <span className="ml-1 text-xs text-text-destructive">overdue</span> : null}
            </Prop>
            <Prop label="Merchant">
              {ticket.merchant ? (
                <Link href={`/merchants/${ticket.merchant.id}/overview`} className="text-sm text-primary hover:underline">
                  {ticket.merchant.name}
                </Link>
              ) : (
                <span className="text-sm text-muted-foreground">Internal</span>
              )}
            </Prop>
            <Prop label="Project">
              <span className="text-sm text-foreground">{ticket.project.name}</span>
            </Prop>
            <Prop label="Type · category">
              <TypeLabel type={ticket.type} category={ticket.category} />
              {ticket.subCategory ? <span className="block text-xs text-muted-foreground">{ticket.subCategory}</span> : null}
            </Prop>
            <Prop label="Request type">
              <span className="text-sm text-foreground">{REQUEST_TYPE_LABEL[ticket.requestType]}</span>
            </Prop>
            <Prop label="Created">
              <span className="text-sm text-foreground">
                {formatDateTime(ticket.createdAt)}
                {ticket.createdBy ? ` · ${ticket.createdBy.name}` : ""}
              </span>
            </Prop>
            {ticket.completedAt ? (
              <Prop label="Completed">
                <span className="text-sm text-foreground">{formatDateTime(ticket.completedAt)}</span>
              </Prop>
            ) : null}
          </CardBody>
        </Card>
        </div>
      </div>

      <TicketFormDialog open={editing} onClose={() => setEditing(false)} ticket={ticket} />

      <Dialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        tone="danger"
        icon={<Trash2 className="size-5" />}
        title={`Delete ${ticket.key}?`}
        description="The ticket, its sub-tasks and comments are removed for everyone. This can't be undone."
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              loading={del.isPending}
              onClick={() =>
                del.mutate(ticket.key, {
                  onSuccess: () => {
                    toast({ variant: "success", title: `${ticket.key} deleted` });
                    router.replace("/ops/tickets");
                  },
                  onError: (e) => toast({ variant: "error", title: "Not deleted", description: e.message }),
                })
              }
            >
              Delete ticket
            </Button>
          </>
        }
      />
    </div>
  );
}

/** First response + resolution clocks, as in the prototype's SLA card. */
function SlaPanel({ sla }: { sla: TicketSla }) {
  const target = sla.targetResolutionHours * 3600;
  const used = sla.state === "met" ? target : Math.min(target, Math.max(0, target - sla.remainingSeconds));
  const pct = Math.round((used / target) * 100);
  const bar =
    sla.state === "breached"
      ? "bg-destructive"
      : sla.state === "at_risk"
        ? "bg-warning"
        : sla.state === "paused"
          ? "bg-muted-foreground"
          : "bg-success";
  const when = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
      : "—";
  const response =
    sla.responseState === "met"
      ? `Met · ${when(sla.firstResponseAt)}`
      : sla.responseState === "breached"
        ? sla.firstResponseAt
          ? `Late · ${when(sla.firstResponseAt)}`
          : `Missed · was due ${when(sla.responseDueAt)}`
        : `Due ${when(sla.responseDueAt)}`;
  return (
    <Card>
      <CardBody className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">SLA</span>
          <SlaLabel sla={sla} />
        </div>
        <div className="flex justify-between gap-3 text-sm">
          <span className="whitespace-nowrap text-muted-foreground">First response</span>
          <span className={cn("text-right", sla.responseState === "breached" ? "text-text-destructive" : "text-foreground")}>
            {response}
          </span>
        </div>
        <div className="flex justify-between gap-3 text-sm">
          <span className="text-muted-foreground">Resolution</span>
          <span className="text-right text-foreground">
            {sla.state === "met"
              ? "Resolved in time"
              : sla.state === "paused"
                ? `Paused · ${formatDuration(sla.remainingSeconds)} left`
                : sla.remainingSeconds < 0
                  ? `${formatDuration(sla.remainingSeconds)} over`
                  : `${formatDuration(sla.remainingSeconds)} left`}
          </span>
        </div>
        <div
          className="h-1.5 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-label="Share of the resolution time used"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className={cn("h-full rounded-full", bar)} style={{ width: `${pct}%` }} />
        </div>
        <p className="text-xs text-muted-foreground">
          Respond within {formatTarget(sla.targetResponseHours)}, resolve within {formatTarget(sla.targetResolutionHours)}.
          Weekends don&apos;t count; the clock pauses while awaiting the merchant.
        </p>
      </CardBody>
    </Card>
  );
}

function Prop({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 py-3">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <div>{children}</div>
    </div>
  );
}

function Subtasks({ ticket }: { ticket: TicketDetail }) {
  const { toast } = useToast();
  const add = useAddSubtask(ticket.key);
  const update = useUpdateSubtask(ticket.key);
  const remove = useRemoveSubtask(ticket.key);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const { canWork } = ticket.viewer;
  const done = ticket.subtasks.filter((s) => s.done).length;

  const submit = () => {
    const t = title.trim();
    if (!t) return;
    add.mutate(t, {
      onSuccess: () => {
        setTitle("");
      },
      onError: (e) => toast({ variant: "error", title: "Sub-task not added", description: e.message }),
    });
  };

  if (!canWork && ticket.subtasks.length === 0) return null;

  return (
    <Card>
      <CardBody className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Sub-tasks · {done} of {ticket.subtasks.length}
          </h2>
          {canWork && !adding ? (
            <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
              <Plus className="size-4" />
              Add sub-task
            </Button>
          ) : null}
        </div>
        {ticket.subtasks.length > 0 ? (
          <ul className="flex flex-col gap-1.5">
            {ticket.subtasks.map((s) => (
              <li key={s.id} className="group flex items-center gap-2.5 rounded-lg bg-muted px-3 py-2">
                <input
                  id={`sub-${s.id}`}
                  type="checkbox"
                  checked={s.done}
                  disabled={!canWork}
                  onChange={(e) =>
                    update.mutate(
                      { id: s.id, done: e.target.checked },
                      { onError: (err) => toast({ variant: "error", title: "Sub-task not updated", description: err.message }) },
                    )
                  }
                  className="size-4 accent-[var(--primary)]"
                />
                <label
                  htmlFor={`sub-${s.id}`}
                  className={cn("flex-1 text-sm", s.done ? "text-muted-foreground line-through" : "text-foreground")}
                >
                  {s.title}
                </label>
                {canWork ? (
                  <button
                    type="button"
                    onClick={() => remove.mutate(s.id)}
                    className="grid size-6 place-items-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                    aria-label={`Remove sub-task ${s.title}`}
                  >
                    <X className="size-3.5" />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        {adding ? (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <label htmlFor="new-subtask" className="sr-only">
              New sub-task
            </label>
            <Input
              id="new-subtask"
              autoFocus
              maxLength={200}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What needs doing?"
              onKeyDown={(e) => {
                if (e.key === "Escape") setAdding(false);
              }}
            />
            <Button type="submit" variant="default" loading={add.isPending} disabled={!title.trim()}>
              Add
            </Button>
            <Button variant="ghost" onClick={() => setAdding(false)}>
              Done
            </Button>
          </form>
        ) : null}
      </CardBody>
    </Card>
  );
}
