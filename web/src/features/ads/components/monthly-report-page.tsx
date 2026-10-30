"use client";

import { useMemo } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Download } from "lucide-react";
import { Button, ErrorState, Select, Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableMessageRow, TableRow } from "@/components/ui";
import { useMonthlyReport } from "../api";
import { downloadCsv, fmtMoney, fmtMonth, fmtNum, fmtPct, localToday, reportMonth } from "../lib";
import type { MonthlyReport } from "../types";
import { NoData, RoasChip, RoasValue } from "./parts";

function lastMonths(n: number): string[] {
  const out: string[] = [];
  let ym = localToday().slice(0, 7);
  for (let i = 0; i < n; i++) {
    out.push(ym);
    const [y, m] = ym.split("-").map(Number);
    ym = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  }
  return out;
}

/** The old sheet's MonthlyReport tab: one row per restaurant × campaign for a
 *  calendar month, with the corrected ROAS and the ROAS status the n8n
 *  workflow computed but never wrote. */
export function MonthlyReportPage() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const month = params.get("month") ?? reportMonth().start.slice(0, 7);
  const q = useMonthlyReport(month);
  const months = useMemo(() => lastMonths(18), []);
  const r = q.data;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <Link href="/ads" className="mb-1 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" />
            Back to portfolio
          </Link>
          <h1 className="text-2xl font-semibold tracking-[-0.011em] text-foreground">Monthly report</h1>
          <p className="mt-1 text-table text-muted-foreground">Every restaurant and campaign for one calendar month — what the sheet&apos;s MonthlyReport tab held, for any month.</p>
        </div>
        <div className="w-48">
          <Select value={month} aria-label="Month" onChange={(e) => router.replace(`${pathname}?month=${e.target.value}`, { scroll: false })}>
            {months.map((m) => (
              <option key={m} value={m}>
                {fmtMonth(m)}
              </option>
            ))}
          </Select>
        </div>
        <Button variant="outline" disabled={!r?.rows.length} onClick={() => r && exportCsv(r)}>
          <Download className="size-4" />
          CSV
        </Button>
      </div>
      {q.error ? (
        <ErrorState title="Couldn't load the report" description={q.error.messages?.[0] ?? q.error.message} />
      ) : !r ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Account</TableHead>
              <TableHead>Campaign</TableHead>
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
              <TableHead>ROAS status</TableHead>
              <TableHead className="min-w-80">Analysis & future actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {r.rows.map((x) => (
              <TableRow key={`${x.accountId}-${x.campaignName}`}>
                <TableCell>
                  <Link href={`/ads/${x.accountId}?period=custom&start=${r.monthStart}&end=${r.monthEnd}`} className="font-medium text-foreground hover:underline">
                    {x.accountName}
                  </Link>
                </TableCell>
                <TableCell>{x.campaignName}</TableCell>
                <TableCell align="right">{fmtMoney(x.metrics.spend, { cents: true })}</TableCell>
                <TableCell align="right">{fmtNum(x.metrics.impressions)}</TableCell>
                <TableCell align="right">{fmtNum(x.metrics.calls)}</TableCell>
                <TableCell align="right">{fmtNum(x.metrics.directions)}</TableCell>
                <TableCell align="right">{fmtNum(x.metrics.website)}</TableCell>
                <TableCell align="right">{fmtNum(x.metrics.orders)}</TableCell>
                <TableCell align="right">{fmtNum(x.metrics.menu)}</TableCell>
                <TableCell align="right">{x.costPerOrder == null ? <NoData label="N/A" /> : fmtMoney(x.costPerOrder)}</TableCell>
                <TableCell align="right">{x.avgTicket == null ? "—" : fmtMoney(x.avgTicket)}</TableCell>
                <TableCell align="right">{x.revenue == null ? <NoData label="N/A" /> : fmtMoney(x.revenue, { cents: true })}</TableCell>
                <TableCell align="right">{fmtPct(x.roi)}</TableCell>
                <TableCell align="right">
                  <RoasValue roas={x.roas} status={x.roasStatus} />
                </TableCell>
                <TableCell>
                  <RoasChip status={x.roasStatus} />
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{x.analysis}</TableCell>
              </TableRow>
            ))}
            {!r.rows.length && (
              <TableMessageRow colSpan={16}>
                <p className="py-6 text-center text-sm text-muted-foreground">No campaign had impressions in {fmtMonth(r.month)}.</p>
              </TableMessageRow>
            )}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

function exportCsv(r: MonthlyReport) {
  downloadCsv(`google-ads-monthly-report-${r.month}.csv`, [
    ["Account Name", "Customer ID", "Campaign Name", "Ads Spent", "Impressions", "Calls", "Directions", "Website", "Orders", "Menu", "Cost per Order", "Avg. Ticket Size", "Revenue", "ROI", "ROAS", "ROAS Status", "Analysis & Future Actions"],
    ...r.rows.map((x) => [
      x.accountName, x.customerId, x.campaignName, x.metrics.spend, x.metrics.impressions, x.metrics.calls, x.metrics.directions, x.metrics.website, x.metrics.orders, x.metrics.menu,
      x.costPerOrder?.toFixed(2) ?? "N/A", x.avgTicket?.toFixed(2) ?? "", x.revenue?.toFixed(2) ?? "N/A", x.roi?.toFixed(2) ?? "N/A", x.roas?.toFixed(2) ?? "N/A", x.roasStatus.label, x.analysis,
    ]),
  ]);
}
