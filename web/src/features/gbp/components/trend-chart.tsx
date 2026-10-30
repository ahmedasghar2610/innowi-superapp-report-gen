"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { fmtDay, fmtNum } from "../lib";

/*
 * Daily trend for one or more metrics over the picked range, on ONE y-axis.
 *
 * - One series  → its line plus the previous period of the same length as a
 *   dashed gray reference line (aligned day 1 ↔ day 1).
 * - Several     → one 2px line per metric in its fixed categorical colour
 *   (colour follows the metric, never the selection order), a legend, and a
 *   direct label at each line's end. No previous-period lines (too busy).
 *
 * Crosshair + tooltip on hover. Days with no synced data are gaps — never 0.
 */

export interface TrendSeries {
  key: string;
  label: string;
  /** CSS colour (a var(--series-n) token). */
  color: string;
  values: (number | null)[];
}

const H = 260;
const PAD = { top: 12, bottom: 26, left: 44 };

/** Round step so the top gridline is ≥ the data max with 4 round intervals. */
function niceScale(v: number): { max: number; step: number } {
  const raw = Math.max(v, 4) / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pow;
  const s = Number.isInteger(step) ? step : Math.ceil(step);
  return { max: Math.ceil(v / s) * s || s * 4, step: s };
}

function path(values: (number | null)[], x: (i: number) => number, y: (v: number) => number): string {
  let d = "";
  let pen = false;
  values.forEach((v, i) => {
    if (v == null) {
      pen = false;
      return;
    }
    d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
    pen = true;
  });
  return d;
}

const lastIndex = (values: (number | null)[]) => {
  for (let i = values.length - 1; i >= 0; i--) if (values[i] != null) return i;
  return -1;
};

export function TrendChart({
  dates,
  series,
  previous,
  previousDates,
  format = fmtNum,
  gapNote = "Gaps are days Google hasn't sent data for yet — not zero activity.",
}: {
  dates: string[];
  series: TrendSeries[];
  /** Only drawn when there is exactly one series. */
  previous?: (number | null)[];
  previousDates?: string[];
  /** Axis and tooltip values (default: plain numbers). */
  format?: (v: number | null | undefined) => string;
  gapNote?: string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(720);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(300, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const single = series.length === 1;
  const prev = single && previous ? previous.slice(0, dates.length) : null;
  const n = dates.length;
  const all = [...series.flatMap((s) => s.values), ...(prev ?? [])].filter((v): v is number => v != null);
  const { max, step } = useMemo(() => niceScale(Math.max(1, ...all)), [all.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const padRight = single ? 12 : 96; // room for end labels
  const innerW = w - PAD.left - padRight;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step);
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(innerW / 80))));
  const hasGaps = series.some((s) => s.values.some((v) => v == null));

  // Direct end labels, nudged apart so they never overlap (≥ 13px).
  const endLabels = useMemo(() => {
    if (single) return [];
    const items = series
      .map((s) => {
        const i = lastIndex(s.values);
        return i < 0 ? null : { key: s.key, label: s.label, color: s.color, x: x(i), y: y(s.values[i] as number) };
      })
      .filter((v): v is NonNullable<typeof v> => !!v)
      .sort((a, b) => a.y - b.y);
    for (let k = 1; k < items.length; k++) if (items[k].y - items[k - 1].y < 13) items[k].y = items[k - 1].y + 13;
    return items;
  }, [series, w, max]); // eslint-disable-line react-hooks/exhaustive-deps

  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const rel = (e.clientX - rect.left) / rect.width;
    setHover(Math.max(0, Math.min(n - 1, Math.round(rel * (n - 1)))));
  };

  return (
    <div className="flex flex-col gap-2">
      {/* With several series the metric chips above the chart (coloured dots)
          are the legend, and each line carries a direct end label. */}
      <div className={single ? "flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground" : "sr-only"}>
        {series.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <svg width="18" height="6" aria-hidden>
              <line x1="0" y1="3" x2="18" y2="3" stroke={s.color} strokeWidth="2" strokeLinecap="round" />
            </svg>
            {s.label}
            {single && " · this period"}
          </span>
        ))}
        {prev && (
          <span className="inline-flex items-center gap-1.5">
            <svg width="18" height="6" aria-hidden>
              <line x1="0" y1="3" x2="18" y2="3" stroke="var(--chart-2)" strokeWidth="2" strokeDasharray="4 3" />
            </svg>
            Previous period
          </span>
        )}
      </div>
      <div ref={wrap} className="relative">
        <svg width={w} height={H} role="img" aria-label={`${series.map((s) => s.label).join(", ")} per day`} className="block">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={PAD.left + innerW} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth="1" />
              <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[11px] tabular-nums">
                {format(Math.round(t))}
              </text>
            </g>
          ))}
          {dates.map((d, i) =>
            i % labelEvery === 0 || i === n - 1 ? (
              <text key={d} x={x(i)} y={H - 6} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"} className="fill-muted-foreground text-[11px]">
                {fmtDay(d, false)}
              </text>
            ) : null,
          )}
          {prev && <path d={path(prev, x, y)} fill="none" stroke="var(--chart-2)" strokeWidth="2" strokeDasharray="4 3" strokeLinejoin="round" strokeLinecap="round" />}
          {series.map((s) => (
            <path key={s.key} d={path(s.values, x, y)} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {endLabels.map((l) => (
            <text key={l.key} x={PAD.left + innerW + 8} y={l.y} dy="0.32em" className="fill-foreground text-[11px]">
              {l.label}
            </text>
          ))}
          {hover != null && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + innerH} stroke="var(--muted-foreground)" strokeWidth="1" strokeDasharray="2 2" />
              {prev && prev[hover] != null && <circle cx={x(hover)} cy={y(prev[hover] as number)} r="4" fill="var(--chart-2)" stroke="var(--card)" strokeWidth="2" />}
              {series.map((s) =>
                s.values[hover] != null ? (
                  <circle key={s.key} cx={x(hover)} cy={y(s.values[hover] as number)} r="4.5" fill={s.color} stroke="var(--card)" strokeWidth="2" />
                ) : null,
              )}
            </g>
          )}
          <rect x={PAD.left} y={PAD.top} width={innerW} height={innerH} fill="transparent" onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
        </svg>
        {hover != null && (
          <div
            className="pointer-events-none absolute top-2 z-10 min-w-44 rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-md"
            style={{ left: Math.min(Math.max(x(hover) + 12, 0), w - 200) }}
          >
            <div className="mb-1 text-muted-foreground">{fmtDay(dates[hover])}</div>
            {series.map((s) => (
              <div key={s.key} className="flex items-center justify-between gap-4">
                <span className="inline-flex items-center gap-1.5 text-foreground">
                  <span className="size-2 rounded-full" style={{ background: s.color }} />
                  {s.label}
                </span>
                <span className="font-semibold tabular-nums text-foreground">{s.values[hover] == null ? "No data" : format(s.values[hover])}</span>
              </div>
            ))}
            {prev && previousDates?.[hover] && (
              <div className="mt-1 flex items-center justify-between gap-4 border-t border-border pt-1">
                <span className="text-muted-foreground">{fmtDay(previousDates[hover])}</span>
                <span className="tabular-nums text-muted-foreground">{prev[hover] == null ? "No data" : format(prev[hover])}</span>
              </div>
            )}
          </div>
        )}
      </div>
      {hasGaps && <p className="text-xs text-muted-foreground">{gapNote}</p>}
    </div>
  );
}
