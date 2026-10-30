"use client";

import { useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, CircleAlert, FileSpreadsheet, Upload } from "lucide-react";
import { Badge, type BadgeTone, Button, Dialog, useToast } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import { describeConnect, useImportMerchants } from "@/features/merchants/api";
import type { ImportDecisions, ImportField, ImportReport, ImportRow, OtherSheetImport, PromotionImportRow, PromotionsImport } from "@/features/merchants/types";
import { PaymentsImportPanel } from "@/features/payments/components/payments-import";
import { MenuBulkPanel } from "./menu-bulk-panel";

const ACCEPT = ".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv";
const SHOW = 60;

const ACTION: Record<ImportRow["action"], { label: string; tone: BadgeTone }> = {
  create: { label: "New", tone: "success" },
  update: { label: "Update", tone: "accent" },
  unchanged: { label: "No changes", tone: "neutral" },
  skip: { label: "Not imported", tone: "warning" },
};
const MENU: Record<"ready" | "pick" | "none", { label: string; tone: BadgeTone }> = {
  ready: { label: "Menu: ready", tone: "success" },
  pick: { label: "Menu: pick a link", tone: "warning" },
  none: { label: "Menu: no Innowi link", tone: "neutral" },
};
type Filter = "all" | "conflicts" | "create" | "update" | "skip";

/**
 * Merchants → Import from XLS / CSV. Step 1 is always a preview (nothing is
 * written): every field is new, filled in, the same, or a conflict. A conflict
 * keeps the Super App's value unless "Use sheet" is picked. Step 2 applies
 * the same file with those choices; step 3 checks and fetches the menus.
 */
