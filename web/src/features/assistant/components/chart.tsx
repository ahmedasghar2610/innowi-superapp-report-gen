"use client";

import { useId, useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { ChartFormat, ChartSpec } from "../types";
import { copyText } from "../utils";

/**
 * Charts the assistant draws with its show_chart tool. Plain SVG/CSS in the
 * same style as the Sales overview (Signal Blue lead series, recessive grid,
 * grow-in animation that respects reduced motion). The numbers always come
 * from a lookup the API ran; the model only chooses the shape.
 */

const SERIES_COLORS = ["var(--chart-1)", "var(--chart-4)", "var(--chart-3)", "var(--chart-2)"];
const SLICE_COLORS = [
  "var(--chart-1)",
  "var(--chart-4)",
  "var(--chart-3)",
  "var(--chart-2)",
  "var(--success)",
  "var(--warning)",
  "var(--data-issue)",
  "var(--chart-5)",
];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatValue(v: number | null | undefined, format: ChartFormat, compact = false): string {
  if (v == null || Number.isNaN(v)) return "—";
  if (format === "percent") return `${Math.round(v * 10) / 10}%`;
  if (format === "money") {
    if (compact && Math.abs(v) >= 1000) {
      return "$" + new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v);
    }
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(v);
  }
  if (compact && Math.abs(v) >= 10000) {
    return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v);
  }
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(v);
}

/** "2026-09" → "Sep" (or "Sep '26" when the chart spans more than one year). */
function useLabels(labels: string[]): string[] {
  return useMemo(() => {
    const months = labels.map((l) => /^(\d{4})-(\d{2})$/.exec(l));
    if (!months.every(Boolean)) return labels;
    const years = new Set(months.map((m) => m![1]));
    return months.map((m) => {
      const name = MONTHS[Number(m![2]) - 1] ?? m![0];
      return years.size > 1 ? `${name} '${m![1].slice(2)}` : name;
    });
  }, [labels]);
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * p;
}

function toCsv(chart: ChartSpec): string {
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const head = ["", ...chart.series.map((s) => s.name || "Value")].map(esc).join(",");
  const rows = chart.labels.map((l, i) => [esc(l), ...chart.series.map((s) => String(s.values[i] ?? ""))].join(","));
  return [head, ...rows].join("\n");
}

/** Vertical bars only work for short labels (months, short names); long names read better as rows. */
function effectiveType(chart: ChartSpec): ChartSpec["type"] {
  if (chart.type !== "bar") return chart.type;
  const months = chart.labels.every((l) => /^\d{4}-\d{2}$/.test(l));
  const avg = chart.labels.reduce((s, l) => s + l.length, 0) / Math.max(1, chart.labels.length);
  const perSlot = 560 / Math.max(1, chart.labels.length) / 7; // characters that fit under a column
  return !months && avg > perSlot ? "horizontal_bar" : "bar";
}

export function AssistantChart({ chart: spec }: { chart: ChartSpec }) {
  const chart = { ...spec, type: effectiveType(spec) };
  const [copied, setCopied] = useState(false);
  const total = chart.type === "donut" ? chart.series[0]?.values.reduce<number>((s, v) => s + (v ?? 0), 0) : null;
  return (
    <figure className="sa-rise my-3 overflow-hidden rounded-[var(--radius-xl)] border border-border bg-card shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
      <figcaption className="flex items-start justify-between gap-3 px-4 pt-3.5">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-foreground">{chart.title}</div>
          {chart.subtitle && <div className="mt-0.5 text-xs text-muted-foreground">{chart.subtitle}</div>}
        </div>
        <button
          type="button"
          onClick={async () => {
            if (await copyText(toCsv(chart))) {
              setCopied(true);
              setTimeout(() => setCopied(false), 1600);
            }
          }}
          className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          title="Copy the numbers (CSV, pastes into Excel or Sheets)"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? "Copied" : "Copy data"}
        </button>
      </figcaption>
      {chart.series.length > 1 && chart.type !== "donut" && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 pt-2 text-xs text-muted-foreground">
          {chart.series.map((s, i) => (
            <span key={s.name + i} className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-[3px]" style={{ background: SERIES_COLORS[i] }} />
              {s.name}
            </span>
          ))}
        </div>
      )}
      <div className="px-2 pb-3 pt-2">
        {chart.type === "bar" && <Columns chart={chart} />}
        {chart.type === "horizontal_bar" && <Rows chart={chart} />}
        {(chart.type === "line" || chart.type === "area") && <Lines chart={chart} area={chart.type === "area"} />}
        {chart.type === "donut" && <Donut chart={chart} total={total ?? 0} />}
      </div>
    </figure>
  );
}

