"use client";

import { Info } from "lucide-react";
import { Badge } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import { CADENCE, changeClass, fmtChange, GRADE, gradeOf, PACKAGE, REPORT_STATUS, SEVERITY, SOURCE_STATE, STATE } from "../lib";
import type { Cadence, FindingState, Package, PillarKey, PillarMeta, ReportStatus, Severity, Source } from "../types";

export { NoData, Section } from "@/features/gbp/components/parts";
export { Fact, HeadHint } from "@/features/ads/components/parts";

export function DemoBadge() {
  return (
    <Badge tone="dataq" title="Sample data — the first real Search Console sync replaces it">
      Sample data
    </Badge>
  );
}

/** Health score: the number in its grade colour + the letter grade. "Not scored" when fewer than 3 pillars have data. */
export function HealthScore({ score, size = "sm" }: { score: number | null | undefined; size?: "sm" | "lg" }) {
  const g = gradeOf(score);
  if (score == null || !g) {
    return (
      <span className="text-xs text-muted-foreground" title="Needs data from at least 3 of the 6 pillars">
        Not scored
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("font-semibold tabular-nums", GRADE[g].text, size === "lg" ? "text-3xl leading-9" : "text-sm")}>{score}</span>
      <Badge tone={GRADE[g].tone} icon={false}>
        {g}
      </Badge>
    </span>
  );
}

export function GradeBadge({ grade }: { grade: string | null | undefined }) {
  if (!grade || !(grade in GRADE)) return <span className="text-muted-foreground">—</span>;
  return (
    <Badge tone={GRADE[grade as keyof typeof GRADE].tone} icon={false}>
      {grade}
    </Badge>
  );
}

export function SeverityBadge({ s }: { s: Severity }) {
  const x = SEVERITY[s];
  return (
    <Badge tone={x.tone} icon={false} title={`${x.hint} · respond: ${x.sla.toLowerCase()}`} className="font-semibold">
      {x.label}
    </Badge>
  );
}

export function StateBadge({ s }: { s: FindingState }) {
  return (
    <Badge tone={STATE[s].tone} icon={false}>
      {STATE[s].label}
    </Badge>
  );
}

export function PackageBadge({ p }: { p: Package }) {
  return (
    <Badge tone={PACKAGE[p].tone} icon={false}>
      {PACKAGE[p].label}
    </Badge>
  );
}

export function ReportStatusBadge({ s }: { s: ReportStatus }) {
  return <Badge tone={REPORT_STATUS[s].tone}>{REPORT_STATUS[s].label}</Badge>;
}

export const cadenceLabel = (c: Cadence) => CADENCE[c];

export function ChangeText({ v, invert = false, className }: { v: number | null | undefined; invert?: boolean; className?: string }) {
  return <span className={cn("text-xs tabular-nums", changeClass(v, invert), className)}>{fmtChange(v)}</span>;
}

/** Six small bars, one per pillar, coloured by grade; empty outline when the pillar has no data. */
export function PillarBars({ pillars, meta }: { pillars: Record<PillarKey, number | null>; meta: PillarMeta[] }) {
  return (
    <span className="inline-flex items-end gap-0.5" aria-label="Pillar scores">
      {meta.map((m) => {
        const v = pillars[m.key];
        const g = gradeOf(v);
        return (
          <span
            key={m.key}
            title={`${m.label}: ${v ?? "no data"}`}
            className="flex h-5 w-2 items-end overflow-hidden rounded-sm bg-muted"
          >
            {v != null && g && <span className={cn("w-full rounded-sm", GRADE[g].bar)} style={{ height: `${Math.max(12, v)}%` }} />}
          </span>
        );
      })}
    </span>
  );
}

