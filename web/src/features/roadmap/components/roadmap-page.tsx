"use client";

import { useMemo, useState } from "react";
import { CalendarClock, Flag, Pencil, Plus, Search } from "lucide-react";
import { Badge, Button, Card, EmptyState, ErrorState, Select, Skeleton } from "@/components/ui";
import { useAuth } from "@/features/auth/auth-context";
import { hasCapability } from "@/features/auth/capabilities";
import { cn } from "@/lib/utils/cn";
import {
  AREAS,
  AREA_LABEL,
  PHASE_STATE_LABEL,
  PHASE_STATE_TONE,
  STATUSES,
  STATUS_LABEL,
  STATUS_TONE,
  isOverdue,
  monthRange,
  phaseState,
  shortDate,
} from "../format";
import { useRoadmap, useUpdateItem } from "../queries";
import type { Counts, ItemStatus, Owner, Phase, Roadmap, RoadmapItem } from "../types";
import { ItemDrawer } from "./item-drawer";
import { PhaseDialog } from "./phase-dialog";

type OwnerFilter = "all" | "mine" | "none" | string;
type StatusFilter = "all" | "open" | ItemStatus;

const SEGMENTS: { key: keyof Counts; label: string; bar: string; dot: string }[] = [
  { key: "done", label: "Done", bar: "bg-success", dot: "bg-success" },
  { key: "inProgress", label: "In progress", bar: "bg-primary", dot: "bg-primary" },
  { key: "blocked", label: "Blocked", bar: "bg-destructive", dot: "bg-destructive" },
  { key: "todo", label: "To do", bar: "bg-muted-foreground/30", dot: "bg-muted-foreground/40" },
];

function ProgressBar({ counts, className }: { counts: Counts; className?: string }) {
  if (!counts.total) return <div className={cn("h-2 rounded-full bg-muted", className)} />;
  return (
    <div className={cn("flex h-2 overflow-hidden rounded-full bg-muted", className)} role="img"
      aria-label={`${counts.done} of ${counts.total} done`}>
      {SEGMENTS.map((s) =>
        counts[s.key] ? <div key={s.key} className={s.bar} style={{ width: `${(counts[s.key] / counts.total) * 100}%` }} /> : null,
      )}
    </div>
  );
}

function initials(name: string) {
  const parts = name.replace(/[._-]+/g, " ").trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

function OwnerChip({ owner }: { owner?: Owner }) {
  if (!owner) return <span className="text-xs text-muted-foreground">Unassigned</span>;
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-foreground" title={owner.email}>
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent text-[10px] font-semibold text-primary-subtle-foreground">
        {initials(owner.name)}
      </span>
      <span className="truncate">{owner.name}</span>
    </span>
  );
}

