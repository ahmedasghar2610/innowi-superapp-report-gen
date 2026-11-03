"use client";

import { CircleCheck, CircleDashed, FileText, Loader2, Pencil, Send, Trash2, TriangleAlert, type LucideIcon } from "lucide-react";
import { Badge, type BadgeTone } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import type { ReportStatus } from "../types";

/**
 * One description of a report's state, shared by the queue and the review
 * sidebar. `due` is the virtual state for a merchant with no report yet.
 *
 * Status is never colour alone — every chip carries an icon and a word, so it
 * reads the same to someone who cannot separate the hues.
 *
 * Tones are the project's existing semantic tokens. Two notes on the choices:
 *  · `edited` uses the data-quality tone (`dataq`) rather than `warning`,
 *    because Draft and Edited must be told apart and both were amber before.
 *    It is the closest existing token, not a new colour.
 *  · `due` ("Not generated") uses `neutral` — nothing has happened yet, so it
 *    should not look like a warning.
 */
export type RowStatus = ReportStatus | "due";

export const STATUS_META: Record<RowStatus, { label: string; tone: BadgeTone; Icon: LucideIcon; bar: string; needsAction: boolean }> = {
  due: { label: "Not generated", tone: "neutral", Icon: CircleDashed, bar: "bg-muted-foreground/40", needsAction: true },
  generating: { label: "Generating", tone: "accent", Icon: Loader2, bar: "bg-primary/50", needsAction: false },
  draft: { label: "Draft", tone: "warning", Icon: FileText, bar: "bg-warning", needsAction: true },
  edited: { label: "Edited", tone: "dataq", Icon: Pencil, bar: "bg-data-issue", needsAction: true },
  approved: { label: "Approved", tone: "success", Icon: CircleCheck, bar: "bg-success", needsAction: false },
  sent: { label: "Sent", tone: "success-solid", Icon: Send, bar: "bg-success/70", needsAction: false },
  failed: { label: "Failed", tone: "danger", Icon: TriangleAlert, bar: "bg-destructive", needsAction: true },
  deleted: { label: "Deleted", tone: "neutral", Icon: Trash2, bar: "bg-muted-foreground/40", needsAction: true },
};

/** The order "Needs action first" sorts by. */
export const ACTION_ORDER: RowStatus[] = ["draft", "edited", "failed", "due", "generating", "approved", "sent", "deleted"];

/** Statuses offered as filter chips, in the order they appear. */
export const CHIP_ORDER: RowStatus[] = ["due", "generating", "draft", "edited", "approved", "sent", "failed", "deleted"];

export function StatusChip({ status, className }: { status: RowStatus; className?: string }) {
  const meta = STATUS_META[status] ?? STATUS_META.due;
  const { Icon } = meta;
  return (
    <Badge tone={meta.tone} icon={false} className={className}>
      <Icon className={cn("size-3.5", status === "generating" && "motion-safe:animate-spin")} aria-hidden />
      {meta.label}
    </Badge>
  );
}

/* --------------------------------------------------------------------------
   Kept for the review sidebar, which asks for a status by its API value only.
   -------------------------------------------------------------------------- */
export const STATUS: Record<ReportStatus, { label: string; tone: BadgeTone }> = Object.fromEntries(
  (Object.keys(STATUS_META) as RowStatus[]).filter((k) => k !== "due").map((k) => [k, { label: STATUS_META[k].label, tone: STATUS_META[k].tone }]),
) as Record<ReportStatus, { label: string; tone: BadgeTone }>;

export function StatusBadge({ s }: { s: ReportStatus }) {
  return <StatusChip status={s} />;
}
