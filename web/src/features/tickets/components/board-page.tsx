"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CheckSquare, MessageSquare } from "lucide-react";
import { ErrorState, Select, Skeleton, useToast } from "@/components/ui";
import { useAuth } from "@/features/auth/auth-context";
import { useCan } from "@/features/auth/use-can";
import { cn } from "@/lib/utils/cn";
import { useMoveTicket, useTickets } from "../api";
import { STATUS_DOT, STATUS_LABEL, TYPE_DOT, TYPE_LABEL, TYPE_ORDER } from "../labels";
import type { Ticket, TicketStatus, TicketType } from "../types";
import { Avatar, DueDate, PriorityBadge, SlaLabel } from "./ticket-bits";
import { TicketFilters, TicketViewSwitch, type TicketFilterState } from "./ticket-filters";

const OPEN_COLUMNS: TicketStatus[] = ["NEW", "IN_PROGRESS", "AWAITING_MERCHANT", "IN_REVIEW"];

type GroupBy = "status" | "assignee" | "team";

interface Column {
  id: string;
  label: string;
  dot?: string;
  cards: Ticket[];
  /** Dropping here moves a card to this status (status grouping only). */
  status?: TicketStatus;
  done?: boolean;
}

function isoDay(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * /ops/board — open tickets as cards, grouped by status (drag to change),
 * assignee or team, plus everything finished in the last 7 days.
 * The assignee can move their own cards; ticket managers can move any.
 */
export function BoardPage() {
  const { user } = useAuth();
  const can = useCan();
  const canManage = can("ticket.manage");
  const { toast } = useToast();
  const move = useMoveTicket();
  const [type, setType] = useState<TicketType | "">("");
  const [groupBy, setGroupBy] = useState<GroupBy>("status");
  const [filters, setFilters] = useState<TicketFilterState>({});
  const [dragging, setDragging] = useState<Ticket | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const weekAgo = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 6);
    return isoDay(d);
  }, []);

  const base = { ...filters, type: type || undefined };
  const open = useTickets({ ...base, view: "open", sort: "priority", limit: 200 });
  const done = useTickets({ ...base, view: "done", sort: "updated", completedFrom: weekAgo, limit: 100 });

  const canMove = (t: Ticket) => canManage || (!!user && t.assignee?.id === user.id);
  const openCards = useMemo(() => open.data?.data ?? [], [open.data]);
  const doneCards = done.data?.data ?? [];
  const doneCol: Column = { id: "DONE", label: "Done this week", dot: STATUS_DOT.DONE, cards: doneCards, status: "DONE", done: true };

  const columns: Column[] = useMemo(() => {
    if (groupBy === "status") {
      return OPEN_COLUMNS.map((s) => ({ id: s, label: STATUS_LABEL[s], dot: STATUS_DOT[s], cards: openCards.filter((t) => t.status === s), status: s }));
    }
    if (groupBy === "team") {
      return TYPE_ORDER.map((ty) => ({ id: ty, label: TYPE_LABEL[ty], dot: TYPE_DOT[ty], cards: openCards.filter((t) => t.type === ty) })).filter(
        (c) => !type || c.id === type,
      );
    }
    const people = new Map<string, Column>();
    for (const t of openCards) {
      const id = t.assignee?.id ?? "none";
      if (!people.has(id)) people.set(id, { id, label: t.assignee?.name ?? "Unassigned", cards: [] });
      people.get(id)!.cards.push(t);
    }
    return [...people.values()].sort((a, b) => (a.id === "none" ? 1 : b.id === "none" ? -1 : a.label.localeCompare(b.label)));
  }, [groupBy, openCards, type]);
  const allColumns = [...columns, doneCol];

  const drop = (col: Column) => {
    const t = dragging;
    setDragging(null);
    setOver(null);
    const status = col.status;
    if (!t || !status || t.status === status) return;
    move.mutate(
      { key: t.key, input: { status } },
      {
        onSuccess: () => toast({ variant: "success", title: `${t.key} → ${STATUS_LABEL[status]}` }),
        onError: (e) => toast({ variant: "error", title: "Status not changed", description: e.message }),
      },
    );
  };

  const truncated = (open.data?.meta.total ?? 0) > (open.data?.data.length ?? 0);
  const dragEnabled = groupBy === "status";

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-[-0.011em] text-foreground">Board</h1>
          <p className="mt-1 text-table text-muted-foreground">
            {dragEnabled ? "Drag a card to another column to change its status." : "Group by Status to drag cards between columns."}
          </p>
        </div>
        <TicketViewSwitch />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select aria-label="Group by" className="w-auto min-w-36" value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)}>
          <option value="status">Group: Status</option>
          <option value="assignee">Group: Assignee</option>
          <option value="team">Group: Team</option>
        </Select>
        <Select aria-label="Team" className="w-auto min-w-32" value={type} onChange={(e) => setType(e.target.value as TicketType | "")}>
          <option value="">Team: All</option>
          {TYPE_ORDER.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t]}
            </option>
          ))}
        </Select>
        <TicketFilters value={filters} onChange={(p) => setFilters((f) => ({ ...f, ...p }))} hide={["status"]} />
      </div>

      {open.isError ? (
        <ErrorState title="Couldn't load the board" error={open.error} onRetry={() => open.refetch()} />
      ) : (
        <div
          className="grid gap-3 overflow-x-auto pb-2"
          style={{ gridTemplateColumns: `repeat(${allColumns.length}, minmax(14rem, 1fr))` }}
          aria-busy={open.isFetching}
        >
          {allColumns.map((col) => {
            const droppable = dragEnabled && !!dragging && !!col.status && dragging.status !== col.status;
            return (
              <section
                key={col.id}
                aria-label={col.label}
                onDragOver={(e) => {
                  if (!droppable) return;
                  e.preventDefault();
                  setOver(col.id);
                }}
                onDragLeave={() => setOver((o) => (o === col.id ? null : o))}
                onDrop={(e) => {
                  e.preventDefault();
                  drop(col);
                }}
                className={cn(
                  "flex min-h-[28rem] min-w-[14rem] flex-col gap-2 rounded-xl bg-muted p-2 transition-colors",
                  over === col.id ? "ring-2 ring-primary" : "",
                )}
              >
                <header className="flex items-center justify-between gap-2 px-1.5 py-1 text-sm font-semibold text-foreground">
                  <span className="inline-flex min-w-0 items-center gap-1.5">
                    {col.dot ? (
                      <span className={cn("size-2 shrink-0 rounded-full", col.dot)} aria-hidden />
                    ) : (
                      <Avatar name={col.label} />
                    )}
                    <span className="truncate">{col.label}</span>
                  </span>
                  <span className="text-xs font-medium text-muted-foreground">{col.cards.length}</span>
                </header>
                {(col.done ? done.isPending : open.isPending) ? (
                  <>
                    <Skeleton className="h-24 w-full rounded-lg" />
                    <Skeleton className="h-24 w-full rounded-lg" />
                  </>
                ) : col.cards.length === 0 ? (
                  <p className="px-1.5 text-xs text-muted-foreground">{col.done ? "Nothing finished in the last 7 days" : "No tickets"}</p>
                ) : (
                  col.cards.map((t) => (
                    <BoardCard
                      key={t.id}
                      ticket={t}
                      draggable={dragEnabled && canMove(t)}
                      onDragStart={() => setDragging(t)}
                      onDragEnd={() => {
                        setDragging(null);
                        setOver(null);
                      }}
                      dim={col.done}
                      showStatus={!dragEnabled && !col.done}
                    />
                  ))
                )}
              </section>
            );
          })}
        </div>
      )}
      {truncated ? (
        <p className="text-xs text-muted-foreground">
          Showing the first {open.data?.data.length} of {open.data?.meta.total} open tickets — narrow the filters to see the rest.
        </p>
      ) : null}
    </div>
  );
}

