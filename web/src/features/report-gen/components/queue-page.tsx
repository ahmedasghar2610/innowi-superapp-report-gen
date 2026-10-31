"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CircleCheck, FileChartColumn, Play, RefreshCw, Send } from "lucide-react";
import {
  Badge,
  Button,
  ErrorState,
  Select,
  Skeleton,
  StatTile,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableMessageRow,
  TableRow,
  useToast,
  type BadgeTone,
} from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import { useApprove, useGenerate, useQueue, useReportGenStatus } from "../api";
import { initials } from "../format";
import type { QueueRow, ReportStatus } from "../types";

/**
 * /report-gen — the queue, laid out as the approved prototype: the status
 * counts and a progress bar across the top, then one row per active merchant
 * with its package, its report status and the single action that row needs.
 *
 * Not built, for want of backing data (see the build notes): the prototype's
 * per-row "data freshness / report-ready" line, which needs sync timestamps on
 * the queue row that the API does not return; and its bulk "generate all due"
 * button, which needs a batch endpoint. Neither is faked here.
 */
export const STATUS: Record<ReportStatus, { label: string; tone: BadgeTone }> = {
  generating: { label: "Generating", tone: "accent" },
  draft: { label: "Draft", tone: "warning" },
  edited: { label: "Edited", tone: "warning" },
  approved: { label: "Approved", tone: "success" },
  sent: { label: "Sent", tone: "success-solid" },
  failed: { label: "Failed", tone: "danger" },
  deleted: { label: "Deleted", tone: "neutral" },
};

export function StatusBadge({ s }: { s: ReportStatus }) {
  const v = STATUS[s] ?? { label: s, tone: "neutral" as BadgeTone };
  return (
    <Badge tone={v.tone} icon={false}>
      {v.label}
    </Badge>
  );
}

/** The bar's segment colour per status — the same hues the badges use. */
const SEGMENT: Record<string, string> = {
  due: "bg-muted-foreground/40",
  generating: "bg-primary/50",
  draft: "bg-warning",
  edited: "bg-warning",
  approved: "bg-success",
  sent: "bg-success/70",
  failed: "bg-destructive",
};

const BAR_ORDER = ["due", "generating", "draft", "edited", "approved", "sent", "failed"] as const;

