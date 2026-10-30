"use client";

import { Fragment } from "react";
import { Download } from "lucide-react";
import { Button, Select, Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import { useBreakdown } from "../api";
import { downloadCsv, fmtDay, fmtMoney, fmtMonth, fmtNum, fmtPct } from "../lib";
import type { Breakdown, BreakdownLine } from "../types";
import { NoData, RoasChip, RoasValue } from "./parts";

/** The old sheet's restaurant tab: Week 01–04 per campaign with the n8n
 *  "Analysis & Future Actions" sentence — now with week 4 running to the end
 *  of the month, and any past month kept. */
export function BreakdownTab({ accountId, month, onMonth }: { accountId: string; month?: string; onMonth: (m: string) => void }) {
  const { data, isPending } = useBreakdown(accountId, month);
  if (isPending || !data) return <Skeleton className="h-64 w-full" />;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-48">
          <Select value={data.month} onChange={(e) => onMonth(e.target.value)} aria-label="Month">
            {(data.months.includes(data.month) ? data.months : [data.month, ...data.months]).map((m) => (
              <option key={m} value={m}>
                {fmtMonth(m)}
              </option>
            ))}
          </Select>
        </div>
        <span className="flex-1 text-xs text-muted-foreground">
          {data.weeks.map((w) => `${w.label.replace("Week ", "W")} ${fmtDay(w.start, false)}–${fmtDay(w.end, false)}`).join(" · ")}
        </span>
        <Button size="sm" variant="outline" onClick={() => exportCsv(data)} disabled={!data.rows.length}>
          <Download className="size-4" />
          CSV
        </Button>
      </div>
      {!data.rows.length ? (
        <p className="text-sm text-muted-foreground">No campaign had impressions in {fmtMonth(data.month)}.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-56">Date</TableHead>
              <TableHead align="right">Ads spent</TableHead>
              <TableHead align="right">Impressions</TableHead>
              <TableHead align="right">Calls</TableHead>
              <TableHead align="right">Directions</TableHead>
              <TableHead align="right">Website</TableHead>
              <TableHead align="right">Orders</TableHead>
              <TableHead align="right">Menu</TableHead>
              <TableHead align="right">Cost / order</TableHead>
              <TableHead align="right">Avg ticket</TableHead>
              <TableHead align="right">Revenue</TableHead>
              <TableHead align="right">ROI</TableHead>
              <TableHead align="right">ROAS</TableHead>
              <TableHead className="min-w-80">Analysis & future actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.rows.map((r) => (
              <Fragment key={r.campaign.id}>
                {r.weeks.map((w) => (
                  <Line key={w.label} label={`${w.label} ${r.campaign.name}`} line={w} />
                ))}
                <Line label={`${fmtMonth(data.month)} ${r.campaign.name}`} line={r.month} strong />
              </Fragment>
            ))}
            {data.rows.length > 1 && <Line label={`${fmtMonth(data.month)} — all campaigns`} line={data.total} strong />}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

function Line({ label, line, strong }: { label: string; line: BreakdownLine; strong?: boolean }) {
  const m = line.metrics;
  return (
    <TableRow className={cn(strong && "bg-muted/50 font-medium")}>
      <TableCell>{label}</TableCell>
      {line.hasData ? (
        <>
          <TableCell align="right">{fmtMoney(m.spend, { cents: true })}</TableCell>
          <TableCell align="right">{fmtNum(m.impressions)}</TableCell>
          <TableCell align="right">{fmtNum(m.calls)}</TableCell>
          <TableCell align="right">{fmtNum(m.directions)}</TableCell>
          <TableCell align="right">{fmtNum(m.website)}</TableCell>
          <TableCell align="right">{fmtNum(m.orders)}</TableCell>
          <TableCell align="right">{fmtNum(m.menu)}</TableCell>
          <TableCell align="right">{line.costPerOrder == null ? <NoData label="N/A" /> : fmtMoney(line.costPerOrder)}</TableCell>
          <TableCell align="right">{line.avgTicket == null ? "—" : fmtMoney(line.avgTicket)}</TableCell>
          <TableCell align="right">{line.revenue == null ? <NoData label="N/A" /> : fmtMoney(line.revenue, { cents: true })}</TableCell>
          <TableCell align="right">{fmtPct(line.roi)}</TableCell>
          <TableCell align="right">
            <div className="flex flex-col items-end gap-0.5">
              <RoasValue roas={line.roas} status={line.roasStatus} />
              <RoasChip status={line.roasStatus} />
            </div>
          </TableCell>
          <TableCell className="text-xs text-muted-foreground">{line.analysis}</TableCell>
        </>
      ) : (
        <TableCell colSpan={13}>
          <NoData label="No data for these days" />
        </TableCell>
      )}
    </TableRow>
  );
}

function exportCsv(b: Breakdown) {
  const header = ["Date", "Ads Spent", "Impressions", "Calls", "Directions", "Website", "Orders", "Menu", "Cost per Order", "Avg. Ticket Size", "Revenue", "ROI", "ROAS", "ROAS Status", "Analysis & Future Actions"];
  const row = (label: string, l: BreakdownLine) => [
    label, l.metrics.spend, l.metrics.impressions, l.metrics.calls, l.metrics.directions, l.metrics.website, l.metrics.orders, l.metrics.menu,
    l.costPerOrder?.toFixed(2) ?? "N/A", l.avgTicket?.toFixed(2) ?? "", l.revenue?.toFixed(2) ?? "N/A", l.roi?.toFixed(2) ?? "N/A", l.roas?.toFixed(2) ?? "N/A", l.roasStatus.label, l.analysis ?? "",
  ];
  downloadCsv(`google-ads-weekly-${b.month}.csv`, [
    header,
    ...b.rows.flatMap((r) => [...r.weeks.filter((w) => w.hasData).map((w) => row(`${w.label} ${r.campaign.name}`, w)), row(`${b.month} ${r.campaign.name}`, r.month)]),
  ]);
}