function Tooltip({ x, label, rows }: { x: number; label: string; rows: { name: string; value: string; color: string }[] }) {
  return (
    <div
      className="pointer-events-none absolute top-1 z-10 min-w-28 -translate-x-1/2 rounded-lg border border-border bg-popover px-2.5 py-1.5 text-xs shadow-lg"
      style={{ left: `${Math.min(88, Math.max(12, x))}%` }}
    >
      <div className="font-medium text-foreground">{label}</div>
      {rows.map((r) => (
        <div key={r.name} className="mt-0.5 flex items-center justify-between gap-3 text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full" style={{ background: r.color }} />
            {r.name || "Value"}
          </span>
          <span className="tabular font-semibold text-foreground">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

const W = 640;
const H = 220;
const PAD = { top: 18, right: 44, bottom: 26, left: 8 };

function Grid({ max, format }: { max: number; format: ChartFormat }) {
  const plotH = H - PAD.top - PAD.bottom;
  return (
    <>
      {[0.5, 1].map((f) => {
        const y = PAD.top + plotH - f * plotH;
        return (
          <g key={f}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y} y2={y} stroke="var(--border)" strokeDasharray="3 4" />
            <text x={W - 4} y={y + 4} textAnchor="end" className="fill-muted-foreground text-[11px] tabular">
              {formatValue(max * f, format, true)}
            </text>
          </g>
        );
      })}
      <line x1={PAD.left} x2={W - PAD.right} y1={PAD.top + plotH} y2={PAD.top + plotH} stroke="var(--border)" />
    </>
  );
}

function XLabels({ labels, slot }: { labels: string[]; slot: number }) {
  // Thin labels out when they'd collide (roughly 46 SVG units per label).
  const every = Math.max(1, Math.ceil(46 / slot));
  return (
    <>
      {labels.map((l, i) =>
        i % every === 0 || i === labels.length - 1 ? (
          <text
            key={i}
            x={PAD.left + slot * i + slot / 2}
            y={H - 8}
            textAnchor="middle"
            className="pointer-events-none fill-muted-foreground text-[11px]"
          >
            {l.length > 10 ? l.slice(0, 9) + "…" : l}
          </text>
        ) : null,
      )}
    </>
  );
}

function Columns({ chart }: { chart: ChartSpec }) {
  const [hover, setHover] = useState<number | null>(null);
  const labels = useLabels(chart.labels);
  const all = chart.series.flatMap((s) => s.values.map((v) => v ?? 0));
  const max = niceMax(Math.max(0, ...all));
  const plotH = H - PAD.top - PAD.bottom;
  const slot = (W - PAD.left - PAD.right) / labels.length;
  const groupW = Math.min(slot * 0.62, 34 * chart.series.length);
  const barW = groupW / chart.series.length;
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={chart.title}>
        <Grid max={max} format={chart.format} />
        {labels.map((_, i) => (
          <g key={i}>
            <rect
              x={PAD.left + slot * i}
              y={PAD.top}
              width={slot}
              height={plotH}
              rx={6}
              fill={hover === i ? "var(--muted)" : "transparent"}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            />
            {chart.series.map((s, si) => {
              const v = s.values[i] ?? 0;
              const h = Math.max(v > 0 ? 2 : 0, (v / max) * plotH);
              const x = PAD.left + slot * i + (slot - groupW) / 2 + si * barW;
              const y = PAD.top + plotH - h;
              const r = Math.min(4, barW / 2 - 1, h);
              return h > 0 ? (
                <path
                  key={si}
                  d={`M${x + 1},${y + h} V${y + r} Q${x + 1},${y} ${x + 1 + r},${y} H${x + barW - 1 - r} Q${x + barW - 1},${y} ${x + barW - 1},${y + r} V${y + h} Z`}
                  fill={SERIES_COLORS[si]}
                  opacity={hover == null || hover === i ? 1 : 0.45}
                  className="sa-grow-y pointer-events-none transition-opacity"
                  style={{ animationDelay: `${120 + i * 40}ms` }}
                />
              ) : null;
            })}
          </g>
        ))}
        <XLabels labels={labels} slot={slot} />
      </svg>
      {hover != null && (
        <Tooltip
          x={((PAD.left + slot * hover + slot / 2) / W) * 100}
          label={chart.labels[hover]}
          rows={chart.series.map((s, si) => ({ name: s.name, value: formatValue(s.values[hover], chart.format), color: SERIES_COLORS[si] }))}
        />
      )}
    </div>
  );
}

function Rows({ chart }: { chart: ChartSpec }) {
  const s = chart.series[0];
  const max = Math.max(1e-9, ...chart.series.flatMap((x) => x.values.map((v) => v ?? 0)));
  return (
    <ul className="flex flex-col gap-2 px-2 py-1">
      {chart.labels.map((label, i) => (
        <li key={label + i} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 text-sm sm:grid-cols-[minmax(0,13rem)_1fr_auto]">
          <span className="truncate text-foreground" title={label}>
            {label}
          </span>
          <span className="flex flex-col gap-1">
            {chart.series.map((series, si) => (
              <span key={si} className="h-2.5 overflow-hidden rounded-full bg-muted">
                <span
                  className="sa-grow-x block h-full rounded-full"
                  style={{
                    width: `${Math.max(0, ((series.values[i] ?? 0) / max) * 100)}%`,
                    background: SERIES_COLORS[si],
                    animationDelay: `${100 + i * 45}ms`,
                  }}
                />
              </span>
            ))}
          </span>
          <span className="tabular text-right text-xs font-semibold text-foreground">
            {chart.series.length === 1
              ? formatValue(s.values[i], chart.format)
              : chart.series.map((x) => formatValue(x.values[i], chart.format, true)).join(" · ")}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Lines({ chart, area }: { chart: ChartSpec; area: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const gid = useId().replace(/:/g, "");
  const labels = useLabels(chart.labels);
  const all = chart.series.flatMap((s) => s.values.map((v) => v ?? 0));
  const max = niceMax(Math.max(0, ...all));
  const plotH = H - PAD.top - PAD.bottom;
  const slot = (W - PAD.left - PAD.right) / labels.length;
  const px = (i: number) => PAD.left + slot * i + slot / 2;
  const py = (v: number) => PAD.top + plotH - (v / max) * plotH;
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={chart.title}>
        <defs>
          {chart.series.map((_, si) => (
            <linearGradient key={si} id={`${gid}-${si}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={SERIES_COLORS[si]} stopOpacity={0.28} />
              <stop offset="100%" stopColor={SERIES_COLORS[si]} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        <Grid max={max} format={chart.format} />
        {chart.series.map((s, si) => {
          const pts = s.values.map((v, i) => [px(i), py(v ?? 0)] as const);
          const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x},${y}`).join(" ");
          const fill = `${d} L${px(pts.length - 1)},${PAD.top + plotH} L${px(0)},${PAD.top + plotH} Z`;
          return (
            <g key={si}>
              {area && <path d={fill} fill={`url(#${gid}-${si})`} className="sa-rise" />}
              <path
                d={d}
                fill="none"
                stroke={SERIES_COLORS[si]}
                strokeWidth={2.5}
                strokeLinejoin="round"
                strokeLinecap="round"
                pathLength={1}
                className="assistant-draw"
              />
              {pts.map(([x, y], i) => (
                <circle
                  key={i}
                  cx={x}
                  cy={y}
                  r={hover === i ? 4.5 : pts.length <= 14 ? 3 : 0}
                  fill="var(--card)"
                  stroke={SERIES_COLORS[si]}
                  strokeWidth={2}
                  className="transition-all"
                />
              ))}
            </g>
          );
        })}
        {labels.map((_, i) => (
          <rect
            key={i}
            x={PAD.left + slot * i}
            y={PAD.top}
            width={slot}
            height={plotH}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          />
        ))}
        {hover != null && (
          <line x1={px(hover)} x2={px(hover)} y1={PAD.top} y2={PAD.top + plotH} stroke="var(--border)" strokeWidth={1} />
        )}
        <XLabels labels={labels} slot={slot} />
      </svg>
      {hover != null && (
        <Tooltip
          x={(px(hover) / W) * 100}
          label={chart.labels[hover]}
          rows={chart.series.map((s, si) => ({ name: s.name, value: formatValue(s.values[hover], chart.format), color: SERIES_COLORS[si] }))}
        />
      )}
    </div>
  );
}

function Donut({ chart, total }: { chart: ChartSpec; total: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const values = chart.series[0].values.map((v) => Math.max(0, v ?? 0));
  const R = 70;
  const C = 2 * Math.PI * R;
  let acc = 0;
  const shown = hover ?? null;
  return (
    <div className="flex flex-col items-center gap-4 px-3 py-2 sm:flex-row sm:items-center sm:gap-8">
      <div className="relative size-44 shrink-0">
        <svg viewBox="0 0 180 180" className="size-full -rotate-90" role="img" aria-label={chart.title}>
          <circle cx={90} cy={90} r={R} fill="none" stroke="var(--muted)" strokeWidth={22} />
          {values.map((v, i) => {
            const len = total > 0 ? (v / total) * C : 0;
            const seg = (
              <circle
                key={i}
                cx={90}
                cy={90}
                r={R}
                fill="none"
                stroke={SLICE_COLORS[i % SLICE_COLORS.length]}
                strokeWidth={hover === i ? 26 : 22}
                strokeDasharray={`${Math.max(0, len - (values.length > 1 ? 1.5 : 0))} ${C}`}
                strokeDashoffset={-acc}
                className="assistant-donut cursor-default transition-[stroke-width]"
                style={{ animationDelay: `${i * 70}ms` }}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              />
            );
            acc += len;
            return seg;
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div>
            <div className="tabular text-xl font-semibold text-foreground">
              {formatValue(shown == null ? total : values[shown], chart.format, true)}
            </div>
            <div className="max-w-24 truncate text-xs text-muted-foreground">
              {shown == null ? "Total" : chart.labels[shown]}
            </div>
          </div>
        </div>
      </div>
      <ul className="grid w-full min-w-0 gap-1.5 text-sm">
        {chart.labels.map((l, i) => (
          <li
            key={l + i}
            className={cn("flex items-center justify-between gap-3 rounded-md px-2 py-1", hover === i && "bg-muted")}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <span className="inline-flex min-w-0 items-center gap-2">
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: SLICE_COLORS[i % SLICE_COLORS.length] }} />
              <span className="truncate text-foreground">{l}</span>
            </span>
            <span className="tabular shrink-0 text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">{formatValue(values[i], chart.format)}</span>
              {total > 0 && ` · ${Math.round((values[i] / total) * 100)}%`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
