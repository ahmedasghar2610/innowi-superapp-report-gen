"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CalendarClock, ChevronLeft, ChevronRight, Info, MapPin, Palmtree, Users, Video } from "lucide-react";
import { Button, Card, Select, Skeleton, useToast } from "@/components/ui";
import { useWorkspace } from "@/features/settings/api";
import { useTeamsCalendar } from "@/features/settings/teams-api";
import type { CalendarEvent } from "@/lib/api/resources/teams";
import { cn } from "@/lib/utils/cn";
import { useMoveTicket, useTickets } from "../api";
import { PRIORITY_LABEL, STATUS_LABEL, TYPE_LABEL, TYPE_ORDER } from "../labels";
import type { Ticket, TicketType } from "../types";

const PRIORITY_BAR: Record<string, string> = {
  URGENT: "border-l-destructive",
  HIGH: "border-l-warning",
  MEDIUM: "border-l-primary",
  LOW: "border-l-border",
};
const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MAX_IN_CELL = 3;

/** Meeting / leave chip colours (prototype v4: purple = meeting, grey = leave). */
const EVENT_CHIP: Record<CalendarEvent["kind"], string> = {
  meeting: "bg-[#eef0fb] text-[#3730a3]",
  busy: "bg-[#f1effd] text-[#5b4fc4]",
  recording: "bg-[#eef0fb] text-[#3730a3]",
  leave: "bg-muted text-muted-foreground",
};
const EVENT_LABEL: Record<CalendarEvent["kind"], string> = {
  meeting: "Teams meeting",
  busy: "Outlook",
  recording: "Fathom recording",
  leave: "Leave",
};

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
/** Monday = 0 … Sunday = 6 (same numbering as Settings → Workspace). */
const mondayIndex = (d: Date) => (d.getDay() + 6) % 7;

/** Ops CRM → Calendar: ticket due dates on a month grid, plus meetings and
 *  leave (Teams meetings booked from tickets, Outlook busy blocks and automatic
 *  replies from the Availability sync flow, Fathom recordings). Drag a ticket
 *  to another day to change its due date (ticket managers). */
