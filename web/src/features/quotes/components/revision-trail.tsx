"use client";

import { useState } from "react";
import { ArrowRight, ChevronDown, ChevronUp, Minus, Plus } from "lucide-react";
import { Badge } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import { formatDateTime } from "@/lib/format";
import { usd } from "../format";
import type { Line } from "../types";

/** The shape both staff Revision and PublicRevision share. */
export interface TrailRevision {
  revNo: number;
  authorKind: "STAFF" | "RESTAURANT";
  authorName?: string | null;
  note?: string | null;
  hardwarePlan: string;
  lines: Line[];
  totals?: { oneTime: string; monthly: string } | null;
  createdAt: string;
}

export interface LineChange {
  kind: "added" | "removed" | "qty" | "price";
  name: string;
  from?: string;
  to?: string;
}

/** What changed between two revisions, by SKU: added/removed items, quantity and unit-price moves. */
export function diffRevisions(prev: Line[], next: Line[]): LineChange[] {
  const by = (lines: Line[]) => new Map(lines.map((l) => [`${l.sku}·${l.billing}`, l]));
  const a = by(prev);
  const b = by(next);
  const out: LineChange[] = [];
  for (const [key, line] of b) {
    const old = a.get(key);
    if (!old) {
      out.push({ kind: "added", name: line.name, to: `× ${line.qty}` });
      continue;
    }
    if (old.qty !== line.qty) out.push({ kind: "qty", name: line.name, from: `× ${old.qty}`, to: `× ${line.qty}` });
    if (old.unitPrice != null && line.unitPrice != null && old.unitPrice !== line.unitPrice) {
      out.push({ kind: "price", name: line.name, from: usd(old.unitPrice), to: usd(line.unitPrice) });
    }
  }
  for (const [key, line] of a) {
    if (!b.has(key)) out.push({ kind: "removed", name: line.name, from: `× ${line.qty}` });
  }
  return out;
}

export function ChangeList({ changes, className }: { changes: LineChange[]; className?: string }) {
  if (!changes.length) return <p className={cn("text-sm text-muted-foreground", className)}>Same items as before.</p>;
  return (
    <ul className={cn("flex flex-col gap-1 text-sm", className)}>
      {changes.map((c, i) => (
        <li key={i} className="flex items-center gap-1.5">
          {c.kind === "added" && <Plus className="size-3.5 shrink-0 text-success" aria-hidden />}
          {c.kind === "removed" && <Minus className="size-3.5 shrink-0 text-text-destructive" aria-hidden />}
          {(c.kind === "qty" || c.kind === "price") && <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
          <span className="text-foreground">{c.name}</span>
          <span className="tabular-nums text-muted-foreground">
            {c.kind === "added" && <>added {c.to}</>}
            {c.kind === "removed" && <>removed</>}
            {(c.kind === "qty" || c.kind === "price") && (
              <>
                {c.from} <span aria-hidden>→</span> {c.to}
              </>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The negotiation history, newest first: who sent each revision, their note,
 * the totals (when visible) and what changed against the one before.
 */
export function RevisionTrail({
  revisions,
  currentRevisionNo,
  author,
  renderActions,
}: {
  revisions: TrailRevision[];
  currentRevisionNo: number;
  /** How to label each side for this audience ("Innowi"/"You" on the public page). */
  author: (rev: TrailRevision) => string;
  renderActions?: (rev: TrailRevision) => React.ReactNode;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const ordered = [...revisions].sort((a, b) => b.revNo - a.revNo);
  return (
    <ol className="flex flex-col gap-2">
      {ordered.map((rev) => {
        const prev = revisions.find((r) => r.revNo === rev.revNo - 1);
        const changes = prev ? diffRevisions(prev.lines, rev.lines) : [];
        const expanded = open === rev.revNo;
        return (
          <li key={rev.revNo} className="rounded-lg border border-border bg-background">
            <button
              type="button"
              className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left"
              onClick={() => setOpen(expanded ? null : rev.revNo)}
              aria-expanded={expanded}
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-semibold text-foreground">
                    {rev.revNo === 1 ? "Original request" : `Revision ${rev.revNo}`}
                  </span>
                  <Badge tone={rev.authorKind === "STAFF" ? "accent" : "neutral"}>{author(rev)}</Badge>
                  {rev.revNo === currentRevisionNo && <Badge tone="success">Current</Badge>}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {formatDateTime(rev.createdAt)}
                  {rev.totals && (
                    <span className="tabular-nums"> · {usd(rev.totals.oneTime)} at start · {usd(rev.totals.monthly)}/mo</span>
                  )}
                </div>
              </div>
              {expanded ? <ChevronUp className="size-4 shrink-0 text-muted-foreground" aria-hidden /> : <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
            </button>
            {expanded && (
              <div className="border-t border-border px-3 py-2.5">
                {rev.note && <p className="mb-2 whitespace-pre-line text-sm text-foreground">“{rev.note}”</p>}
                {prev ? (
                  <>
                    <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Changes from {prev.revNo === 1 ? "the original" : `revision ${prev.revNo}`}
                    </div>
                    <ChangeList changes={changes} />
                  </>
                ) : (
                  <ul className="flex flex-col gap-1 text-sm">
                    {rev.lines.map((l, i) => (
                      <li key={i} className="flex justify-between gap-2">
                        <span className="text-foreground">{l.name}</span>
                        <span className="tabular-nums text-muted-foreground">× {l.qty}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {renderActions?.(rev)}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
