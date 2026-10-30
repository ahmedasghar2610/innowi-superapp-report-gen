"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { Card, CardBody, ErrorState, Select, Skeleton, StatTile } from "@/components/ui";
import { tickets as ticketsApi } from "@/lib/api/resources/tickets";
import { cn } from "@/lib/utils/cn";
import { useTeamReport, useTicketProjects } from "../api";
import { TYPE_LABEL, TYPE_ORDER } from "../labels";
import type { TeamReport, TicketType } from "../types";

const SOURCE_LABEL: Record<string, string> = {
  MANUAL: "Created here",
  EMAIL: "Email",
  MODULE: "Super App modules",
  MEETING: "Meetings",
};

/* Two-series palette for "created vs closed", validated with the dataviz
   checker (light on #ffffff, dark on #131c2e): blue = the DS primary,
   orange = categorical slot 2. Every other chart here is one series in the
   primary colour. */
const CREATED = "bg-[#2c67f5] dark:bg-[#4c82ff]";
const CLOSED = "bg-[#eb6834] dark:bg-[#d95926]";

function pct(met: number, total: number): string {
  return total ? `${Math.round((met / total) * 100)}%` : "—";
}

function hoursLabel(h: number | null): string {
  if (h == null) return "—";
  return h < 48 ? `${Math.round(h)}h` : `${(h / 24).toFixed(1)}d`;
}

/** /ops/reports — the leadership view: open load, overdue, SLA, resolution time, trends. */
export function ReportsPage() {
  const [days, setDays] = useState(30);
  const [type, setType] = useState<TicketType | "">("");
  const [projectId, setProjectId] = useState("");
  const projects = useTicketProjects();
  const query = { days, type: type || undefined, projectId: projectId || undefined };
  const { data, isPending, isError, error, refetch, isFetching, isPlaceholderData } = useTeamReport(query);

  const exportHref = ticketsApi.exportUrl({ view: "all", type: type || undefined, projectId: projectId || undefined });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-[-0.011em] text-foreground">Team reports</h1>
          <p className="mt-1 text-table text-muted-foreground">
            Every request has an owner, a status and a clock. Figures cover the last {days} days unless they say “open”.
          </p>
        </div>
        <a
          href={exportHref}
          className="inline-flex h-7 items-center gap-1 rounded-sm border border-border bg-card px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
        >
          <Download className="size-4" aria-hidden />
          Export CSV
        </a>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select aria-label="Team" className="w-auto min-w-32" value={type} onChange={(e) => setType(e.target.value as TicketType | "")}>
          <option value="">Team: All</option>
          {TYPE_ORDER.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t]}
            </option>
          ))}
        </Select>
        <Select aria-label="Project" className="w-auto min-w-36" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="">Project: All</option>
          {(projects.data ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        <Select aria-label="Period" className="w-auto" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </Select>
      </div>

      {isError ? (
        <ErrorState title="Couldn't load the report" error={error} onRetry={() => refetch()} />
      ) : isPending || !data ? (
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      ) : (
        <div className={cn("flex flex-col gap-5 transition-opacity", isFetching && isPlaceholderData && "opacity-60")}>
          <Kpis report={data} />
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <WeeklyChart weekly={data.weekly} />
            <BarPanel
              title="Open by assignee"
              rows={data.byAssignee.map((r) => ({
                key: r.id ?? "none",
                label: r.name,
                value: r.open,
                note: r.overdue ? `${r.overdue} overdue` : undefined,
              }))}
              empty="No open tickets"
            />
          </div>
          <div className="grid gap-5 lg:grid-cols-3">
            <BarPanel
              title="Open by project"
              rows={data.byProject.map((r) => ({ key: r.id, label: r.name, value: r.open }))}
              empty="No open tickets"
            />
            <BarPanel
              title={`Top categories · ${days} days`}
              rows={data.topCategories.map((r) => ({
                key: `${r.type}-${r.category}`,
                label: `${TYPE_LABEL[r.type]} · ${r.category}`,
                value: r.count,
              }))}
              empty="No tickets created in this period"
            />
            <BarPanel
              title={`Where tickets come from · ${days} days`}
              rows={data.bySource.map((r) => ({ key: r.source, label: SOURCE_LABEL[r.source] ?? r.source, value: r.count }))}
              empty="No tickets created in this period"
              footnote="Meeting tickets arrive once Fathom is connected (Settings → Integrations)."
            />
          </div>
        </div>
      )}
    </div>
  );
}

