"use client";

import { cn } from "@/lib/utils/cn";

/**
 * The three charts of the SEO team's monthly report, copied from Zainab's Kabob Fusion
 * September 2026 report (same section, chart type and colours):
 *
 *   Key Metrics       → "Clicks vs. Impressions — June to September": impressions as light-grey
 *                        bars (left axis) with clicks as a green line (right axis)
 *   Branded           → "Branded vs. Non-Branded Clicks (query-level data)": grouped bars per
 *                        month, branded navy / non-branded grey
 *   Device Breakdown  → two panels, "Impressions" and "CTR", Mobile navy / Desktop grey per
 *                        month, under a one-line headline
 *
 * Plain SVG so they print sharply; every bar / point carries its value and a hover tooltip.
 */

const K = {
  navy: "fill-[#1f2937] dark:fill-slate-200",
  grey: "fill-[#9ca3af] dark:fill-slate-500",
  light: "fill-[#d1d5db] dark:fill-slate-600",
  green: "stroke-[#15803d] dark:stroke-[#22c55e]",
  greenFill: "fill-[#15803d] dark:fill-[#22c55e]",
  swNavy: "bg-[#1f2937] dark:bg-slate-200",
  swGrey: "bg-[#9ca3af] dark:bg-slate-500",
  swLight: "bg-[#d1d5db] dark:bg-slate-600",
  swGreen: "bg-[#15803d] dark:bg-[#22c55e]",
};

const fmtN = (v: number) => Math.round(v).toLocaleString("en-US");

/** Nice round axis maximum and step (e.g. 11,649 → 16,000 in 2,000s). */
function niceAxis(max: number, ticks = 8) {
  const raw = Math.max(max, 1) / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  return { step, top: Math.ceil((max * 1.12) / step) * step || step };
}

function Figure({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <figure className={cn("flex flex-col items-center gap-1 print:break-inside-avoid", className)}>
      <figcaption className="text-center text-sm font-bold text-foreground">{title}</figcaption>
      {children}
    </figure>
  );
}

function LegendBox({ items }: { items: { label: string; swatch: string; line?: boolean }[] }) {
  return (
    <div className="flex flex-col gap-0.5 text-[10px] text-foreground">
      {items.map((l) => (
        <span key={l.label} className="inline-flex items-center gap-1.5">
          {l.line ? (
            <span className="relative inline-block h-2 w-4">
              <span className={cn("absolute inset-x-0 top-[3px] h-0.5", l.swatch)} />
              <span className={cn("absolute left-[5px] top-[1px] size-1.5 rounded-full", l.swatch)} />
            </span>
          ) : (
            <span className={cn("inline-block h-2 w-4", l.swatch)} />
          )}
          {l.label}
        </span>
      ))}
    </div>
  );
}

/** Key Metrics: impressions bars (left axis) + clicks line (right axis), one point per month. */
export function ClicksVsImpressions({
  title,
  months,
}: {
  title: string;
  months: { label: string; clicks: number; impressions: number }[];
}) {
  const W = 640, H = 300, L = 62, R = 52, T = 14, B = 30;
  const pw = W - L - R, ph = H - T - B;
  const ia = niceAxis(Math.max(...months.map((m) => m.impressions)));
  const ca = niceAxis(Math.max(...months.map((m) => m.clicks)), 5);
  const slot = pw / months.length;
  const bw = slot * 0.55;
  const yI = (v: number) => T + ph - (ph * v) / ia.top;
  const yC = (v: number) => T + ph - (ph * v) / ca.top;
  const cx = (i: number) => L + slot * i + slot / 2;
  const iTicks = Array.from({ length: Math.round(ia.top / ia.step) + 1 }, (_, i) => i * ia.step);
  const cTicks = Array.from({ length: Math.round(ca.top / ca.step) + 1 }, (_, i) => i * ca.step);
  return (
    <Figure title={title}>
      <div className="w-full max-w-[640px]">
        <div className="flex justify-end pr-[64px]">
          <LegendBox items={[{ label: "Impressions", swatch: K.swLight }, { label: "Clicks", swatch: K.swGreen, line: true }]} />
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={title}>
          {/* axes */}
          <line x1={L} x2={L} y1={T} y2={T + ph} className="stroke-foreground" strokeWidth={1} />
          <line x1={L + pw} x2={L + pw} y1={T} y2={T + ph} className="stroke-foreground" strokeWidth={1} />
          <line x1={L} x2={L + pw} y1={T + ph} y2={T + ph} className="stroke-foreground" strokeWidth={1} />
          {iTicks.map((t) => (
            <text key={"i" + t} x={L - 5} y={yI(t) + 3} textAnchor="end" className="fill-foreground text-[10px] tabular-nums">
              {fmtN(t)}
            </text>
          ))}
          {cTicks.map((t) => (
            <text key={"c" + t} x={L + pw + 5} y={yC(t) + 3} className="fill-foreground text-[10px] tabular-nums">
              {fmtN(t)}
            </text>
          ))}
          <text transform={`translate(13 ${T + ph / 2}) rotate(-90)`} textAnchor="middle" className="fill-foreground text-[11px]">
            Impressions
          </text>
          <text transform={`translate(${W - 8} ${T + ph / 2}) rotate(-90)`} textAnchor="middle" className={cn("text-[11px]", K.greenFill)}>
            Clicks
          </text>
          {/* impressions bars */}
          {months.map((m, i) => (
            <g key={m.label}>
              <title>{`${m.label}: ${fmtN(m.impressions)} impressions, ${fmtN(m.clicks)} clicks`}</title>
              <rect x={cx(i) - bw / 2} y={yI(m.impressions)} width={bw} height={T + ph - yI(m.impressions)} className={K.light} />
              {/* Inside the bar when the clicks label would sit on top of it. */}
              <text
                x={cx(i)}
                y={Math.abs(yC(m.clicks) - 9 - (yI(m.impressions) - 5)) < 16 ? yI(m.impressions) + 14 : yI(m.impressions) - 5}
                textAnchor="middle"
                className="fill-muted-foreground text-[10px] tabular-nums"
              >
                {fmtN(m.impressions)}
              </text>
              <text x={cx(i)} y={H - 10} textAnchor="middle" className="fill-foreground text-[11px] font-semibold">
                {m.label}
              </text>
            </g>
          ))}
          {/* clicks line */}
          <path
            d={months.map((m, i) => `${i ? "L" : "M"}${cx(i)},${yC(m.clicks)}`).join(" ")}
            fill="none"
            className={K.green}
            strokeWidth={2.5}
            strokeLinejoin="round"
          />
          {months.map((m, i) => (
            <g key={m.label + "c"}>
              <circle cx={cx(i)} cy={yC(m.clicks)} r={4.5} className={K.greenFill} />
              <text x={cx(i)} y={yC(m.clicks) - 9} textAnchor="middle" className={cn("text-[12px] font-bold tabular-nums", K.greenFill)}>
                {fmtN(m.clicks)}
              </text>
            </g>
          ))}
        </svg>
      </div>
    </Figure>
  );
}