/** The last twelve ended months as YYYY-MM options, newest first. */
function monthOptions(): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  const d = new Date();
  d.setDate(1);
  for (let i = 1; i <= 12; i++) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
    const value = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}`;
    out.push({ value, label: m.toLocaleDateString("en-US", { month: "long", year: "numeric" }) });
  }
  return out;
}

export function QueuePage() {
  const months = useMemo(monthOptions, []);
  const [month, setMonth] = useState(months[0].value);
  const status = useReportGenStatus();
  const q = useQueue(month);
  const d = q.data;

  if (q.error) return <ErrorState title="Couldn't load the report queue" description={q.error.message} />;
  if (!d) return <Skeleton className="h-96 w-full" />;
  const c = d.counts;
  const canManage = !!status.data?.canManage;
  const canApprove = !!status.data?.canApprove;
  const total = c.merchants ?? d.merchants.length;

  const segments = BAR_ORDER.map((k) => ({ k, n: c[k] ?? 0 })).filter((s) => s.n > 0);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1">
          <h2 className="text-base font-semibold text-foreground">Merchant Reports</h2>
          <p className="text-xs text-muted-foreground">
            One click builds a merchant&apos;s monthly report from live Super App data. A manager approves it before anything is sent.
            {status.data && status.data.sendMode !== "live" ? ` Send mode: ${status.data.sendMode} — nothing leaves the building.` : ""}
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Month
          <Select value={month} onChange={(e) => setMonth(e.target.value)} className="w-44">
            {months.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </Select>
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Merchants" value={total} />
        <StatTile label="Not generated" value={c.due ?? 0} tone={c.due ? "warning" : "ok"} status={c.due ? "Click Generate" : "All generated"} />
        <StatTile
          label="Drafts"
          value={(c.draft ?? 0) + (c.edited ?? 0)}
          tone={(c.draft ?? 0) + (c.edited ?? 0) ? "warning" : "neutral"}
          status="Waiting for review"
        />
        <StatTile label="Approved" value={c.approved ?? 0} tone={c.approved ? "ok" : "neutral"} status="Ready to send" />
        <StatTile label="Sent" value={c.sent ?? 0} tone="neutral" />
        <StatTile
          label="Failed"
          value={c.failed ?? 0}
          tone={c.failed ? "danger" : "neutral"}
          status={c.failed ? "Open the report for the error" : "No failures"}
        />
      </div>

      {/* Status bar + legend, the prototype's "report pipeline" strip. */}
      {total > 0 && (
        <div className="flex flex-col gap-2.5" data-testid="queue-pipeline">
          <div
            className="flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-muted"
            role="img"
            aria-label={segments.map((s) => `${STATUS[s.k as ReportStatus]?.label ?? "Not generated"} ${s.n}`).join(", ")}
          >
            {segments.map((s) => (
              <div key={s.k} className={cn("h-full", SEGMENT[s.k])} style={{ width: `${(s.n / total) * 100}%` }} />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {BAR_ORDER.map((k) => (
              <span key={k} className="flex items-center gap-1.5 text-xs text-foreground">
                <span className={cn("size-2 shrink-0 rounded-full", SEGMENT[k])} />
                {k === "due" ? "Not generated" : STATUS[k as ReportStatus]?.label ?? k}
                <strong className="tabular-nums">{c[k] ?? 0}</strong>
              </span>
            ))}
          </div>
        </div>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Merchant</TableHead>
            <TableHead>Service package</TableHead>
            <TableHead>Linked data</TableHead>
            <TableHead>Report</TableHead>
            <TableHead align="right">Not supplied</TableHead>
            <TableHead align="right" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {d.merchants.map((row) => (
            <QueueLine key={row.merchant.id} row={row} month={month} canManage={canManage} canApprove={canApprove} />
          ))}
          {d.merchants.length === 0 && <TableMessageRow colSpan={6}>No active merchants.</TableMessageRow>}
        </TableBody>
      </Table>
      <p className="text-xs text-muted-foreground">
        A section appears only for services the merchant has taken. A taken service with no data prints &quot;not supplied&quot; and the reason,
        never zero.
      </p>
    </div>
  );
}

/** The merchant cell: initials avatar, name, cuisine and location count. */
function MerchantCell({ row }: { row: QueueRow }) {
  const m = row.merchant;
  const sub = [m.cuisine, m.locationCount && m.locationCount > 1 ? `${m.locationCount} locations` : null].filter(Boolean).join(" · ");
  return (
    <div className="flex items-center gap-2.5">
      <span
        aria-hidden
        className="flex size-8 shrink-0 items-center justify-center rounded-md bg-accent text-xs font-semibold text-primary-subtle-foreground"
      >
        {initials(m.name)}
      </span>
      <div className="flex min-w-0 flex-col">
        <span className="truncate font-medium text-foreground">{m.name}</span>
        {sub && <span className="truncate text-xs text-muted-foreground">{sub}</span>}
      </div>
    </div>
  );
}

function QueueLine({ row, month, canManage, canApprove }: { row: QueueRow; month: string; canManage: boolean; canApprove: boolean }) {
  const gen = useGenerate();
  const approve = useApprove();
  const router = useRouter();
  const { toast } = useToast();
  const r = row.report;
  const links = [row.links.ads ? `Ads ×${row.links.ads}` : null, row.links.seo ? `SEO ×${row.links.seo}` : null].filter(Boolean).join(" · ");
  const canRegenerate = !r || ["draft", "edited", "failed", "deleted"].includes(r.status);
  const isDraft = !!r && (r.status === "draft" || r.status === "edited");

  const generate = () =>
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

  return (
    <TableRow>
      <TableCell>
        <MerchantCell row={row} />
      </TableCell>
      <TableCell>
        {row.services.length ? (
          <div className="flex flex-wrap gap-1">
            {row.services.map((s) => (
              <Badge key={s} tone="neutral" icon={false}>
                {s}
              </Badge>
            ))}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">No service recorded</span>
        )}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">{links || "No Ads or SEO link"}</TableCell>
      <TableCell>
        {r ? (
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <StatusBadge s={r.status} />
              <span className="text-xs text-muted-foreground">v{r.version}</span>
            </div>
            {r.error && <span className="text-xs leading-4 text-text-destructive">{r.error}</span>}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">Not generated</span>
        )}
      </TableCell>
      <TableCell align="right" className="tabular-nums">
        {r ? r.missingCount : "—"}
      </TableCell>
      <TableCell align="right">
        <div className="flex justify-end gap-1.5">
          {r && (
            <Link href={`/report-gen/${r.id}`}>
              <Button size="sm" variant="outline">
                <FileChartColumn /> Open
              </Button>
            </Link>
          )}
          {/* One primary action per row, chosen by that row's status. */}
          {isDraft && canApprove ? (
            <Button
              size="sm"
              variant="default"
              loading={approve.isPending}
              onClick={() =>
                approve.mutate(r!.id, {
                  onSuccess: () => toast({ variant: "success", title: "Approved — snapshot frozen" }),
                  onError: (e) => toast({ variant: "error", title: "Couldn't approve", description: e.message }),
                })
              }
            >
              <CircleCheck /> Approve
            </Button>
          ) : r?.status === "approved" && canApprove ? (
            <Link href={`/report-gen/${r.id}`}>
              <Button size="sm" variant="default">
                <Send /> Send
              </Button>
            </Link>
          ) : canManage && canRegenerate ? (
            <Button size="sm" variant="default" loading={gen.isPending} onClick={generate}>
              {r ? <RefreshCw /> : <Play />} {r ? "Regenerate" : "Generate"}
            </Button>
          ) : null}
        </div>
      </TableCell>
    </TableRow>
  );
}