function Kpis({ report }: { report: TeamReport }) {
  const k = report.kpis;
  const byType = TYPE_ORDER.filter((t) => k.openByType[t])
    .map((t) => `${k.openByType[t]} ${TYPE_LABEL[t]}`)
    .join(" · ");
  const prev = k.medianResolutionHoursPrevious;
  const med = k.medianResolutionHours;
  const trend =
    med != null && prev != null ? (med <= prev ? `Down from ${hoursLabel(prev)} before` : `Up from ${hoursLabel(prev)} before`) : undefined;
  return (
    <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <StatTile label="Open tickets" value={k.open} status={byType || "Nothing open"} />
      <StatTile label="Urgent / High" value={`${k.urgent} / ${k.high}`} status="open now" />
      <StatTile
        label="Overdue"
        value={k.overdue}
        tone={k.overdue ? "danger" : "neutral"}
        status={k.open ? `${Math.round(k.overdueShare * 100)}% of open tickets` : "past their due date"}
        hint="Open tickets whose due date has passed"
      />
      <StatTile
        label="Resolution SLA"
        value={pct(k.resolutionSla.met, k.resolutionSla.total)}
        status={k.resolutionSla.total ? `${k.resolutionSla.met} of ${k.resolutionSla.total} resolved in time` : "Nothing resolved yet"}
        hint="Tickets resolved in this period within their SLA (weekends excluded, paused while awaiting the merchant)"
      />
      <StatTile
        label="First response SLA"
        value={pct(k.responseSla.met, k.responseSla.total)}
        tone={k.slaBreachedOpen ? "warning" : "neutral"}
        status={k.slaBreachedOpen ? `${k.slaBreachedOpen} open past their SLA` : "No open ticket past its SLA"}
        hint="Tickets created in this period whose assignee responded in time"
      />
      <StatTile
        label="Median resolution"
        value={hoursLabel(med)}
        status={trend ?? `${k.resolved} resolved`}
        hint="Middle value of created → done, calendar time"
      />
    </div>
  );
}

function shortDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Created vs closed per week: grouped columns, hover a week for its numbers,
 *  with the same data as a table for screen readers. */
function WeeklyChart({ weekly }: { weekly: TeamReport["weekly"] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...weekly.flatMap((w) => [w.created, w.closed]));
  const H = 160;
  return (
    <Card>
      <CardBody className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Created vs closed · per week</h2>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span className={cn("size-2.5 rounded-sm", CREATED)} aria-hidden />
              Created
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className={cn("size-2.5 rounded-sm", CLOSED)} aria-hidden />
              Closed
            </span>
          </div>
        </div>
        <div className="relative" aria-hidden>
          <div className="flex items-end gap-2 border-b border-border" style={{ height: H }}>
            {weekly.map((w, i) => (
              <div
                key={w.weekStart}
                className={cn("relative flex h-full flex-1 items-end justify-center gap-0.5 rounded-t-md", hover === i && "bg-muted")}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              >
                <span
                  className={cn("w-[38%] max-w-5 rounded-t-[4px]", CREATED)}
                  style={{ height: w.created ? Math.max(2, (w.created / max) * (H - 8)) : 0 }}
                />
                <span
                  className={cn("w-[38%] max-w-5 rounded-t-[4px]", CLOSED)}
                  style={{ height: w.closed ? Math.max(2, (w.closed / max) * (H - 8)) : 0 }}
                />
                {hover === i ? (
                  <span className="pointer-events-none absolute bottom-full z-10 mb-1 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-xs text-foreground shadow-md">
                    Week of {shortDate(w.weekStart)} · <span className="font-medium">{w.created}</span> created ·{" "}
                    <span className="font-medium">{w.closed}</span> closed
                  </span>
                ) : null}
              </div>
            ))}
          </div>
          <div className="mt-1.5 flex gap-2">
            {weekly.map((w, i) => (
              <span key={w.weekStart} className="flex-1 text-center text-[11px] text-muted-foreground">
                {i % Math.ceil(weekly.length / 6) === 0 ? shortDate(w.weekStart) : ""}
              </span>
            ))}
          </div>
        </div>
        <table className="sr-only">
          <caption>Tickets created and closed per week</caption>
          <thead>
            <tr>
              <th>Week of</th>
              <th>Created</th>
              <th>Closed</th>
            </tr>
          </thead>
          <tbody>
            {weekly.map((w) => (
              <tr key={w.weekStart}>
                <td>{shortDate(w.weekStart)}</td>
                <td>{w.created}</td>
                <td>{w.closed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardBody>
    </Card>
  );
}

/** One-series horizontal bars with the value printed at the end of each row. */
function BarPanel({
  title,
  rows,
  empty,
  footnote,
}: {
  title: string;
  rows: { key: string; label: string; value: number; note?: string }[];
  empty: string;
  footnote?: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <Card>
      <CardBody className="flex flex-col gap-3">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h2>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{empty}</p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {rows.map((r) => (
              <li key={r.key} className="grid grid-cols-[minmax(0,11rem)_1fr_auto] items-center gap-3 text-sm">
                <span className="truncate text-foreground" title={r.label}>
                  {r.label}
                </span>
                <span className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
                  <span className="block h-full rounded-full bg-primary" style={{ width: `${(r.value / max) * 100}%` }} />
                </span>
                <span className="whitespace-nowrap text-right tabular text-foreground">
                  {r.value}
                  {r.note ? <span className="ml-1.5 text-xs text-text-destructive">{r.note}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        )}
        {footnote ? <p className="text-xs text-muted-foreground">{footnote}</p> : null}
      </CardBody>
    </Card>
  );
}