function BoardCard({
  ticket: t,
  draggable,
  onDragStart,
  onDragEnd,
  dim,
  showStatus,
}: {
  ticket: Ticket;
  draggable: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  dim?: boolean;
  showStatus?: boolean;
}) {
  return (
    <Link
      href={`/ops/tickets/${t.key}`}
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", t.key);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      className={cn(
        "flex flex-col gap-2 rounded-lg border border-border bg-card p-3 text-left shadow-sm transition-shadow hover:shadow-md",
        draggable ? "cursor-grab active:cursor-grabbing" : "",
        dim ? "opacity-75" : "",
      )}
    >
      <span className="flex flex-wrap items-center gap-1.5">
        <PriorityBadge priority={t.priority} />
        <span className="text-xs text-muted-foreground">{t.category}</span>
        {showStatus ? (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <span className={cn("size-1.5 rounded-full", STATUS_DOT[t.status])} aria-hidden />
            {STATUS_LABEL[t.status]}
          </span>
        ) : null}
      </span>
      <span className="line-clamp-3 text-sm font-medium leading-snug text-foreground">{t.title}</span>
      <span className="truncate text-xs text-muted-foreground">
        {t.key} · {t.merchant?.name ?? "Internal"}
      </span>
      <span className="flex items-end justify-between gap-2">
        {/* Wraps onto a second line on narrow cards instead of pushing the
            assignee avatar past the card's edge. */}
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <DueDate dueDate={t.dueDate} overdue={t.isOverdue} className="text-xs" />
          {t.subtaskCount > 0 ? (
            <span className="inline-flex items-center gap-0.5">
              <CheckSquare className="size-3" aria-hidden />
              {t.subtasksDone}/{t.subtaskCount}
            </span>
          ) : null}
          {t.commentCount > 0 ? (
            <span className="inline-flex items-center gap-0.5">
              <MessageSquare className="size-3" aria-hidden />
              {t.commentCount}
            </span>
          ) : null}
          {t.sla && (t.sla.state === "at_risk" || t.sla.state === "breached") ? <SlaLabel sla={t.sla} /> : null}
        </span>
        {dim && t.completedAt ? (
          <span className="shrink-0 text-[11px] text-muted-foreground">
            {new Date(t.completedAt).toLocaleDateString("en-US", { weekday: "short", day: "numeric" })}
          </span>
        ) : null}
        {t.assignee ? (
          <span title={t.assignee.name} className="shrink-0">
            <Avatar name={t.assignee.name} />
          </span>
        ) : null}
      </span>
    </Link>
  );
}