function ItemRow({
  item,
  data,
  onOpen,
}: {
  item: RoadmapItem;
  data: Roadmap;
  onOpen: () => void;
}) {
  const update = useUpdateItem();
  const owner = data.owners.find((o) => o.id === item.ownerId);
  const canStatus = data.canManage || (item.ownerId && item.ownerId === data.me);
  const overdue = isOverdue(item.targetDate, item.status);

  return (
    <li className="grid grid-cols-1 items-center gap-x-4 gap-y-2 px-4 py-3 sm:grid-cols-[132px_minmax(0,1fr)_160px_96px]">
      <div className="order-2 sm:order-1">
        {canStatus ? (
          <Select
            aria-label={`Status of ${item.title}`}
            value={item.status}
            disabled={update.isPending}
            onChange={(e) => update.mutate({ id: item.id, input: { status: e.target.value as ItemStatus } })}
            className={cn(
              "h-7 text-xs font-medium",
              item.status === "DONE" && "border-success-subtle bg-success-subtle text-success-subtle-foreground",
              item.status === "IN_PROGRESS" && "border-accent bg-accent text-primary-subtle-foreground",
              item.status === "BLOCKED" && "border-destructive-subtle bg-destructive-subtle text-text-destructive",
            )}
          >
            {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </Select>
        ) : (
          <Badge tone={STATUS_TONE[item.status]}>{STATUS_LABEL[item.status]}</Badge>
        )}
      </div>
      <button type="button" onClick={onOpen}
        className="order-1 min-w-0 text-left focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent sm:order-2 rounded-md">
        <div className="flex items-start gap-1.5">
          {item.priority === "HIGH" && item.status !== "DONE" && (
            <Flag className="mt-0.5 size-3.5 shrink-0 text-warning-text" aria-label="High priority" />
          )}
          <span className={cn("text-sm font-medium text-foreground hover:underline underline-offset-2",
            item.status === "DONE" && "text-muted-foreground")}>
            {item.title}
          </span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          <span>{AREA_LABEL[item.area]}</span>
          {item.notes ? <span aria-hidden>·</span> : null}
          {item.notes ? <span className="truncate">Has notes</span> : null}
        </div>
      </button>
      <div className="order-3 min-w-0"><OwnerChip owner={owner} /></div>
      <div className={cn("order-4 text-xs tabular-nums sm:text-right", overdue ? "font-medium text-warning-text" : "text-muted-foreground")}>
        {item.status === "DONE" && item.doneOn
          ? `Done ${shortDate(item.doneOn)}`
          : item.targetDate
            ? <span className="inline-flex items-center gap-1">{overdue && <CalendarClock className="size-3.5" aria-hidden />}{overdue ? "Due " : "By "}{shortDate(item.targetDate)}</span>
            : ""}
      </div>
    </li>
  );
}

function PhaseSection({
  phase,
  items,
  data,
  filtered,
  onOpen,
  onAdd,
  onEdit,
}: {
  phase: Phase;
  items: RoadmapItem[];
  data: Roadmap;
  filtered: boolean;
  onOpen: (i: RoadmapItem) => void;
  onAdd: () => void;
  onEdit: () => void;
}) {
  const state = phaseState(phase, data.phases);
  const pct = phase.counts.total ? Math.round((phase.counts.done / phase.counts.total) * 100) : 0;
  return (
    <section aria-labelledby={`phase-${phase.id}`} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-3xl">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={PHASE_STATE_TONE[state]} icon={false}>{PHASE_STATE_LABEL[state]}</Badge>
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {monthRange(phase.startMonth, phase.endMonth)}
            </span>
          </div>
          <h2 id={`phase-${phase.id}`} className="mt-1 text-lg font-semibold tracking-[-0.01em] text-foreground">{phase.name}</h2>
          {phase.goal && <p className="mt-0.5 text-table text-muted-foreground">{phase.goal}</p>}
        </div>
        <div className="flex items-center gap-3">
          <div className="w-40">
            <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
              <span>{phase.counts.done} of {phase.counts.total} done</span>
              <span>{pct}%</span>
            </div>
            <ProgressBar counts={phase.counts} className="mt-1" />
          </div>
          {data.canManage && (
            <div className="flex gap-1">
              <Button variant="ghost" size="sm" onClick={onEdit} aria-label={`Edit ${phase.name}`}>
                <Pencil className="size-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={onAdd}>
                <Plus className="size-4" /> Item
              </Button>
            </div>
          )}
        </div>
      </div>
      <Card className="overflow-hidden">
        {items.length ? (
          <ul className="divide-y divide-border">
            {items.map((i) => <ItemRow key={i.id} item={i} data={data} onOpen={() => onOpen(i)} />)}
          </ul>
        ) : (
          <p className="px-4 py-4 text-sm text-muted-foreground">
            {filtered ? "Nothing here matches the filters." : "No items yet."}
          </p>
        )}
      </Card>
    </section>
  );
}

/** Route /roadmap: what's done, what's next, and who owns it. */
export function RoadmapPage() {
  const { user } = useAuth();
  const canView = hasCapability(user?.role, "roadmap.view");
  const q = useRoadmap();
  const [ownerF, setOwnerF] = useState<OwnerFilter>("all");
  const [areaF, setAreaF] = useState<string>("all");
  const [statusF, setStatusF] = useState<StatusFilter>("all");
  const [text, setText] = useState("");
  const [openItem, setOpenItem] = useState<RoadmapItem | null>(null);
  const [newIn, setNewIn] = useState<string | null>(null);
  const [phaseEdit, setPhaseEdit] = useState<{ open: boolean; phase: Phase | null }>({ open: false, phase: null });

  const data = q.data;
  const filtered = ownerF !== "all" || areaF !== "all" || statusF !== "all" || text.trim() !== "";
  const match = useMemo(() => {
    const t = text.trim().toLowerCase();
    return (i: RoadmapItem) =>
      (ownerF === "all" || (ownerF === "mine" ? i.ownerId === data?.me : ownerF === "none" ? !i.ownerId : i.ownerId === ownerF)) &&
      (areaF === "all" || i.area === areaF) &&
      (statusF === "all" || (statusF === "open" ? i.status !== "DONE" : i.status === statusF)) &&
      (!t || i.title.toLowerCase().includes(t) || (i.description ?? "").toLowerCase().includes(t) || (i.notes ?? "").toLowerCase().includes(t));
  }, [ownerF, areaF, statusF, text, data?.me]);

  if (user === undefined) return null;
  if (!canView) return <Card><EmptyState title="No access" description="Ask an admin for access to the roadmap." /></Card>;
  if (q.isPending) return <Skeleton className="h-96" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!data) return null;

  const myOpen = data.phases.flatMap((p) => p.items).filter((i) => i.ownerId === data.me && i.status !== "DONE").length;
  const c = data.counts;
  const pct = c.total ? Math.round((c.done / c.total) * 100) : 0;
  // Keep the drawer's item in sync with fresh data after a save.
  const liveOpen = openItem ? data.phases.flatMap((p) => p.items).find((i) => i.id === openItem.id) ?? null : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.011em] text-foreground">Roadmap</h1>
          <p className="mt-1 text-table text-muted-foreground">What&apos;s done, what&apos;s next, and who owns it.</p>
        </div>
        {data.canManage && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setPhaseEdit({ open: true, phase: null })}>
              <Plus className="size-4" /> Phase
            </Button>
            <Button variant="default" disabled={!data.phases.length} onClick={() => setNewIn(data.phases.find((p) => phaseState(p, data.phases) === "now")?.id ?? data.phases[0]?.id ?? null)}>
              <Plus className="size-4" /> New item
            </Button>
          </div>
        )}
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-xs font-medium text-muted-foreground">Overall</div>
            <div className="mt-0.5 text-2xl font-semibold tabular-nums text-foreground">
              {c.done} <span className="text-base font-normal text-muted-foreground">of {c.total} done · {pct}%</span>
            </div>
          </div>
          {myOpen > 0 && (
            <button type="button" onClick={() => { setOwnerF("mine"); setStatusF("open"); }}
              className="rounded-lg border border-border px-3 py-1.5 text-sm text-foreground hover:bg-secondary">
              You own <span className="font-semibold tabular-nums">{myOpen}</span> open {myOpen === 1 ? "item" : "items"}
            </button>
          )}
        </div>
        <ProgressBar counts={c} className="mt-3 h-2.5" />
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {SEGMENTS.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1.5 tabular-nums">
              <span className={cn("size-2 rounded-full", s.dot)} aria-hidden />{s.label} {c[s.key]}
            </span>
          ))}
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Search items…"
            aria-label="Search roadmap items"
            className="h-8 w-full rounded-lg border border-border bg-card pl-8 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent"
          />
        </div>
        <Select aria-label="Owner" value={ownerF} onChange={(e) => setOwnerF(e.target.value)} className="w-auto min-w-[150px]">
          <option value="all">Everyone</option>
          <option value="mine">My items</option>
          <option value="none">Unassigned</option>
          {data.owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </Select>
        <Select aria-label="Area" value={areaF} onChange={(e) => setAreaF(e.target.value)} className="w-auto min-w-[150px]">
          <option value="all">All areas</option>
          {AREAS.map((a) => <option key={a} value={a}>{AREA_LABEL[a]}</option>)}
        </Select>
        <Select aria-label="Status" value={statusF} onChange={(e) => setStatusF(e.target.value as StatusFilter)} className="w-auto min-w-[130px]">
          <option value="all">Any status</option>
          <option value="open">Not done</option>
          {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </Select>
        {filtered && (
          <Button variant="ghost" size="sm" onClick={() => { setOwnerF("all"); setAreaF("all"); setStatusF("all"); setText(""); }}>
            Clear filters
          </Button>
        )}
      </div>

      {data.phases.length === 0 ? (
        <Card>
          <EmptyState title="No phases yet" description={data.canManage ? "Add the first phase to start the roadmap." : "An admin hasn't set up the roadmap yet."} />
        </Card>
      ) : (
        data.phases.map((p) => (
          <PhaseSection
            key={p.id}
            phase={p}
            items={p.items.filter(match)}
            data={data}
            filtered={filtered}
            onOpen={setOpenItem}
            onAdd={() => setNewIn(p.id)}
            onEdit={() => setPhaseEdit({ open: true, phase: p })}
          />
        ))
      )}

      <ItemDrawer data={data} item={liveOpen} newInPhase={newIn} onClose={() => { setOpenItem(null); setNewIn(null); }} />
      <PhaseDialog open={phaseEdit.open} phase={phaseEdit.phase} onClose={() => setPhaseEdit({ open: false, phase: null })} />
    </div>
  );
}