export function CalendarPage() {
  const today = new Date();
  const [month, setMonth] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [mine, setMine] = useState(false);
  const [showDone, setShowDone] = useState(true);
  const [type, setType] = useState<TicketType | "">("");
  const [selected, setSelected] = useState<string>(iso(today));
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [showMeetings, setShowMeetings] = useState(true);
  const [activeEvent, setActiveEvent] = useState<string | null>(null);
  const ws = useWorkspace();
  const move = useMoveTicket();
  const { toast } = useToast();

  const sundayFirst = ws.data?.workspace.weekStartsOn === "sunday";
  const workDays = ws.data?.workspace.workDays ?? [0, 1, 2, 3, 4];

  // The grid: whole weeks covering the month.
  const days = useMemo(() => {
    const first = month;
    const lead = sundayFirst ? first.getDay() : mondayIndex(first);
    const start = addDays(first, -lead);
    const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
    const trail = 6 - (sundayFirst ? last.getDay() : mondayIndex(last));
    const end = addDays(last, trail);
    const out: Date[] = [];
    for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
    return out;
  }, [month, sundayFirst]);

  const from = iso(days[0]);
  const to = iso(days[days.length - 1]);
  const common = { assigneeId: mine ? "me" : undefined, type: type || undefined, limit: 200 };
  // Open work sits on its due date; finished work sits on the day it was closed.
  const openQ = useTickets({ ...common, view: "open", dueFrom: from, dueTo: to, sort: "due" });
  const doneQ = useTickets({ ...common, view: "done", completedFrom: from, completedTo: to, sort: "updated" }, { enabled: showDone });
  const isPending = openQ.isPending;
  const all = useMemo(
    () => [...(openQ.data?.data ?? []), ...(showDone ? (doneQ.data?.data ?? []) : [])],
    [openQ.data, doneQ.data, showDone],
  );
  const byDay = useMemo(() => {
    const m = new Map<string, Ticket[]>();
    for (const t of all) {
      const day = t.status === "DONE" && t.completedAt ? iso(new Date(t.completedAt)) : t.dueDate;
      if (!day) continue;
      m.set(day, [...(m.get(day) ?? []), t]);
    }
    return m;
  }, [all]);

  // Meetings and leave, bucketed by day in the workspace time zone.
  const calQ = useTeamsCalendar(from, to, mine);
  const tz = calQ.data?.timezone || ws.data?.workspace.timezone || "Asia/Karachi";
  const fmt = useMemo(() => {
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
    const time = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
    return { day: (v: string) => day.format(new Date(v)), time: (v: string) => time.format(new Date(v)) };
  }, [tz]);
  const eventsByDay = useMemo(() => {
    const m = new Map<string, CalendarEvent[]>();
    if (!showMeetings) return m;
    for (const ev of calQ.data?.events ?? []) {
      const day = ev.day ?? (ev.start ? fmt.day(ev.start) : null);
      if (!day) continue;
      m.set(day, [...(m.get(day) ?? []), ev]);
    }
    return m;
  }, [calQ.data, fmt, showMeetings]);
  const timeRange = (ev: CalendarEvent) => (ev.day || !ev.start ? "All day" : `${fmt.time(ev.start)}${ev.end ? `–${fmt.time(ev.end)}` : ""}`);

  const canMove = (t: Ticket) => !!t && t.status !== "DONE";
  const onDrop = (day: string, key: string, from: string) => {
    setDragOver(null);
    if (day === from) return;
    move.mutate(
      { key, input: { dueDate: day } },
      {
        onSuccess: () => toast({ variant: "success", title: `${key} now due ${new Date(day + "T00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}` }),
        onError: (e) => toast({ variant: "error", title: "Couldn't move it", description: e.messages?.[0] ?? e.message }),
      },
    );
  };

  const headers = sundayFirst ? [DAY_NAMES[6], ...DAY_NAMES.slice(0, 6)] : DAY_NAMES;
  const selectedTickets = byDay.get(selected) ?? [];
  const selectedEvents = eventsByDay.get(selected) ?? [];
  const total = all.length;
  const openDue = all.filter((t) => t.status !== "DONE").length;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-[-0.011em] text-foreground">Calendar</h1>
          <p className="mt-1 text-table text-muted-foreground">
            Ticket due dates, meetings and leave for the whole team. Click a day for details; drag a ticket to another day to move its due date.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button size="icon-sm" aria-label="Previous month" onClick={() => setMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))}>
            <ChevronLeft />
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setMonth(new Date(today.getFullYear(), today.getMonth(), 1));
              setSelected(iso(today));
            }}
          >
            Today
          </Button>
          <Button size="icon-sm" aria-label="Next month" onClick={() => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))}>
            <ChevronRight />
          </Button>
        </div>
        <h2 className="mr-2 text-lg font-semibold text-foreground" aria-live="polite">
          {month.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
        </h2>
        <div className="flex gap-0.5 rounded-lg bg-muted p-1" role="group" aria-label="Whose tickets">
          {[
            { v: false, l: "Team" },
            { v: true, l: "Only mine" },
          ].map((o) => (
            <button
              key={o.l}
              type="button"
              aria-pressed={mine === o.v}
              onClick={() => setMine(o.v)}
              className={cn("rounded-md px-3 py-1 text-sm font-medium", mine === o.v ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
            >
              {o.l}
            </button>
          ))}
        </div>
        <Select aria-label="Team" className="w-auto min-w-36" value={type} onChange={(e) => setType(e.target.value as TicketType | "")}>
          <option value="">All teams</option>
          {TYPE_ORDER.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t]}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input type="checkbox" className="size-4 accent-[var(--color-primary)]" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
          Show done (on the day closed)
        </label>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input type="checkbox" className="size-4 accent-[var(--color-primary)]" checked={showMeetings} onChange={(e) => setShowMeetings(e.target.checked)} />
          Meetings &amp; leave
        </label>
        <span className="ml-auto text-xs text-muted-foreground">
          {isPending ? "Loading…" : `${openDue} open · ${total - openDue} done this view`}
        </span>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Legend">
        <Legend className="bg-destructive" label="Urgent deadline" />
        <Legend className="bg-warning" label="High" />
        <Legend className="bg-primary" label="Deadline" />
        <Legend className="bg-success" label="Completed" />
        <Legend className="bg-[#7c6cf0]" label="Meeting" />
        <Legend className="bg-[#8a867e]" label="Leave" />
      </div>

      <Card className="overflow-hidden">
        <div className="grid grid-cols-7 border-b border-border bg-muted/40">
          {headers.map((d) => (
            <div key={d} className="px-2 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {d}
            </div>
          ))}
        </div>
        {isPending && !openQ.data ? (
          <Skeleton className="h-[34rem] w-full" />
        ) : (
          <div className="grid grid-cols-7">
            {days.map((d) => {
              const key = iso(d);
              const inMonth = d.getMonth() === month.getMonth();
              const isToday = key === iso(today);
              const off = !workDays.includes(mondayIndex(d));
              const list = byDay.get(key) ?? [];
              const evs = eventsByDay.get(key) ?? [];
              const leaveFirst = [...evs.filter((e) => e.kind === "leave"), ...evs.filter((e) => e.kind !== "leave")];
              const shownEvents = leaveFirst.slice(0, MAX_IN_CELL);
              const ticketRoom = Math.max(0, MAX_IN_CELL - shownEvents.length);
              const hidden = evs.length - shownEvents.length + Math.max(0, list.length - ticketRoom);
              return (
                <div
                  key={key}
                  role="button"
                  tabIndex={0}
                  aria-label={`${d.toDateString()}, ${list.length} ticket${list.length === 1 ? "" : "s"}${evs.length ? `, ${evs.length} meeting${evs.length === 1 ? "" : "s"} or leave` : ""}`}
                  onClick={() => setSelected(key)}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setSelected(key)}
                  onDragOver={(e) => {
                    if (e.dataTransfer.types.includes("text/ticket")) {
                      e.preventDefault();
                      setDragOver(key);
                    }
                  }}
                  onDragLeave={() => setDragOver((k) => (k === key ? null : k))}
                  onDrop={(e) => {
                    e.preventDefault();
                    const [tk, from] = (e.dataTransfer.getData("text/ticket") || "|").split("|");
                    if (tk) onDrop(key, tk, from);
                  }}
                  className={cn(
                    "flex min-h-28 cursor-pointer flex-col gap-1 border-b border-r border-border p-1.5 text-left outline-none transition-colors [&:nth-child(7n)]:border-r-0 focus-visible:ring-2 focus-visible:ring-primary",
                    !inMonth && "bg-muted/40 text-muted-foreground",
                    off && inMonth && "bg-muted/20",
                    selected === key && "ring-2 ring-inset ring-primary/60",
                    dragOver === key && "bg-accent",
                  )}
                >
                  <span
                    className={cn(
                      "grid size-6 place-items-center rounded-full text-xs font-medium",
                      isToday ? "bg-primary text-primary-foreground" : inMonth ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {d.getDate()}
                  </span>
                  {shownEvents.map((ev) => (
                    <button
                      key={ev.id}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelected(key);
                        setActiveEvent(ev.id);
                      }}
                      title={`${ev.title} · ${timeRange(ev)}${ev.people.length ? ` · ${ev.people.map((p) => p.name).join(", ")}` : ""}`}
                      className={cn("block w-full truncate rounded-sm px-1.5 py-0.5 text-left text-[11px] font-medium leading-4 hover:opacity-80", EVENT_CHIP[ev.kind])}
                    >
                      {ev.day ? "" : `${ev.start ? fmt.time(ev.start).replace(":00", "") : ""} `}
                      {ev.title}
                    </button>
                  ))}
                  {list.slice(0, ticketRoom).map((t) => (
                    <Chip key={t.id} t={t} day={key} draggable={canMove(t)} />
                  ))}
                  {hidden > 0 && <span className="px-1 text-[11px] font-medium text-primary">+{hidden} more</span>}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {showMeetings && (
        <Card className="p-4">
          <h3 className="mb-2 text-sm font-semibold text-foreground">
            {new Date(selected + "T00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
            <span className="ml-2 font-normal text-muted-foreground">
              {selectedEvents.length} meeting{selectedEvents.length === 1 ? "" : "s"} &amp; leave
            </span>
          </h3>
          {selectedEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground">No meetings or leave this day.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {selectedEvents.map((ev) => (
                <EventRow key={ev.id} ev={ev} when={timeRange(ev)} active={activeEvent === ev.id} />
              ))}
            </ul>
          )}
        </Card>
      )}

      <Card className="p-4">
        <h3 className="mb-2 text-sm font-semibold text-foreground">
          {new Date(selected + "T00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
          <span className="ml-2 font-normal text-muted-foreground">
            {selectedTickets.length} ticket{selectedTickets.length === 1 ? "" : "s"} due
          </span>
        </h3>
        {selectedTickets.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing due this day.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {selectedTickets.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                <Link href={`/ops/tickets/${t.key}`} className="font-medium text-primary hover:underline">
                  {t.key}
                </Link>
                <span className="min-w-0 flex-1 truncate text-foreground">{t.title}</span>
                <span className="text-xs text-muted-foreground">{t.merchant?.name ?? "Internal"}</span>
                <span className="text-xs text-muted-foreground">{PRIORITY_LABEL[t.priority]}</span>
                <span className="text-xs text-muted-foreground">{STATUS_LABEL[t.status]}</span>
                <span className="text-xs text-muted-foreground">{t.assignee?.name ?? "Unassigned"}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Info className="size-3.5" aria-hidden />
        Meetings and leave come from Outlook through the Availability sync flow
        {calQ.data?.updatedAt ? ` (last update ${new Date(calQ.data.updatedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })})` : " (not synced yet)"}
        , Teams meetings booked from a ticket, and Fathom recordings. Times are in {tz}. Shaded days aren&apos;t working days (Settings → Workspace).
      </p>
    </div>
  );
}

function Chip({ t, day, draggable }: { t: Ticket; day: string; draggable: boolean }) {
  const done = t.status === "DONE";
  const breached = t.sla?.state === "breached";
  return (
    <Link
      href={`/ops/tickets/${t.key}`}
      draggable={draggable}
      onClick={(e) => e.stopPropagation()}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/ticket", `${t.key}|${day}`);
        e.dataTransfer.effectAllowed = "move";
      }}
      title={`${t.key} · ${t.title} · ${PRIORITY_LABEL[t.priority]} · ${STATUS_LABEL[t.status]}${t.assignee ? ` · ${t.assignee.name}` : ""}`}
      className={cn(
        "block truncate rounded-sm border-l-2 bg-card px-1.5 py-0.5 text-[11px] leading-4 shadow-[0_0_0_1px_var(--color-border)] hover:bg-muted",
        PRIORITY_BAR[t.priority],
        done && "text-muted-foreground line-through opacity-70",
        !done && (t.isOverdue || breached) && "text-text-destructive",
        draggable && "cursor-grab active:cursor-grabbing",
      )}
    >
      <span className="font-semibold">{t.key.replace("OPS-", "")}</span> {t.title}
    </Link>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <i className={cn("inline-block size-2 rounded-full", className)} aria-hidden />
      {label}
    </span>
  );
}

/** One meeting / leave entry in the selected-day panel. */
function EventRow({ ev, when, active }: { ev: CalendarEvent; when: string; active: boolean }) {
  const Icon = ev.kind === "leave" ? Palmtree : ev.kind === "busy" ? CalendarClock : Video;
  return (
    <li className={cn("flex gap-3 py-2.5 text-sm", active && "rounded-md bg-accent/60 px-2")}>
      <span className={cn("mt-0.5 grid size-7 shrink-0 place-items-center rounded-md", EVENT_CHIP[ev.kind])}>
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-x-2">
          <span className="font-medium text-foreground">{ev.title}</span>
          <span className="text-xs text-muted-foreground">
            {when} · {EVENT_LABEL[ev.kind]}
          </span>
        </div>
        {ev.people.length > 0 && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Users className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">{ev.people.map((p) => p.name).join(", ")}</span>
          </span>
        )}
        {ev.location && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <MapPin className="size-3.5 shrink-0" aria-hidden />
            {ev.location}
          </span>
        )}
        {ev.note && <span className="line-clamp-2 text-xs text-muted-foreground">{ev.note}</span>}
        <span className="flex flex-wrap gap-3 text-xs">
          {ev.ticketKey && (
            <Link href={`/ops/tickets/${ev.ticketKey}`} className="font-medium text-primary hover:underline">
              {ev.ticketKey}
              {ev.ticketTitle ? ` · ${ev.ticketTitle}` : ""}
            </Link>
          )}
          {ev.link && (
            <Link href={ev.link} className="font-medium text-primary hover:underline">
              Open meeting record
            </Link>
          )}
        </span>
      </div>
    </li>
  );
}
