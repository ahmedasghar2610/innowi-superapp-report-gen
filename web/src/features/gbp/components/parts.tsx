"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Badge, Button, Input } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import {
  changeText,
  changeTone,
  fmtRange,
  OPEN_STATUS,
  PRESETS,
  rangeFromParams,
  rangeToParams,
  resolvePreset,
  SYNC_STATE,
  VERIFICATION,
  type RangeState,
} from "../lib";
import type { Change, OpenStatus, SyncState, Verification } from "../types";

/** Range kept in the URL (?range=30d or ?range=custom&start&end) so the
 *  overview and a listing report share it and a link reproduces the view. */
export function useRangeParam(through: string | null) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const state = rangeFromParams(new URLSearchParams(params.toString()));
  const dates = resolvePreset(state, through);
  const set = (next: RangeState, extra: Record<string, string | undefined> = {}) => {
    const p = new URLSearchParams(params.toString());
    ["range", "start", "end"].forEach((k) => p.delete(k));
    Object.entries({ ...rangeToParams(next), ...extra }).forEach(([k, v]) => (v ? p.set(k, v) : p.delete(k)));
    router.replace(`${pathname}?${p.toString()}`, { scroll: false });
  };
  return { state, dates, set, query: params };
}

export function RangePicker({
  state,
  through,
  onChange,
}: {
  state: RangeState;
  through: string | null;
  onChange: (r: RangeState) => void;
}) {
  const resolved = resolvePreset(state, through);
  const [start, setStart] = useState(resolved.start ?? "");
  const [end, setEnd] = useState(resolved.end ?? "");
  useEffect(() => {
    setStart(resolved.start ?? "");
    setEnd(resolved.end ?? "");
  }, [resolved.start, resolved.end]);

  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      <div className="flex flex-wrap rounded-lg border border-border bg-card p-0.5" role="group" aria-label="Date range">
        {[...PRESETS, { key: "custom" as const, label: "Custom" }].map((p) => (
          <button
            key={p.key}
            type="button"
            aria-pressed={state.preset === p.key}
            onClick={() =>
              p.key === "custom"
                ? onChange({ preset: "custom", start: resolved.start, end: resolved.end })
                : onChange({ preset: p.key })
            }
            className={cn(
              "h-7 rounded-md px-2.5 text-xs font-medium transition-colors",
              state.preset === p.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground",
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      {state.preset === "custom" && (
        <form
          className="flex items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (start && end) onChange({ preset: "custom", start, end });
          }}
        >
          <Input type="date" value={start} max={end || through || undefined} onChange={(e) => setStart(e.target.value)} className="h-8 w-[9.5rem]" aria-label="From" />
          <span className="text-xs text-muted-foreground">to</span>
          <Input type="date" value={end} min={start} max={through || undefined} onChange={(e) => setEnd(e.target.value)} className="h-8 w-[9.5rem]" aria-label="To" />
          <Button type="submit" size="sm" variant="outline">
            Apply
          </Button>
        </form>
      )}
    </div>
  );
}

export function RangeCaption({ start, end, prevStart, prevEnd, through }: { start: string; end: string; prevStart: string; prevEnd: string; through: string | null }) {
  return (
    <p className="text-xs text-muted-foreground">
      {fmtRange(start, end)} · compared with {fmtRange(prevStart, prevEnd)}
      {through && <> · Google data through {fmtRange(through, through).split(" – ")[1]}</>}
    </p>
  );
}

export function ChangeLine({ change, suffix, className }: { change: Change | undefined; suffix?: string; className?: string }) {
  const tone = changeTone(change);
  return (
    <span
      className={cn(
        "text-xs tabular-nums",
        tone === "up" ? "text-success-subtle-foreground" : tone === "down" ? "text-text-destructive" : "text-muted-foreground",
        className,
      )}
    >
      {changeText(change, suffix)}
    </span>
  );
}

export function StatusBadges({
  openStatus,
  verification,
  syncState,
  showVerified = false,
  showOpen = false,
}: {
  openStatus: OpenStatus;
  verification?: Verification;
  syncState?: SyncState;
  /** In the header, also say "Verified" / "Open"; in lists only exceptions show. */
  showVerified?: boolean;
  showOpen?: boolean;
}) {
  const o = OPEN_STATUS[openStatus];
  const v = verification ? VERIFICATION[verification] : null;
  const s = syncState ? SYNC_STATE[syncState] : null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {(showOpen || o.tone !== "success") && <Badge tone={o.tone}>{o.label}</Badge>}
      {v && (showVerified || verification !== "verified") && verification !== "unknown" && <Badge tone={v.tone}>{v.label}</Badge>}
      {s && <Badge tone={s.tone}>{s.label}</Badge>}
    </span>
  );
}

export function DemoBadge() {
  return (
    <Badge tone="dataq" title="Sample data from scripts/seed_gbp_demo.py — replaced by the first real sync">
      Sample data
    </Badge>
  );
}

export function NoData({ label = "No data" }: { label?: string }) {
  return <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{label}</span>;
}

export function Section({ title, aside, children, className }: { title: string; aside?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("flex flex-col gap-2.5", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex-1 text-base font-semibold text-foreground">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}
