"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileChartColumn, Play } from "lucide-react";
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
import { useGenerate, useQueue, useReportGenStatus } from "../api";
import type { QueueRow, ReportStatus } from "../types";

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

/** /report-gen — the queue: one row per active merchant, its links, and the report for the chosen month. */
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
        <StatTile label="Merchants" value={c.merchants ?? 0} />
        <StatTile label="Not generated" value={c.due ?? 0} tone={c.due ? "warning" : "ok"} status={c.due ? "Click Generate" : "All generated"} />
        <StatTile label="Drafts" value={(c.draft ?? 0) + (c.edited ?? 0)} tone={(c.draft ?? 0) + (c.edited ?? 0) ? "warning" : "neutral"} status="Waiting for review" />
        <StatTile label="Approved" value={c.approved ?? 0} tone={c.approved ? "ok" : "neutral"} status="Ready to send" />
        <StatTile label="Sent" value={c.sent ?? 0} tone="neutral" />
        <StatTile label="Failed" value={c.failed ?? 0} tone={c.failed ? "danger" : "neutral"} status={c.failed ? "Open the report for the error" : "No failures"} />
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Merchant</TableHead>
            <TableHead>Services</TableHead>
            <TableHead>Linked data</TableHead>
            <TableHead>Report</TableHead>
            <TableHead align="right">Not supplied</TableHead>
            <TableHead align="right" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {d.merchants.map((row) => (
            <QueueLine key={row.merchant.id} row={row} month={month} canManage={canManage} />
          ))}
          {d.merchants.length === 0 && <TableMessageRow colSpan={6}>No active merchants.</TableMessageRow>}
        </TableBody>
      </Table>
      <p className="text-xs text-muted-foreground">
        A section appears only for services the merchant has taken. A taken service with no data prints &quot;not supplied&quot; and the reason, never zero.
      </p>
    </div>
  );
}

function QueueLine({ row, month, canManage }: { row: QueueRow; month: string; canManage: boolean }) {
  const gen = useGenerate();
  const router = useRouter();
  const { toast } = useToast();
  const r = row.report;
  const links = [row.links.ads ? `Ads ×${row.links.ads}` : null, row.links.seo ? `SEO ×${row.links.seo}` : null].filter(Boolean).join(" · ");
  const canRegenerate = !r || ["draft", "edited", "failed", "deleted"].includes(r.status);
  return (
    <TableRow>
      <TableCell>
        <div className="flex flex-col">
          <span className="font-medium text-foreground">{row.merchant.name}</span>
          <span className="text-xs text-muted-foreground">{row.merchant.cuisine ?? ""}</span>
        </div>
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">{row.services.join(", ") || "—"}</TableCell>
      <TableCell className="text-xs text-muted-foreground">{links || "No Ads or SEO link"}</TableCell>
      <TableCell>
        {r ? (
          <div className="flex items-center gap-2">
            <StatusBadge s={r.status} />
            <span className="text-xs text-muted-foreground">v{r.version}</span>
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
          {canManage && canRegenerate && (
            <Button
              size="sm"
              loading={gen.isPending}
              onClick={() =>
                gen.mutate(
                  { merchantId: row.merchant.id, month },
                  {
                    onSuccess: (rep) => {
                      toast({ variant: rep.status === "failed" ? "error" : "success", title: rep.status === "failed" ? "Generation failed" : "Draft ready", description: rep.error ?? undefined });
                      router.push(`/report-gen/${rep.id}`);
                    },
                    onError: (e) => toast({ variant: "error", title: "Couldn't generate", description: e.message }),
                  },
                )
              }
            >
              <Play /> {r ? "Regenerate" : "Generate"}
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}