export function MerchantImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const run = useImportMerchants();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportReport | null>(null);
  const [applied, setApplied] = useState<ImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [useSheet, setUseSheet] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<Filter>("all");
  // What the file is: the Merchant Profile System workbook, or the monthly payments (revenue) report.
  const [mode, setMode] = useState<"workbook" | "payments">("workbook");

  const reset = () => {
    setFile(null);
    setPreview(null);
    setApplied(null);
    setError(null);
    setUseSheet(new Set());
    setFilter("all");
  };
  const close = () => {
    reset();
    setMode("workbook");
    onClose();
  };

  const choose = (f: File | undefined) => {
    if (!f) return;
    reset();
    setFile(f);
    run.mutate(
      { file: f, dryRun: true },
      { onSuccess: setPreview, onError: (err) => setError(err.messages.join(" · ")) },
    );
  };

  const apply = () => {
    if (!file || !preview) return;
    const decisions: ImportDecisions = { useSheet: [...useSheet], useSheetAll: [] };
    run.mutate(
      { file, dryRun: false, decisions },
      {
        onSuccess: (rep) => {
          setApplied(rep);
          const a = rep.applied;
          toast({
            variant: "success",
            title: `Imported ${(a?.created ?? 0) + (a?.updated ?? 0)} merchants`,
            description: [
              `${a?.created ?? 0} new, ${a?.updated ?? 0} updated, ${a?.conflictsKept ?? 0} conflicts kept as they were`,
              rep.promotions?.applied?.created ? `${rep.promotions.applied.created} promotions added` : "",
              rep.connected && !rep.connected.skipped && Object.keys(rep.connected.summary).length ? `linked ${describeConnect(rep.connected.summary)}` : "",
            ].filter(Boolean).join(" · "),
          });
        },
        onError: (err) => setError(err.messages.join(" · ")),
      },
    );
  };

  const toggle = (key: string, on: boolean) =>
    setUseSheet((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });

  const rows = useMemo(() => {
    const all = preview?.rows ?? [];
    switch (filter) {
      case "conflicts":
        return all.filter((r) => r.fields.some((f) => f.status === "conflict"));
      case "create":
      case "update":
      case "skip":
        return all.filter((r) => r.action === filter);
      default:
        return all;
    }
  }, [preview, filter]);

  const t = preview?.totals;
  const promoNew = (preview?.promotions?.totals.new ?? 0) + (preview?.otherSheets ?? []).reduce((n, x) => n + x.new, 0);
  const toWrite = t ? t.create + t.update : 0;
  const menuIds = (applied?.applied?.merchantIds ?? []).filter(Boolean);

  return (
    <Dialog
      open={open}
      onClose={close}
      title={mode === "payments" ? "Import payments report" : applied ? "Merchants imported" : "Import merchants from XLS / CSV"}
      description={
        mode === "payments"
          ? "One month of billing per merchant from the paid-marketing revenue sheet — shown on each merchant's Payments tab."
          : applied
          ? "Check which menus can be fetched, then fetch them."
          : "The Merchants and Promotions sheets of the Merchant Profile System workbook. Existing values are kept; new ones are added; conflicts are shown for you to decide."
      }
      size="3xl"
      footerBordered
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {mode === "payments" ? "" : applied ? "Done — the merchant list is updated." : preview ? "Preview only — nothing has been written yet." : ""}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={close}>
              {applied || mode === "payments" ? "Close" : "Cancel"}
            </Button>
            {!applied && mode === "workbook" && (
              <Button variant="default" size="sm" onClick={apply} disabled={!preview || toWrite + promoNew === 0 || run.isPending} loading={run.isPending && !!preview}>
                {preview
                  ? toWrite + promoNew
                    ? `Import ${[toWrite && `${toWrite} merchant${toWrite === 1 ? "" : "s"}`, promoNew && `${promoNew} promotion / connection / service record${promoNew === 1 ? "" : "s"}`].filter(Boolean).join(" + ")}`
                    : "Nothing to import"
                  : "Import"}
              </Button>
            )}
          </div>
        </div>
      }
    >
      {!applied && (
        <div className="mb-4 flex w-fit gap-1 rounded-lg bg-muted p-1" role="tablist" aria-label="What to import">
          {(
            [
              ["workbook", "Merchant workbook"],
              ["payments", "Payments report"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={mode === k}
              onClick={() => {
                reset();
                setMode(k);
              }}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                mode === k ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {mode === "payments" ? (
        <PaymentsImportPanel />
      ) : applied ? (
        <div className="flex flex-col gap-4" data-testid="merchant-import-done">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-table sm:grid-cols-4">
            <Stat label="New merchants" value={applied.applied?.created ?? 0} />
            <Stat label="Updated" value={applied.applied?.updated ?? 0} />
            <Stat label="Fields written" value={applied.applied?.fieldsWritten ?? 0} />
            <Stat label="Keywords / competitors added" value={applied.applied?.added ?? 0} />
            <Stat label="Conflicts: kept app value" value={applied.applied?.conflictsKept ?? 0} />
            <Stat label="Conflicts: used sheet" value={applied.applied?.conflictsReplaced ?? 0} />
            {applied.promotions && <Stat label="Promotions added" value={applied.promotions.applied?.created ?? 0} />}
          </dl>
          {applied.promotions && <PromotionsPreview p={applied.promotions} />}
          {!!applied.otherSheets?.length && <OtherSheets sheets={applied.otherSheets} done />}
          {menuIds.length > 0 && <MenuBulkPanel merchantIds={menuIds} />}
        </div>
      ) : (
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
            <span className="text-sm font-medium text-foreground">{file ? file.name : "Drop the .xlsx or .csv here, or click to choose"}</span>
            <span className="max-w-lg text-table text-muted-foreground">
              Rows are matched on Merchant ID, then restaurant name. Empty cells never clear a value, and nothing is deleted. Columns the importer doesn&apos;t know are ignored.
            </span>
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPT}
              hidden
              data-testid="merchant-import-file"
              onChange={(e) => {
                choose(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>

          {run.isPending && !preview && <p className="text-table text-muted-foreground">Reading the file and comparing it with the Super App…</p>}
          {error && (
            <p className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-text-destructive">
              <CircleAlert className="mt-0.5 size-4 shrink-0" />
              {error}
            </p>
          )}

          {preview && t && (
            <div className="flex flex-col gap-3" data-testid="merchant-import-preview">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-table sm:grid-cols-4">
                <Stat label="Merchant rows" value={t.rows} />
                <Stat label="New merchants" value={t.create} />
                <Stat label="Existing, with changes" value={t.update} />
                <Stat label="Existing, no changes" value={t.unchanged} />
                <Stat label="Fields to fill in" value={t.fills} />
                <Stat label="Conflicts to decide" value={t.conflicts} tone={t.conflicts ? "warning" : undefined} />
                <Stat label="Keywords / competitors to add" value={t.adds} />
                <Stat label="Not imported" value={t.skip} tone={t.skip ? "warning" : undefined} />
              </dl>
              {preview.unknownColumns.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Ignored columns: {preview.unknownColumns.join(", ")}
                  {preview.sheet ? ` · sheet "${preview.sheet}"` : ""}
                </p>
              )}

              <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filter rows">
                {(
                  [
                    ["all", `All (${preview.rows.length})`],
                    ["conflicts", `With conflicts (${preview.rows.filter((r) => r.fields.some((f) => f.status === "conflict")).length})`],
                    ["create", `New (${t.create})`],
                    ["update", `Updates (${t.update})`],
                    ["skip", `Not imported (${t.skip})`],
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

              <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
                {rows.slice(0, SHOW).map((r) => (
                  <PreviewRow key={`${r.key}-${r.row}`} r={r} useSheet={useSheet} onToggle={toggle} />
                ))}
                {rows.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted-foreground">No rows here.</li>}
              </ul>
              {rows.length > SHOW && <p className="text-xs text-muted-foreground">Showing the first {SHOW} of {rows.length} rows; all of them are imported.</p>}
              {preview.promotions && <PromotionsPreview p={preview.promotions} />}
              {!!preview.otherSheets?.length && <OtherSheets sheets={preview.otherSheets} />}
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}

function PreviewRow({ r, useSheet, onToggle }: { r: ImportRow; useSheet: Set<string>; onToggle: (key: string, on: boolean) => void }) {
  const conflicts = r.fields.filter((f) => f.status === "conflict");
  const filled = r.fields.filter((f) => f.status !== "conflict");
  const [open, setOpen] = useState(conflicts.length > 0);
  const allSheet = conflicts.length > 0 && conflicts.every((f) => useSheet.has(`${r.key}::${f.key}`));
  return (
    <li className="px-3 py-2.5">
      <button type="button" className="flex w-full flex-wrap items-center gap-2 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? <ChevronDown className="size-4 text-muted-foreground" /> : <ChevronRight className="size-4 text-muted-foreground" />}
        <span className="font-mono text-xs text-muted-foreground">{r.merchantCode ?? `row ${r.row}`}</span>
        <span className="text-sm font-medium text-foreground">{r.restaurantName ?? "—"}</span>
        <Badge tone={ACTION[r.action].tone} icon={false}>
          {ACTION[r.action].label}
        </Badge>
        {conflicts.length > 0 && (
          <Badge tone="warning" icon={false}>
            {conflicts.length} conflict{conflicts.length === 1 ? "" : "s"}
          </Badge>
        )}
        {r.menu && (
          <Badge tone={MENU[r.menu.status].tone} icon={false}>
            {MENU[r.menu.status].label}
          </Badge>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {r.action === "skip"
            ? r.reason
            : `${filled.length} to ${r.action === "create" ? "set" : "fill in"}${r.adds.length ? ` · ${r.adds.length} to add` : ""}${r.sameCount ? ` · ${r.sameCount} same` : ""}`}
        </span>
      </button>

      {open && r.action !== "skip" && (
        <div className="mt-2 flex flex-col gap-3 pl-6">
          {conflicts.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-foreground">Conflicts — the Super App&apos;s value is kept unless you pick the sheet&apos;s</span>
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => conflicts.forEach((f) => onToggle(`${r.key}::${f.key}`, !allSheet))}
                >
                  {allSheet ? "Keep all app values" : "Use sheet for all"}
                </Button>
              </div>
              <table className="w-full table-fixed text-xs">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th className="w-36 py-1 font-medium">Field</th>
                    <th className="py-1 font-medium">In the Super App</th>
                    <th className="py-1 font-medium">In the sheet</th>
                  </tr>
                </thead>
                <tbody>
                  {conflicts.map((f) => (
                    <ConflictRow key={f.key} f={f} k={`${r.key}::${f.key}`} useSheet={useSheet} onToggle={onToggle} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {filled.length > 0 && (
            <details className="text-xs" open={r.action === "update" && filled.length <= 8}>
              <summary className="cursor-pointer font-semibold text-foreground">
                {r.action === "create" ? "Fields set on the new merchant" : "Empty in the Super App — filled from the sheet"} ({filled.length})
              </summary>
              <dl className="mt-1 grid grid-cols-[9rem_1fr] gap-x-3 gap-y-1">
                {filled.map((f) => (
                  <div key={f.key} className="contents">
                    <dt className="text-muted-foreground">{f.label}</dt>
                    <dd className="truncate text-foreground" title={f.incoming ?? undefined}>
                      {f.incoming}
                    </dd>
                  </div>
                ))}
              </dl>
            </details>
          )}
          {r.adds.length > 0 && (
            <p className="text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">Added: </span>
              {r.adds.map((a) => `${a.value} (${a.label})`).join(" · ")}
            </p>
          )}
          {r.menu && r.menu.links.length > 0 && (
            <p className="text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">Innowi links in Online ordering: </span>
              {r.menu.links.map((l) => l.replace(/^https?:\/\//, "")).join(" · ")}
            </p>
          )}
          {r.warnings.map((w) => (
            <p key={w} className="flex items-start gap-1.5 text-xs text-warning-text">
              <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
              {w}
            </p>
          ))}
        </div>
      )}
    </li>
  );
}

function ConflictRow({ f, k, useSheet, onToggle }: { f: ImportField; k: string; useSheet: Set<string>; onToggle: (key: string, on: boolean) => void }) {
  const sheet = useSheet.has(k);
  return (
    <tr className="align-top">
      <td className="py-1 pr-2 text-muted-foreground">
        {f.label}
        <span className="block text-[10px] uppercase tracking-[0.04em]">{f.group}</span>
      </td>
      <td className="py-1 pr-2">
        <label className={cn("flex cursor-pointer items-start gap-1.5 rounded-md border px-2 py-1", !sheet ? "border-primary bg-primary-subtle" : "border-border")}>
          <input type="radio" name={k} className="mt-0.5" checked={!sheet} onChange={() => onToggle(k, false)} />
          <span className="break-words text-foreground">{f.current}</span>
        </label>
      </td>
      <td className="py-1">
        <label className={cn("flex cursor-pointer items-start gap-1.5 rounded-md border px-2 py-1", sheet ? "border-primary bg-primary-subtle" : "border-border")}>
          <input type="radio" name={k} className="mt-0.5" checked={sheet} onChange={() => onToggle(k, true)} />
          <span className="break-words text-foreground">{f.incoming}</span>
        </label>
      </td>
    </tr>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "warning" }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-[0.04em] text-muted-foreground">{label}</dt>
      <dd className={cn("mt-0.5 tabular-nums", tone === "warning" && value ? "text-warning-text" : "text-foreground")}>{value}</dd>
    </div>
  );
}

const PROMO_ACTION: Record<PromotionImportRow["action"], { label: string; tone: "success" | "neutral" | "warning" }> = {
  new: { label: "New", tone: "success" },
  exists: { label: "Already there", tone: "neutral" },
  noMerchant: { label: "No merchant", tone: "warning" },
  none: { label: "No promotion", tone: "neutral" },
};

/** The workbook's Promotions sheet: what goes onto each merchant's Profiling → Promotions. */
function PromotionsPreview({ p }: { p: PromotionsImport }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-border p-3" aria-label="Promotions">
      <button type="button" onClick={() => setOpen(!open)} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-left">
        <span className="text-sm font-semibold text-foreground">Promotions{p.sheet ? ` — sheet "${p.sheet}"` : ""}</span>
        <span className="text-xs text-muted-foreground">
          {p.totals.new} new · {p.totals.exists} already there · {p.totals.none} merchants with no promotion · {p.totals.noMerchant} with no merchant
        </span>
        <span className="ml-auto text-xs font-medium text-primary">{open ? "Hide" : "Show"}</span>
      </button>
      {open && (
        <>
          <p className="text-xs text-muted-foreground">
            New ones are added to each merchant&apos;s Profiling → Promotions (the Google Ads Offers tab reads them too). Ones already there are skipped; columns
            the importer doesn&apos;t know go into the promotion&apos;s notes.
          </p>
          <ul className="flex max-h-72 flex-col divide-y divide-border overflow-y-auto rounded-md border border-border">
            {p.rows.slice(0, SHOW).map((r) => {
              const a = PROMO_ACTION[r.action];
              return (
                <li key={r.row} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                  <span className="min-w-40 flex-1">
                    <span className="font-medium text-foreground">{r.action === "none" ? (r.merchantName ?? r.restaurantName) : (r.promoName ?? r.promoCode ?? "Untitled promotion")}</span>
                    <span className="block text-xs text-muted-foreground">
                      {r.action === "none" ? "The sheet says no promotion is running — nothing is added." : [r.merchantName ?? r.restaurantName ?? r.merchantCode, r.offerType, r.offerValue, r.promoCode && `code ${r.promoCode}`,
                        (r.startDate || r.endDate) && `${r.startDate ?? "…"} → ${r.endDate ?? "…"}`].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <Badge tone={a.tone} icon={false}>{a.label}</Badge>
                  {r.note && r.action !== "exists" && r.action !== "none" && <span className="w-full text-xs text-muted-foreground sm:w-auto">{r.note}</span>}
                </li>
              );
            })}
            {p.rows.length === 0 && <li className="px-3 py-4 text-center text-sm text-muted-foreground">The sheet has no promotions filled in.</li>}
          </ul>
        </>
      )}
    </section>
  );
}

/** Access → Connections and Delivery → Services: counts per sheet. */
function OtherSheets({ sheets, done }: { sheets: OtherSheetImport[]; done?: boolean }) {
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-border p-3" aria-label="Other sheets">
      <span className="text-sm font-semibold text-foreground">Other sheets</span>
      <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
        {sheets.map((x) => (
          <li key={x.kind} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
            <span className="min-w-48 flex-1">
              <span className="font-medium text-foreground">
                Sheet &quot;{x.sheet}&quot; → {x.label}
              </span>
              <span className="block text-xs text-muted-foreground">
                {[
                  `${done ? x.added : x.new} ${done ? "added" : "new"}`,
                  `${x.exists} already there`,
                  x.skipped && `${x.skipped} not included`,
                  x.noMerchant && `${x.noMerchant} with no merchant`,
                  x.unknown.length && `unknown services: ${x.unknown.join(", ")}`,
                ].filter(Boolean).join(" · ")}
              </span>
            </span>
            <Badge tone={(done ? x.added : x.new) ? "success" : "neutral"} icon={false}>
              {done ? x.added : x.new}
            </Badge>
          </li>
        ))}
      </ul>
    </section>
  );
}
