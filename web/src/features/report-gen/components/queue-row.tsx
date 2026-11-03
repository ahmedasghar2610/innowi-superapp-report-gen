"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, Copy, Ellipsis, ExternalLink, Link2, ListX, RefreshCw } from "lucide-react";
import { Button, TableCell, TableRow, useToast } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import { useApprove, useGenerate } from "../api";
import { initials } from "../format";
import type { QueueRow as Row } from "../types";
import { STATUS_META, StatusChip, type RowStatus } from "./report-status";

/**
 * How many metrics a full monthly report carries.
 *
 * FLAGGED: the queue endpoint returns only `missingCount`, with no total to
 * divide it by, so this is a constant rather than live data. 70 is PRD A's P1
 * metric count. If the API ever returns a per-report total, read it instead.
 */
export const TOTAL_METRICS = 70;

export type Band = { word: string; text: string; bar: string };
/** Completeness bands, using the project's existing semantic tokens. */
export function band(pct: number): Band {
  if (pct >= 85) return { word: "Good", text: "text-success-subtle-foreground", bar: "bg-success" };
  if (pct >= 65) return { word: "Fair", text: "text-warning-text", bar: "bg-warning" };
  return { word: "Low", text: "text-text-destructive", bar: "bg-destructive" };
}

export const rowStatus = (row: Row): RowStatus => (row.report ? (row.report.status as RowStatus) : "due");
export const needsAction = (row: Row) => STATUS_META[rowStatus(row)].needsAction;

/* ------------------------------------------------------------------ tags ---- */
/** Services and linked-data badges are one list, so "+N" counts them together. */
type Tag = { key: string; label: string; link: boolean };

function tagsOf(row: Row): Tag[] {
  const out: Tag[] = row.services.map((s) => ({ key: `s:${s}`, label: s, link: false }));
  if (row.links.ads > 0) out.push({ key: "ads", label: `Ads ×${row.links.ads}`, link: true });
  if (row.links.seo > 0) out.push({ key: "seo", label: `SEO ×${row.links.seo}`, link: true });
  return out;
}

/** At most this many chips; the remainder collapses into one "+N" chip. */
const MAX_TAGS = 3;