/**
 * Grouped bars in the report's style: groups = months, two series (navy, grey), value on
 * every bar, legend top-right. Used for branded vs non-branded clicks and the device panels.
 */
export function PairBars({
  groups,
  series,
  format = fmtN,
  compact = false,
}: {
  groups: { label: string; values: [number | null, number | null] }[];
  series: [string, string];
  format?: (v: number) => string;
  compact?: boolean;
}) {
  const W = compact ? 320 : 640, H = compact ? 230 : 250, L = compact ? 46 : 44, R = 10, T = 14, B = 26;
  const pw = W - L - R, ph = H - T - B;
  const vals = groups.flatMap((g) => g.values.map((v) => v ?? 0));
  const ax = niceAxis(Math.max(...vals, 0), compact ? 7 : 5);
  const slot = pw / groups.length;
  const bw = slot * (compact ? 0.34 : 0.33);
  const y = (v: number) => T + ph - (ph * v) / ax.top;
  const ticks = Array.from({ length: Math.round(ax.top / ax.step) + 1 }, (_, i) => i * ax.step);
  const cls = [K.navy, K.grey];
  return (
    <div className="w-full" style={{ maxWidth: W }}>
      <div className="flex justify-end pr-3">
        <LegendBox items={[{ label: series[0], swatch: K.swNavy }, { label: series[1], swatch: K.swGrey }]} />
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img">
        <line x1={L} x2={L} y1={T} y2={T + ph} className="stroke-foreground" strokeWidth={1} />
        <line x1={L} x2={L + pw} y1={T + ph} y2={T + ph} className="stroke-foreground" strokeWidth={1} />
        {ticks.map((t) => (
          <text key={t} x={L - 5} y={y(t) + 3} textAnchor="end" className="fill-foreground text-[10px] tabular-nums">
            {format === fmtN ? fmtN(t) : Number.isInteger(t) ? t : t.toFixed(1)}
          </text>
        ))}
        {groups.map((g, gi) => {
          const x0 = L + slot * gi + slot / 2 - bw;
          return (
            <g key={g.label}>
              {g.values.map((v, si) => {
                const val = v ?? 0;
                return (
                  <g key={si}>
                    <title>{`${g.label} · ${series[si]}: ${v == null ? "—" : format(val)}`}</title>
                    <rect x={x0 + si * bw} y={y(val)} width={bw} height={T + ph - y(val)} className={cls[si]} />
                    <text
                      x={x0 + si * bw + bw / 2}
                      y={y(val) - 4}
                      textAnchor="middle"
                      className={cn("text-[11px] font-bold tabular-nums", si ? "fill-muted-foreground" : "fill-foreground")}
                    >
                      {v == null ? "—" : format(val)}
                    </text>
                  </g>
                );
              })}
              <text x={L + slot * gi + slot / 2} y={H - 8} textAnchor="middle" className="fill-foreground text-[11px] font-semibold">
                {g.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** Branded section: "Branded vs. Non-Branded Clicks (query-level data)". */
export function BrandedClicks({ groups }: { groups: { label: string; values: [number | null, number | null] }[] }) {
  return (
    <Figure title="Branded vs. Non-Branded Clicks (query-level data)">
      <PairBars groups={groups} series={["Branded clicks", "Non-branded clicks"]} />
    </Figure>
  );
}

/** Device section: a headline over two panels, Impressions and CTR, Mobile vs Desktop per month. */
export function DevicePanels({
  title,
  impressions,
  ctr,
  names,
}: {
  title: string;
  impressions: { label: string; values: [number | null, number | null] }[];
  /** CTR in percent (2.79 = 2.79%). */
  ctr: { label: string; values: [number | null, number | null] }[];
  names: [string, string];
}) {
  return (
    <Figure title={title}>
      <div className="grid w-full max-w-[660px] grid-cols-2 gap-4">
        <div className="flex flex-col items-center">
          <span className="text-xs font-bold text-foreground">Impressions</span>
          <PairBars compact groups={impressions} series={names} />
        </div>
        <div className="flex flex-col items-center">
          <span className="text-xs font-bold text-foreground">CTR</span>
          <PairBars compact groups={ctr} series={names} format={(v) => `${+v.toFixed(2)}%`} />
        </div>
      </div>
    </Figure>
  );
}
