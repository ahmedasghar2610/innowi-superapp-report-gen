import Link from "next/link";
import { Info, ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";
import type { Kpi } from "../data/command-center.mock";
import { cn } from "@/lib/utils/cn";

/**
 * 3 · KPI card (Figma node 17:189): label 12/16 muted + info · value 24/32
 * semibold · delta 12/16 (semibold, state colour) + compare (muted) · 34px
 * Signal Blue sparkline. Live KPIs have no daily series portfolio-wide, so
 * they draw a current-vs-previous bar in the sparkline's place.
 * `upIsGood: undefined` + no trend colour = neutral metric (e.g. spend).
 */
export function KpiCard({ kpi }: { kpi: Kpi }) {
  const neutral = kpi.key === "ads-spend" || kpi.trend === "flat";
  const good = kpi.trend === "up" ? kpi.upIsGood !== false : kpi.upIsGood === false;
  const Arrow = kpi.trend === "flat" ? Minus : kpi.trend === "up" ? ArrowUpRight : ArrowDownRight;
  const body = (
    <>
      <div className="flex items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate text-xs font-medium leading-4 text-muted-foreground">{kpi.label}</span>
        <span title={kpi.hint} className="inline-flex">
          <Info className="size-4 text-muted-foreground" aria-label={kpi.hint} />
        </span>
      </div>
      <div className="whitespace-nowrap text-2xl font-semibold leading-8 tabular-nums text-foreground">{kpi.value}</div>
      <div className="flex items-center gap-1 text-xs leading-4">
        <Arrow className={cn("size-4", neutral ? "text-muted-foreground" : good ? "text-success" : "text-destructive")} aria-hidden />
        <span className={cn("font-semibold", neutral ? "text-foreground" : good ? "text-success-subtle-foreground" : "text-text-destructive")}>{kpi.delta}</span>
        <span className="truncate text-muted-foreground">{kpi.compare}</span>
      </div>
      {kpi.spark.length > 1 ? <Sparkline points={kpi.spark} /> : <CompareBar current={kpi.current} previous={kpi.previous} />}
    </>
  );
  const cls = "flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-card px-4 py-3.5";
  return kpi.href ? (
    <Link href={kpi.href} className={cn(cls, "transition-colors hover:border-primary-border")}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** Two thin bars: this period (Signal Blue) over the previous one (muted). */
function CompareBar({ current, previous }: { current?: number | null; previous?: number | null }) {
  const max = Math.max(current ?? 0, previous ?? 0) || 1;
  const pct = (v?: number | null) => `${Math.max(2, ((v ?? 0) / max) * 100)}%`;
  return (
    <div className="flex h-[34px] flex-col justify-center gap-1.5" aria-hidden>
      <div className="h-1.5 rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: pct(current) }} />
      </div>
      <div className="h-1.5 rounded-full bg-muted">
        <div className="h-full rounded-full bg-muted-foreground/40" style={{ width: pct(previous) }} />
      </div>
    </div>
  );
}

function Sparkline({ points }: { points: number[] }) {
  const w = 196;
  const h = 34;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const d = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * w;
      const y = h - 2 - ((p - min) / span) * (h - 4);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-[34px] w-full text-primary" preserveAspectRatio="none" aria-hidden>
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
