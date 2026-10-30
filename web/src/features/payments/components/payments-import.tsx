"use client";

import { useMemo, useRef, useState } from "react";
import { CircleAlert, FileSpreadsheet, Upload } from "lucide-react";
import { Badge, type BadgeTone, Button, Dialog, Input, Select, useToast } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import { useImportPayments } from "../api";
import { money, monthLabel } from "../lib";
import type { PaymentImportRow, PaymentsImport } from "../types";

const ACCEPT = ".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv";
type Filter = "all" | "pick" | "suggested" | "sure";

function rowState(r: PaymentImportRow, choice: string | undefined): { label: string; tone: BadgeTone } {
  if (r.duplicateOf) return { label: "Same merchant twice", tone: "warning" };
  if (choice === "skip" || !r.merchantId) return { label: choice === "skip" ? "Not imported" : "Pick a merchant", tone: choice === "skip" ? "neutral" : "warning" };
  if (choice && choice !== r.suggested) return { label: "Your pick", tone: "accent" };
  return r.sure ? { label: "Sure match", tone: "success" } : { label: "Suggested", tone: "primary" };
}

/**
 * Merchants → Import → Payments report. The workbook's revenue sheet (default: the latest month,
 * e.g. "Revenue Sheet Sept. 2026") is previewed first: each account is matched to a merchant by
 * name (sure / suggested / pick one), nothing is written until "Import".
 */
