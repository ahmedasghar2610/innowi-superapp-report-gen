"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Search } from "lucide-react";
import { Select } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import { useTicketPeople, useTicketProjects } from "../api";
import { PRIORITY_LABEL, PRIORITY_ORDER, STATUS_LABEL, STATUS_ORDER } from "../labels";
import type { TicketListQuery } from "../types";

export type TicketFilterState = Pick<
  TicketListQuery,
  "view" | "status" | "priority" | "projectId" | "assigneeId" | "search" | "overdue" | "slaBreached" | "watching"
>;

/** "List | Board" switch shown on both views. */
export function TicketViewSwitch() {
  const pathname = usePathname();
  const items = [
    { href: "/ops/tickets", label: "List" },
    { href: "/ops/board", label: "Board" },
  ];
  return (
    <div className="flex gap-0.5 rounded-lg bg-muted p-1" role="tablist" aria-label="Ticket views">
      {items.map((i) => {
        const active = pathname === i.href;
        return (
          <Link
            key={i.href}
            href={i.href}
            role="tab"
            aria-selected={active}
            className={cn(
              "rounded-md px-3 py-1 text-sm font-medium transition-colors",
              active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {i.label}
          </Link>
        );
      })}
    </div>
  );
}

/** Debounced search box. */
export function TicketSearch({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [term, setTerm] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => setTerm(value), [value]);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return (
    <label className="relative block w-full sm:w-64">
      <span className="sr-only">Search tickets</span>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <input
        type="search"
        value={term}
        onChange={(e) => {
          const v = e.target.value;
          setTerm(v);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => onChange(v.trim()), 300);
        }}
        placeholder="Search title, merchant or OPS-…"
        className="h-8 w-full rounded-lg border border-border bg-card pl-8 pr-2.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent"
      />
    </label>
  );
}

/**
 * Project / priority / assignee / status filters. `hide` drops controls that
 * the page fixes itself (e.g. assignee on "Assigned to me", status on Board).
 */
export function TicketFilters({
  value,
  onChange,
  hide = [],
}: {
  value: TicketFilterState;
  onChange: (patch: Partial<TicketFilterState>) => void;
  hide?: Array<"assignee" | "status" | "search">;
}) {
  const projects = useTicketProjects();
  const people = useTicketPeople();

  // Status select encodes both the view (open/done/all) and single statuses.
  const statusValue = value.status
    ? `s:${value.status}`
    : value.overdue
      ? "overdue"
      : value.slaBreached
        ? "sla"
        : (value.view ?? "open");
  const setStatus = (v: string) => {
    const clear = { overdue: undefined, slaBreached: undefined };
    if (v.startsWith("s:")) onChange({ ...clear, status: v.slice(2), view: "all" });
    else if (v === "overdue") onChange({ ...clear, status: undefined, view: "open", overdue: true });
    else if (v === "sla") onChange({ ...clear, status: undefined, view: "open", slaBreached: true });
    else onChange({ ...clear, status: undefined, view: v as TicketFilterState["view"] });
  };
  const assigneeValue = value.watching ? "watching" : (value.assigneeId ?? "");
  const setAssignee = (v: string) =>
    v === "watching" ? onChange({ watching: true, assigneeId: undefined }) : onChange({ watching: undefined, assigneeId: v || undefined });

  return (
    <div className="flex flex-wrap items-center gap-2">
      {!hide.includes("search") ? (
        <TicketSearch value={value.search ?? ""} onChange={(search) => onChange({ search: search || undefined })} />
      ) : null}
      <Select
        aria-label="Project"
        className="w-auto min-w-36"
        value={value.projectId ?? ""}
        onChange={(e) => onChange({ projectId: e.target.value || undefined })}
      >
        <option value="">Project: All</option>
        {(projects.data ?? []).map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </Select>
      <Select
        aria-label="Priority"
        className="w-auto min-w-32"
        value={value.priority ?? ""}
        onChange={(e) => onChange({ priority: e.target.value || undefined })}
      >
        <option value="">Priority: All</option>
        <option value="URGENT,HIGH">Urgent + High</option>
        {PRIORITY_ORDER.map((p) => (
          <option key={p} value={p}>
            {PRIORITY_LABEL[p]}
          </option>
        ))}
      </Select>
      {!hide.includes("assignee") ? (
        <Select
          aria-label="Assignee"
          className="w-auto min-w-36"
          value={assigneeValue}
          onChange={(e) => setAssignee(e.target.value)}
        >
          <option value="">Assignee: Anyone</option>
          <option value="me">Assignee: Me</option>
          <option value="watching">Tickets I watch</option>
          {(people.data ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
          <option value="none">Unassigned</option>
        </Select>
      ) : null}
      {!hide.includes("status") ? (
        <Select aria-label="Status" className="w-auto min-w-32" value={statusValue} onChange={(e) => setStatus(e.target.value)}>
          <option value="open">Status: Open</option>
          <option value="overdue">Overdue</option>
          <option value="sla">SLA breached</option>
          {STATUS_ORDER.map((s) => (
            <option key={s} value={`s:${s}`}>
              {STATUS_LABEL[s]}
            </option>
          ))}
          <option value="done">Done</option>
          <option value="all">All statuses</option>
        </Select>
      ) : null}
    </div>
  );
}
