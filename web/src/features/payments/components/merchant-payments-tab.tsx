"use client";

import { useState } from "react";
import { CircleAlert, CircleCheck, CreditCard, FileSpreadsheet, Info, Pencil, Plus, Receipt, Trash2, TrendingUp, Wallet } from "lucide-react";
import {
  Badge,
  type BadgeTone,
  Button,
  Card,
  EmptyState,
  ErrorState,
  SectionHead,
  Select,
  Skeleton,
  StatTile,
  type StatTone,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui";
import { useCan } from "@/features/auth/use-can";
import { TrendChart } from "@/features/gbp/components/trend-chart";
import { cn } from "@/lib/utils/cn";
import { useMerchantPayments } from "../api";
import { money, monthLabel, pct } from "../lib";
import type { CheckLevel, MerchantPayments, PaymentMonth } from "../types";
import { DeletePaymentDialog, PaymentFormDialog } from "./payment-form";
import { PaymentsImportDialog } from "./payments-import";

const STATUS_TONE: Record<string, BadgeTone> = { active: "success", paused: "warning", "not live yet": "neutral", churned: "danger" };
const CHECK: Record<CheckLevel, { icon: typeof Info; box: string; text: string }> = {
  danger: { icon: CircleAlert, box: "border-destructive/30 bg-destructive/5", text: "text-text-destructive" },
  warning: { icon: CircleAlert, box: "border-warning/40 bg-warning-soft", text: "text-warning-text" },
  info: { icon: Info, box: "border-border bg-muted/40", text: "text-muted-foreground" },
};

/**
 * Merchant workspace → Payments: what this merchant was billed each month (the paid-marketing
 * revenue report), how that compares with the contract and the Profile's subscription, and what
 * online-order revenue came in against it.
 */
export function MerchantPaymentsTab({ merchantId }: { merchantId: string }) {
  const q = useMerchantPayments(merchantId);
  const can = useCan();
  const [month, setMonth] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  // Add (null) / edit (a month) by hand; undefined = closed.
  const [form, setForm] = useState<PaymentMonth | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<PaymentMonth | null>(null);
  const d = q.data;
  const cur = d?.months.find((m) => m.month === month) ?? d?.latest ?? null;
  const idx = cur && d ? d.months.findIndex((m) => m.month === cur.month) : -1;
  const prev = d && idx >= 0 ? d.months[idx + 1] ?? null : null;
  const canImport = can("subscription.write");

  return (
    <div className="flex flex-col gap-5">
      <SectionHead
        title="Payments"
        description="Billing from the paid-marketing revenue report, checked against this merchant's Profile."
        action={
          <div className="flex flex-wrap items-center gap-2">
            {d && d.months.length > 1 && (
              <div className="w-48">
                <Select value={cur?.month ?? ""} aria-label="Month" onChange={(e) => setMonth(e.target.value)}>
                  {d.months.map((m) => (
                    <option key={m.month} value={m.month}>
                      {monthLabel(m.month)}
                    </option>
                  ))}
                </Select>
              </div>
            )}
            {canImport && (
              <>
                <Button size="sm" variant="outline" onClick={() => setImporting(true)}>
                  <FileSpreadsheet className="size-4" />
                  Import revenue report
                </Button>
                <Button size="sm" onClick={() => setForm(null)} disabled={!d}>
                  <Plus className="size-4" />
                  Add payment
                </Button>
              </>
            )}
          </div>
        }
      />
      {q.error ? (
        <ErrorState title="Couldn't load payments" description={q.error.message} />
      ) : !d ? (
        <Skeleton className="h-72 w-full" />
      ) : !cur ? (
        <Card>
          <EmptyState
            icon={CreditCard}
            title="No payment report for this merchant yet"
            description="Import the monthly revenue report (e.g. “Revenue Sheet Sept. 2026”). Each row is matched to its merchant by name, and the month shows up here with its contract, charge and online-order revenue."
            action={
              canImport ? (
                <div className="flex flex-wrap justify-center gap-2">
                  <Button size="sm" onClick={() => setImporting(true)}>
                    <FileSpreadsheet className="size-4" />
                    Import revenue report
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setForm(null)}>
                    <Plus className="size-4" />
                    Add a payment by hand
                  </Button>
                </div>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <>
          <MonthHeader m={cur} onEdit={canImport ? () => setForm(cur) : undefined} onDelete={canImport ? () => setDeleting(cur) : undefined} />
          <Tiles m={cur} prev={prev} profile={d.profile} />
          <Checks m={cur} hasMrr={d.profile.mrr != null} />
          {cur.notes && (
            <Card className="p-4">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{cur.sourceSheet ? "Notes from the report" : "Notes"}</div>
              <p className="whitespace-pre-line text-sm text-foreground">{cur.notes}</p>
            </Card>
          )}
          <History d={d} current={cur.month} onPick={setMonth} onEdit={canImport ? setForm : undefined} onDelete={canImport ? setDeleting : undefined} />
        </>
      )}
      <PaymentsImportDialog open={importing} onClose={() => setImporting(false)} />
      <PaymentFormDialog
        merchantId={merchantId}
        open={form !== undefined}
        onClose={() => setForm(undefined)}
        editing={form ?? null}
        defaults={d?.latest ?? (d?.profile.mrr != null ? { contract: d.profile.mrr } : null)}
        taken={d?.months.map((m) => m.month) ?? []}
      />
      <DeletePaymentDialog merchantId={merchantId} payment={deleting} onClose={() => setDeleting(null)} />
    </div>
  );
}

function MonthHeader({ m, onEdit, onDelete }: { m: PaymentMonth; onEdit?: () => void; onDelete?: () => void }) {
  const tone = STATUS_TONE[(m.status ?? "").toLowerCase()] ?? "neutral";
  return (
    <Card className="flex flex-wrap items-center gap-x-6 gap-y-2 p-4">
      <div className="flex flex-col">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Billing month</span>
        <span className="text-xl font-semibold tracking-[-0.006em] text-foreground">{monthLabel(m.month)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {m.status && <Badge tone={tone}>{m.status}</Badge>}
        {m.packageType && (
          <Badge tone="outline" icon={false}>
            {m.packageType}
          </Badge>
        )}
      </div>
      <div className="ml-auto flex flex-col text-right text-xs text-muted-foreground">
        {m.sourceSheet && (
          <span>
            In the report as <span className="font-medium text-foreground">{m.account}</span>
          </span>
        )}
        <span>
          {m.sourceSheet ?? (m.sourceFile === "Added by hand" ? "Added by hand" : "Revenue report")}
          {m.importedAt && ` · ${m.sourceSheet ? "imported" : "saved"} ${new Date(m.importedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`}
        </span>
      </div>
      {(onEdit || onDelete) && (
        <div className="flex gap-1">
          {onEdit && (
            <Button size="sm" variant="outline" onClick={onEdit}>
              <Pencil className="size-4" />
              Edit
            </Button>
          )}
          {onDelete && (
            <Button size="sm" variant="ghost" onClick={onDelete} aria-label={`Delete ${monthLabel(m.month)}`}>
              <Trash2 className="size-4" />
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}

function Tiles({ m, prev, profile }: { m: PaymentMonth; prev: PaymentMonth | null; profile: MerchantPayments["profile"] }) {
  const mrrDiff = m.contract != null && profile.mrr != null && Math.abs(m.contract - profile.mrr) >= 0.5;
  const short = m.contract != null && m.charged != null ? m.contract - m.charged : null;
  const charged: [string, StatTone] =
    m.charged == null ? ["Not in the report", "neutral"] :
    m.charged === 0 && (m.contract ?? 0) > 0 ? ["Not charged this month", "danger"] :
    short && short > 0 ? [`${money(short)} short of the contract`, "warning"] :
    ["Fully billed", "ok"];
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatTile
        icon={Receipt}
        label="Contract"
        value={money(m.contract, true)}
        status={profile.mrr == null ? "No MRR on the Profile" : mrrDiff ? `Profile MRR is ${money(profile.mrr, true)}` : "Matches the Profile's MRR"}
        tone={profile.mrr == null ? "neutral" : mrrDiff ? "warning" : "ok"}
      />
      <StatTile icon={Wallet} label="Charged" value={money(m.charged, true)} status={charged[0]} tone={charged[1]} />
      <StatTile
        icon={TrendingUp}
        label="Online-order revenue"
        value={money(m.ordersRevenue, true)}
        status={
          m.ordersRevenue === 0 ? "No online orders" :
          m.ordersRevenueChange != null && prev ? `${pct(m.ordersRevenueChange)} vs ${monthLabel(prev.month, true)}` :
          "This month"
        }
        tone={m.ordersRevenue === 0 ? "warning" : m.ordersRevenueChange != null && m.ordersRevenueChange <= -0.3 ? "warning" : m.ordersRevenueChange != null && m.ordersRevenueChange > 0 ? "ok" : "neutral"}
      />
      <StatTile
        icon={CircleCheck}
        label="Orders per $1 charged"
        value={m.returnMultiple != null ? `${m.returnMultiple.toLocaleString("en-US")}×` : "—"}
        status={m.returnMultiple != null ? `${money(m.ordersRevenue)} in online orders on ${money(m.charged)} charged` : "Needs a charge and order revenue"}
        tone={m.returnMultiple == null ? "neutral" : m.returnMultiple >= 3 ? "ok" : m.returnMultiple >= 1 ? "neutral" : "warning"}
      />
    </div>
  );
}

function Checks({ m, hasMrr }: { m: PaymentMonth; hasMrr: boolean }) {
  if (!m.checks.length) {
    return (
      <p className="flex items-center gap-2 rounded-lg border border-success/30 bg-success-subtle px-3 py-2 text-sm text-success-subtle-foreground">
        <CircleCheck className="size-4" />
        {hasMrr ? "Billed in full, the contract matches the Profile and online orders came in." : "Billed in full and online orders came in."}
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-2" aria-label="Things to look at">
      {m.checks.map((c) => {
        const s = CHECK[c.level];
        const Icon = s.icon;
        return (
          <li key={c.title} className={cn("flex items-start gap-2.5 rounded-lg border px-3 py-2.5", s.box)}>
            <Icon className={cn("mt-0.5 size-4 shrink-0", s.text)} />
            <div className="text-sm">
              <div className={cn("font-medium", c.level === "info" ? "text-foreground" : s.text)}>{c.title}</div>
              <div className="text-foreground/80">{c.text}</div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function History({ d, current, onPick, onEdit, onDelete }: {
  d: MerchantPayments; current: string; onPick: (m: string) => void; onEdit?: (m: PaymentMonth) => void; onDelete?: (m: PaymentMonth) => void;
}) {
  const asc = [...d.months].reverse();
  return (
    <section className="flex flex-col gap-3">
      <SectionHead
        title="Month by month"
        description={`${d.totals.months} month${d.totals.months === 1 ? "" : "s"} recorded · ${money(d.totals.charged)} charged of ${money(d.totals.contract)} contracted · ${money(d.totals.ordersRevenue)} in online orders`}
      />
      {asc.length > 1 && (
        <Card className="p-4">
          <TrendChart
            dates={asc.map((m) => m.month)}
            series={[
              { key: "charged", label: "Charged", color: "var(--series-1)", values: asc.map((m) => m.charged ?? 0) },
              { key: "orders", label: "Online-order revenue", color: "var(--series-2)", values: asc.map((m) => m.ordersRevenue ?? 0) },
            ]}
          />
        </Card>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Month</TableHead>
            <TableHead>Status</TableHead>
            <TableHead align="right">Contract</TableHead>
            <TableHead align="right">Charged</TableHead>
            <TableHead align="right">Variance</TableHead>
            <TableHead align="right">Online orders</TableHead>
            <TableHead align="right">Per $1</TableHead>
            <TableHead>Flags</TableHead>
            {(onEdit || onDelete) && <TableHead className="w-20" />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {d.months.map((m) => (
            <TableRow key={m.month} className={cn("cursor-pointer", m.month === current && "bg-accent/60")} onClick={() => onPick(m.month)}>
              <TableCell className="font-medium">{monthLabel(m.month)}</TableCell>
              <TableCell>{m.status ? <Badge tone={STATUS_TONE[m.status.toLowerCase()] ?? "neutral"} icon={false}>{m.status}</Badge> : "—"}</TableCell>
              <TableCell align="right">{money(m.contract)}</TableCell>
              <TableCell align="right">{money(m.charged)}</TableCell>
              <TableCell align="right" className={cn((m.variance ?? 0) > 0 && "text-text-destructive")}>{m.variance ? money(m.variance) : "—"}</TableCell>
              <TableCell align="right">{money(m.ordersRevenue)}</TableCell>
              <TableCell align="right">{m.returnMultiple != null ? `${m.returnMultiple}×` : "—"}</TableCell>
              <TableCell className="text-xs text-muted-foreground">{m.checks.length ? m.checks.map((c) => c.title).join(" · ") : "—"}</TableCell>
              {(onEdit || onDelete) && (
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <div className="flex justify-end gap-0.5">
                    {onEdit && (
                      <Button size="xs" variant="ghost" onClick={() => onEdit(m)} aria-label={`Edit ${monthLabel(m.month)}`}>
                        <Pencil className="size-3.5" />
                      </Button>
                    )}
                    {onDelete && (
                      <Button size="xs" variant="ghost" onClick={() => onDelete(m)} aria-label={`Delete ${monthLabel(m.month)}`}>
                        <Trash2 className="size-3.5" />
                      </Button>
                    )}
                  </div>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}