function TagList({ tags, small }: { tags: Tag[]; small?: boolean }) {
  const shown = tags.slice(0, MAX_TAGS);
  const rest = tags.slice(MAX_TAGS);
  const pad = small ? "px-1.5 py-0" : "px-2 py-0.5";
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      {shown.map((t) => (
        <span
          key={t.key}
          title={t.label}
          className={cn(
            "inline-flex min-w-0 max-w-full items-center gap-1 rounded-full text-xs font-medium",
            pad,
            t.link ? "bg-accent text-primary-subtle-foreground" : "bg-muted text-foreground",
          )}
        >
          {t.link && <Link2 className="size-3 shrink-0" aria-hidden />}
          <span className="truncate">{t.label}</span>
        </span>
      ))}
      {rest.length > 0 && (
        <span
          title={rest.map((t) => t.label).join(", ")}
          className={cn("shrink-0 rounded-full bg-muted text-xs font-medium text-muted-foreground", pad)}
        >
          +{rest.length}
        </span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ menu ---- */
/** Width of the dropdown panel, in px — it is positioned by script, not CSS. */
const MENU_W = 192;
/** Used only for the first placement, before the panel can be measured. */
const MENU_H_GUESS = 184;

export function QueueLine({
  row,
  month,
  canManage,
  canApprove,
  selected,
  onSelect,
}: {
  row: Row;
  month: string;
  canManage: boolean;
  canApprove: boolean;
  selected: boolean;
  onSelect: (id: string, next: boolean) => void;
}) {
  const gen = useGenerate();
  const approve = useApprove();
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const r = row.report;
  const status = rowStatus(row);
  const attention = needsAction(row);
  const name = row.merchant.name;

  /*
   * The table wrapper clips horizontally, so an absolutely-positioned panel
   * would be cut off at the card edge. The panel is `position: fixed` instead
   * and placed from the trigger's box, clamped into the viewport on both axes,
   * and re-placed while it is open.
   */
  const place = useCallback(() => {
    const el = btnRef.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    const h = panelRef.current?.offsetHeight ?? MENU_H_GUESS;
    const left = Math.max(8, Math.min(box.right - MENU_W, window.innerWidth - MENU_W - 8));
    const below = box.bottom + 4;
    const top = below + h > window.innerHeight - 8 ? Math.max(8, box.top - h - 4) : below;
    setPos((p) => (p && p.top === top && p.left === left ? p : { top, left }));
  }, []);

  useLayoutEffect(() => {
    if (menu) place();
  }, [menu, place]);

  useEffect(() => {
    if (!menu) return;
    const onDoc = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(false);
    };
    const onMove = () => place();
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [menu, place]);

  /* --- the same handlers as before, unchanged --- */
  const doGenerate = () =>
    gen.mutate(
      { merchantId: row.merchant.id, month },
      {
        onSuccess: (rep) => {
          toast({
            variant: rep.status === "failed" ? "error" : "success",
            title: rep.status === "failed" ? "Generation failed" : "Draft ready",
            description: rep.error ?? undefined,
          });
          router.push(`/report-gen/${rep.id}`);
        },
        onError: (e) => toast({ variant: "error", title: "Couldn't generate", description: e.message }),
      },
    );
  const doApprove = () =>
    r &&
    approve.mutate(r.id, {
      onSuccess: () => toast({ variant: "success", title: "Approved — snapshot frozen" }),
      onError: (e) => toast({ variant: "error", title: "Couldn't approve", description: e.message }),
    });

  const supplied = r ? Math.max(0, TOTAL_METRICS - r.missingCount) : 0;
  const pct = r ? Math.round((supplied / TOTAL_METRICS) * 100) : 0;
  const b = band(pct);
  const tags = tagsOf(row);

  return (
    <>
      <TableRow
        className={cn(
          "group transition-colors",
          // Below md the row becomes a wrapping flex card:
          // [checkbox + merchant] / [status] / [actions].
          "max-md:mx-2 max-md:my-2 max-md:flex max-md:flex-wrap max-md:items-center max-md:gap-y-1",
          "max-md:rounded-xl max-md:border max-md:border-border max-md:p-1 max-md:last:border",
          selected ? "bg-accent/60" : "hover:bg-muted/60",
          open && "border-b-0",
        )}
      >
        <TableCell className="align-middle max-md:w-auto md:w-[4%]">
          <input
            type="checkbox"
            className="size-4"
            checked={selected}
            onChange={(e) => onSelect(row.merchant.id, e.target.checked)}
            aria-label={`Select ${name}`}
          />
        </TableCell>

        {/* Merchant — clicking the cell (not a control) opens the preview */}
        <TableCell className="align-middle max-md:min-w-0 max-md:flex-1 md:w-[48%] lg:w-[37%] xl:w-[24%]">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="-m-1 flex w-full min-w-0 items-center gap-3 rounded-md p-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            <span
              aria-hidden
              className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-xs font-semibold text-primary-subtle-foreground"
            >
              {initials(name)}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="truncate font-semibold text-foreground" title={name}>
                  {name}
                </span>
                {attention && <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-label="Needs your action" role="img" />}
              </span>
              {row.merchant.cuisine && (
                <span className="truncate text-xs text-muted-foreground" title={row.merchant.cuisine}>
                  {row.merchant.cuisine}
                </span>
              )}
            </span>
            <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden />
          </button>

          {/* Below xl the Services column is hidden, so its chips live here. */}
          {tags.length > 0 && (
            <div className="mt-1.5 pl-12 xl:hidden">
              <TagList tags={tags} small />
            </div>
          )}
        </TableCell>

        <TableCell className="align-middle max-md:w-full max-md:pl-12 md:w-[20%] xl:w-[15%]">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <StatusChip status={status} />
              {r && <span className="text-xs text-muted-foreground">v{r.version}</span>}
            </div>
            {/* Below lg the Data completeness column is hidden, so it shows here. */}
            {r && (
              // `relative` so the sr-only span below has a positioned ancestor.
              <div className="relative flex items-center gap-1.5 lg:hidden">
                <div className="h-1 w-12 shrink-0 overflow-hidden rounded-full bg-muted" aria-hidden>
                  <div className={cn("h-full rounded-full", b.bar)} style={{ width: `${pct}%` }} />
                </div>
                <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                  {supplied}/{TOTAL_METRICS}
                  <span className="sr-only"> metrics supplied</span>
                </span>
              </div>
            )}
          </div>
        </TableCell>

        {/* Data completeness — lg and up */}
        <TableCell className="hidden align-middle lg:table-cell lg:w-[17%]">
          {r ? (
            <div className="flex min-w-0 flex-col gap-1">
              <span className="text-xs text-foreground">
                <span className="tabular-nums">{supplied}</span> of <span className="tabular-nums">{TOTAL_METRICS}</span> metrics
              </span>
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <div
                  className="h-1.5 w-full max-w-[80px] overflow-hidden rounded-full bg-muted"
                  role="img"
                  aria-label={`${pct}% of metrics supplied`}
                >
                  <div className={cn("h-full rounded-full", b.bar)} style={{ width: `${pct}%` }} />
                </div>
                <span className={cn("text-xs font-medium", b.text)}>{b.word}</span>
              </div>
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">Shown after generating</span>
          )}
        </TableCell>

        {/* Services & linked data — xl and up, only what exists */}
        <TableCell className="hidden align-middle xl:table-cell xl:w-[20%]">
          {tags.length > 0 ? (
            <TagList tags={tags} />
          ) : (
            // `relative` is load-bearing: `sr-only` is position:absolute, and the
            // table's wrapper is not a containing block, so without a positioned
            // parent this span anchors to the page and widens it.
            <span className="relative">
              <span aria-hidden className="text-muted-foreground/60">
                —
              </span>
              <span className="sr-only">No services or linked data</span>
            </span>
          )}
        </TableCell>

        {/* Actions */}
        <TableCell align="right" className="align-middle max-md:w-full md:w-[28%] lg:w-[22%] xl:w-[20%]">
          <div className="flex min-w-0 items-center justify-end gap-1">
            {r && (
              <Link href={`/report-gen/${r.id}`} className="shrink-0">
                <Button size="sm" variant="ghost" className="group-hover:bg-accent/70">
                  Open
                </Button>
              </Link>
            )}
            <div className="flex min-w-0 max-w-[132px] flex-1 justify-end">
              {status === "due" && canManage && (
                <Button size="sm" variant="default" className="w-full min-w-0" loading={gen.isPending} onClick={doGenerate}>
                  Generate
                </Button>
              )}
              {(status === "draft" || status === "edited") && canApprove && (
                <Button size="sm" variant="default" className="w-full min-w-0" loading={approve.isPending} onClick={doApprove}>
                  Approve
                </Button>
              )}
              {status === "approved" && canApprove && r && (
                <Link href={`/report-gen/${r.id}`} className="w-full min-w-0">
                  <Button size="sm" variant="default" className="w-full min-w-0">
                    Send
                  </Button>
                </Link>
              )}
              {status === "failed" && canManage && (
                <Button size="sm" variant="default" className="w-full min-w-0" loading={gen.isPending} onClick={doGenerate}>
                  Retry
                </Button>
              )}
              {status === "generating" && (
                <Button size="sm" variant="outline" className="w-full min-w-0" disabled loading>
                  Generating
                </Button>
              )}
            </div>

            <div ref={menuRef} className="shrink-0">
              <Button
                ref={btnRef}
                size="icon-sm"
                variant="ghost"
                aria-label={`More actions for ${name}`}
                aria-expanded={menu}
                aria-haspopup="menu"
                onClick={() => {
                  setMenu((v) => !v);
                  place();
                }}
              >
                <Ellipsis />
              </Button>
              {menu && (
                <div
                  ref={panelRef}
                  role="menu"
                  style={{ top: pos?.top ?? 0, left: pos?.left ?? 0 }}
                  className={cn(
                    "fixed z-50 w-48 overflow-hidden rounded-lg border border-border bg-card py-1 shadow-lg",
                    pos ? "visible" : "invisible",
                  )}
                >
                  {r && (
                    <Link href={`/report-gen/${r.id}`} role="menuitem" className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted">
                      <ExternalLink className="size-4" aria-hidden /> Open report
                    </Link>
                  )}
                  {canManage && (
                    <button
                      type="button"
                      role="menuitem"
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                      onClick={() => {
                        setMenu(false);
                        doGenerate();
                      }}
                    >
                      <RefreshCw className="size-4" aria-hidden /> Regenerate
                    </button>
                  )}
                  <button
                    type="button"
                    role="menuitem"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                    onClick={() => {
                      setMenu(false);
                      setOpen(true);
                    }}
                  >
                    <ListX className="size-4" aria-hidden /> View missing metrics
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                    onClick={() => {
                      setMenu(false);
                      const url = r ? `${window.location.origin}/report-gen/${r.id}` : window.location.href;
                      navigator.clipboard?.writeText(url).then(
                        () => toast({ variant: "success", title: "Link copied" }),
                        () => toast({ variant: "error", title: "Couldn't copy the link" }),
                      );
                    }}
                  >
                    <Copy className="size-4" aria-hidden /> Copy link
                  </button>
                </div>
              )}
            </div>
          </div>
        </TableCell>
      </TableRow>

      {/* Quick preview — colSpan is the full column count; the browser clamps it
          to however many columns are visible at the current width. */}
      {open && (
        <TableRow
          className={cn(
            "max-md:mx-2 max-md:-mt-2 max-md:mb-2 max-md:block max-md:rounded-b-xl max-md:border-0",
            selected ? "bg-accent/60" : undefined,
          )}
        >
          <TableCell colSpan={6} className="p-0 max-md:block max-md:w-full">
            <div data-testid="queue-preview" className="grid gap-5 border-t border-border bg-muted/40 px-4 py-4 md:grid-cols-3">
              <div className="flex min-w-0 flex-col gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">Sections in this report</h3>
                {tags.length > 0 ? (
                  <ul className="flex flex-col gap-1 text-sm text-foreground">
                    {row.services.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                    {row.links.ads > 0 && <li>Ads · {row.links.ads} linked account{row.links.ads === 1 ? "" : "s"}</li>}
                    {row.links.seo > 0 && <li>Search · {row.links.seo} linked site{row.links.seo === 1 ? "" : "s"}</li>}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">Only the always-on sections. No service or linked data yet.</p>
                )}
              </div>

              <div className="flex min-w-0 flex-col gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">Data gaps</h3>
                {r ? (
                  <>
                    <p className="text-sm leading-6 text-foreground">
                      {r.missingCount} of {TOTAL_METRICS} metrics weren&apos;t supplied for {monthName(month)}. They&apos;ll appear in the
                      report as &quot;not supplied&quot; with the reason, never as zero.
                    </p>
                    <Link href={`/report-gen/${r.id}`} className="text-sm font-medium text-primary hover:underline">
                      See which metrics are missing →
                    </Link>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">Generate the report to see which metrics are missing.</p>
                )}
              </div>

              <div className="flex min-w-0 flex-col gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">Version</h3>
                {r ? (
                  <>
                    <p className="text-sm text-foreground">
                      v{r.version} · {STATUS_META[status].label}
                      {status === "draft" || status === "edited" ? " · not reviewed yet" : ""}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Link href={`/report-gen/${r.id}`}>
                        <Button size="sm" variant="outline">
                          Open full report
                        </Button>
                      </Link>
                      {(status === "draft" || status === "edited") && canApprove && (
                        <Button size="sm" variant="default" loading={approve.isPending} onClick={doApprove}>
                          Approve
                        </Button>
                      )}
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">No version yet.</p>
                )}
              </div>
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

/** "2026-10" → "October" for the preview copy. */
function monthName(month: string): string {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return "this month";
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long" });
}