export function PaymentsImportPanel({ onDone }: { onDone?: () => void }) {
  const { toast } = useToast();
  const run = useImportPayments();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PaymentsImport | null>(null);
  const [applied, setApplied] = useState<PaymentsImport | null>(null);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  const check = (f: File, opts: { sheet?: string; month?: string; choices?: Record<string, string> } = {}) => {
    setError(null);
    run.mutate(
      { file: f, dryRun: true, ...opts },
      { onSuccess: setPreview, onError: (e) => setError(e.messages?.join(" · ") ?? e.message) },
    );
  };
  const choose = (f: File | undefined) => {
    if (!f) return;
    setFile(f);
    setPreview(null);
    setApplied(null);
    setChoices({});
    check(f);
  };
  const month = preview?.month?.slice(0, 7);

  const rows = useMemo(() => {
    const all = preview?.rows ?? [];
    if (filter === "pick") return all.filter((r) => !r.merchantId && choices[r.key] !== "skip");
    if (filter === "suggested") return all.filter((r) => r.merchantId && !r.sure);
    if (filter === "sure") return all.filter((r) => r.sure && r.merchantId === r.suggested);
    return all;
  }, [preview, filter, choices]);

  const pick = (r: PaymentImportRow, value: string) => {
    const next = { ...choices, [r.key]: value };
    setChoices(next);
    // Re-check so duplicates / "replaces" follow the pick.
    if (file && preview) check(file, { sheet: preview.sheet, month, choices: next });
  };

  const apply = () => {
    if (!file || !preview) return;
    run.mutate(
      { file, dryRun: false, sheet: preview.sheet, month, choices },
      {
        onSuccess: (res) => {
          setApplied(res);
          toast({ variant: "success", title: `Payments imported for ${monthLabel(res.applied?.month)}`, description: `${res.applied?.written ?? 0} merchants updated` });
          onDone?.();
        },
        onError: (e) => setError(e.messages?.join(" · ") ?? e.message),
      },
    );
  };

  if (applied) {
    return (
      <div className="flex flex-col gap-3" data-testid="payments-import-done">
        <p className="rounded-lg border border-success/30 bg-success-subtle px-3 py-2 text-sm text-success-subtle-foreground">
          {applied.applied?.written ?? 0} merchants now have their {monthLabel(applied.applied?.month)} payment on their Payments tab.
          {applied.totals.unmatched > 0 && ` ${applied.totals.unmatched} rows weren't imported (no merchant picked).`}
        </p>
        <Button size="sm" variant="outline" className="w-fit" onClick={() => { setApplied(null); setPreview(null); setFile(null); }}>
          Import another report
        </Button>
      </div>
    );
  }

  const t = preview?.totals;
  const willImport = preview ? preview.rows.filter((r) => r.merchantId && !r.duplicateOf).length : 0;
  return (
    <div className="flex flex-col gap-4">
      <label
        className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-border px-4 py-5 text-center hover:bg-accent"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          choose(e.dataTransfer.files?.[0]);
        }}
      >
        {file ? <FileSpreadsheet className="size-8 text-muted-foreground" /> : <Upload className="size-8 text-muted-foreground" />}
        <span className="text-sm font-medium text-foreground">{file ? file.name : "Drop the revenue report (.xlsx) here, or click to choose"}</span>
        <span className="max-w-lg text-table text-muted-foreground">
          The sheet with Accounts · Status · Package Type · Contract · Charged · Variance · Online Orders Revenue · Notes (e.g. “Revenue Sheet Sept. 2026”).
          Each account is matched to its merchant by name; re-importing a month replaces it.
        </span>
        <input ref={fileRef} type="file" accept={ACCEPT} hidden data-testid="payments-import-file" onChange={(e) => { choose(e.target.files?.[0]); e.target.value = ""; }} />
      </label>

      {run.isPending && !preview && <p className="text-table text-muted-foreground">Reading the report and matching accounts to merchants…</p>}
      {error && (
        <p className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-text-destructive">
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      )}

      {preview && t && (
        <div className="flex flex-col gap-3" data-testid="payments-import-preview">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              Sheet
              <Select value={preview.sheet} className="w-72" onChange={(e) => file && check(file, { sheet: e.target.value, choices: {} })}>
                {preview.sheets.map((s) => (
                  <option key={s.name} value={s.name}>
                    {s.name} ({s.rows} rows)
                  </option>
                ))}
              </Select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              Month
              <Input type="month" className="w-44" value={month ?? ""} onChange={(e) => file && e.target.value && check(file, { sheet: preview.sheet, month: e.target.value, choices })} />
            </label>
            <span className="pb-2 text-xs text-muted-foreground">Saved as {monthLabel(preview.month)} on each merchant.</span>
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-table sm:grid-cols-4">
            <Stat label="Accounts in the sheet" value={t.rows} />
            <Stat label="Matched to a merchant" value={t.matched} />
            <Stat label="Need a pick" value={t.unmatched} tone={t.unmatched ? "warning" : undefined} />
            <Stat label="Replace an imported month" value={t.replaces} />
          </dl>
          <p className="text-xs text-muted-foreground">
            Sheet totals: contract {money(t.contract)} · charged {money(t.charged)} · variance {money(t.variance)} · online orders {money(t.ordersRevenue)}
          </p>

          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filter rows">
            {(
              [
                ["all", `All (${preview.rows.length})`],
                ["pick", `Need a pick (${preview.rows.filter((r) => !r.merchantId && choices[r.key] !== "skip").length})`],
                ["suggested", `Suggested (${preview.rows.filter((r) => r.merchantId && !r.sure).length})`],
                ["sure", `Sure (${t.sure})`],
              ] as [Filter, string][]
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={filter === k}
                onClick={() => setFilter(k)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs font-medium",
                  filter === k ? "border-primary bg-primary-subtle text-primary-subtle-foreground" : "border-border text-muted-foreground hover:bg-accent",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <ul className="flex max-h-[26rem] flex-col divide-y divide-border overflow-y-auto rounded-lg border border-border">
            {rows.map((r) => (
              <PreviewRow key={r.key} r={r} choice={choices[r.key]} all={preview.merchants} onPick={(v) => pick(r, v)} />
            ))}
            {rows.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted-foreground">No rows here.</li>}
          </ul>

          <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
            <span className="mr-auto text-xs text-muted-foreground">Preview only — nothing has been written yet.</span>
            <Button size="sm" onClick={apply} loading={run.isPending} disabled={!willImport || !preview.month}>
              Import {willImport} payment{willImport === 1 ? "" : "s"} for {monthLabel(preview.month)}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function PreviewRow({ r, choice, all, onPick }: {
  r: PaymentImportRow; choice: string | undefined; all: PaymentsImport["merchants"]; onPick: (v: string) => void;
}) {
  const st = rowState(r, choice);
  const value = choice === "skip" ? "skip" : (r.merchantId ?? "");
  const short = r.contract != null && r.charged != null && r.charged < r.contract;
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
      <div className="min-w-56 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-foreground">{r.account}</span>
          {r.status && (
            <Badge tone={r.status.toLowerCase() === "active" ? "success" : "warning"} icon={false}>
              {r.status}
            </Badge>
          )}
        </div>
        <div className="text-xs text-muted-foreground">
          Contract {money(r.contract)} · charged <span className={cn(short && "font-medium text-text-destructive")}>{money(r.charged)}</span> · online orders{" "}
          {money(r.ordersRevenue)}
          {r.notes && <span title={r.notes}> · “{r.notes.length > 50 ? `${r.notes.slice(0, 50)}…` : r.notes}”</span>}
        </div>
      </div>
      <div className="flex flex-col items-end gap-1">
        <div className="flex items-center gap-2">
          <Badge tone={st.tone} icon={false}>
            {st.label}
          </Badge>
          <Select value={value} className="h-8 w-64 text-xs" aria-label={`Merchant for ${r.account}`} onChange={(e) => onPick(e.target.value || "skip")}>
            <option value="">Pick a merchant…</option>
            <option value="skip">Don&apos;t import this row</option>
            {r.candidates.length > 0 && (
              <optgroup label="Best matches">
                {r.candidates.map((c) => (
                  <option key={c.merchantId} value={c.merchantId}>
                    {c.name} — {c.score}%
                  </option>
                ))}
              </optgroup>
            )}
            <optgroup label="All merchants">
              {all.map((m) => (
                <option key={m.merchantId} value={m.merchantId}>
                  {m.name}
                  {m.code ? ` (${m.code})` : ""}
                </option>
              ))}
            </optgroup>
          </Select>
        </div>
        {r.merchantId && r.candidates[0]?.merchantId === r.merchantId && (
          <span className="text-[11px] text-muted-foreground">{r.candidates[0].reason}{r.replaces ? " · replaces the imported month" : ""}</span>
        )}
        {r.duplicateOf && <span className="text-[11px] text-warning-text">Another row already goes to this merchant — this one is left out.</span>}
      </div>
    </li>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "warning" }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={cn("text-base font-semibold text-foreground", tone === "warning" && value > 0 && "text-warning-text")}>{value}</dd>
    </div>
  );
}

/** The same import on its own, opened from a merchant's Payments tab. */
export function PaymentsImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="Import a revenue report" description="Payments per merchant for one month, from the paid-marketing revenue sheet." size="3xl">
      {open && <PaymentsImportPanel />}
    </Dialog>
  );
}