/** Tiny line of a weekly series (oldest → newest). */
export function Sparkline({ values, width = 72, height = 22 }: { values: number[] | null | undefined; width?: number; height?: number }) {
  if (!values || values.length < 2) return <span className="text-xs text-muted-foreground">—</span>;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const pts = values
    .map((v, i) => `${((i / (values.length - 1)) * width).toFixed(1)},${(height - 2 - ((v - min) / (max - min || 1)) * (height - 4)).toFixed(1)}`)
    .join(" ");
  const up = values[values.length - 1] >= values[0];
  return (
    <svg width={width} height={height} aria-hidden className="overflow-visible">
      <polyline points={pts} fill="none" stroke={up ? "var(--series-1)" : "var(--destructive)"} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Weekly bars with week-end labels for small trend cards (Reports Center). */
export function MiniBars({ values, height = 72 }: { values: number[]; height?: number }) {
  const max = Math.max(1, ...values);
  return (
    <div className="flex items-end gap-1" style={{ height }} aria-hidden>
      {values.map((v, i) => (
        <span key={i} className={cn("flex-1 rounded-t-sm", i === values.length - 1 ? "bg-primary" : "bg-primary/35")} style={{ height: `${Math.max(3, (v / max) * 100)}%` }} />
      ))}
    </div>
  );
}

/** "Search Console · Connected   GA4 · Pending …" — where each kind of data comes from. */
export function SourcePills({ sources }: { sources: Source[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {sources.map((s) => {
        const st = SOURCE_STATE[s.state];
        return (
          <span key={s.key} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card py-0.5 pl-2.5 pr-0.5 text-xs text-foreground" title={s.detail}>
            {s.label}
            <Badge tone={st.tone} icon={false} className="h-[18px] px-1.5 text-[11px]">
              {st.label}
            </Badge>
          </span>
        );
      })}
    </div>
  );
}

export function InfoNote({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={cn("flex items-start gap-2 rounded-lg border border-border bg-muted px-3 py-2 text-xs text-muted-foreground", className)}>
      <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

/** Filter chip with an optional count — same as the GBP "Needs attention" chips. */
export function Chip({ on, onClick, children, count, title }: { on: boolean; onClick: () => void; children: React.ReactNode; count?: number; title?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      title={title}
      onClick={onClick}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors",
        on ? "border-primary bg-accent text-primary-subtle-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
      {count != null && <span className={cn("tabular-nums", on ? "text-primary-subtle-foreground/80" : "text-muted-foreground/80")}>{count}</span>}
    </button>
  );
}

/** One-of-n switch — same as the GBP date-range picker. */
export function Segmented<T extends string | number>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="flex w-fit flex-wrap rounded-lg border border-border bg-card p-0.5" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "h-7 rounded-md px-2.5 text-xs font-medium transition-colors",
            value === o.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------ UI previews (no backend) ---- */

/** Small tag on anything that shows sample numbers because its data source isn't built yet. */
export function SampleBadge({ children = "Sample — no backend" }: { children?: React.ReactNode }) {
  return (
    <Badge tone="dataq" icon={false} className="whitespace-nowrap">
      {children}
    </Badge>
  );
}

/** Top of a page (or block) that is a UI preview only: says plainly nothing is saved or real. */
export function PreviewBanner({ title = "UI preview — no backend yet", children }: { title?: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-[var(--radius-card)] border border-dashed border-warning/60 bg-warning-soft px-4 py-3 print:hidden">
      <Info className="mt-0.5 size-4 shrink-0 text-warning-text" aria-hidden />
      <div className="min-w-0 text-sm">
        <div className="font-semibold text-warning-text">{title}</div>
        <div className="text-xs text-foreground/80">
          {children ?? "Everything on this page is placeholder data so the layout can be reviewed. Buttons don't save or send anything."}
        </div>
      </div>
    </div>
  );
}

/** Weekly series as a filled line (Reports Center package cards, as in the prototype). */
export function AreaLine({ values, height = 80 }: { values: number[]; height?: number }) {
  if (values.length < 2) return <span className="text-xs text-muted-foreground">—</span>;
  const W = 300;
  const max = Math.max(1, ...values);
  const min = Math.min(...values);
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * W).toFixed(1)},${(height - 4 - ((v - min) / (max - min || 1)) * (height - 12)).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" className="w-full text-primary" style={{ height }} aria-hidden>
      <polygon points={`0,${height - 4} ${pts} ${W},${height - 4}`} fill="currentColor" opacity={0.1} />
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

const PILLAR_CODE: Record<PillarKey, string> = { cp: "CP", ws: "WS", au: "AU", rt: "RT", ls: "LS", pa: "PA" };
const HEAT: Record<"A" | "B" | "C" | "D", string> = {
  A: "bg-success-subtle text-success-subtle-foreground",
  B: "bg-accent text-primary-subtle-foreground",
  C: "bg-warning-soft text-warning-text",
  D: "bg-destructive-subtle text-text-destructive",
};

/** Pillar heat: one lettered cell per pillar, coloured by its grade (prototype "PILLAR HEAT"). */
export function PillarHeat({ pillars, meta }: { pillars: Record<PillarKey, number | null>; meta: PillarMeta[] }) {
  return (
    <span className="inline-flex gap-0.5" aria-label="Pillar scores">
      {meta.map((m) => {
        const v = pillars[m.key];
        const g = gradeOf(v);
        return (
          <span
            key={m.key}
            title={`${m.label}: ${v ?? "no data"}`}
            className={cn("grid h-5 w-6 place-items-center rounded-[4px] text-[9px] font-bold", g ? HEAT[g] : "border border-dashed border-border text-muted-foreground")}
          >
            {PILLAR_CODE[m.key]}
          </span>
        );
      })}
    </span>
  );
}
