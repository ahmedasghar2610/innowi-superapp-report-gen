"use client";

import { useRef, useState } from "react";
import { CircleAlert, FileSpreadsheet, Upload } from "lucide-react";
import { Button, Dialog, useToast } from "@/components/ui";
import { useImportChurn } from "../queries";
import type { ChurnImportReport } from "../types";

const ACCEPT = ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * Upload one of the CSM churn workbooks. Step 1 is always a dry run (nothing
 * is written) so the numbers can be checked; step 2 applies the same file.
 */
export function ChurnImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const run = useImportChurn();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ChurnImportReport | null>(null);
  const [applied, setApplied] = useState<ChurnImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setFile(null);
    setPreview(null);
    setApplied(null);
    setError(null);
  };
  const close = () => {
    reset();
    onClose();
  };

  const choose = (f: File | undefined) => {
    if (!f) return;
    setError(null);
    setApplied(null);
    setPreview(null);
    setFile(f);
    run.mutate(
      { file: f, dryRun: true },
      {
        onSuccess: setPreview,
        onError: (err) => setError(err.messages.join(" · ")),
      },
    );
  };

  const apply = () => {
    if (!file) return;
    run.mutate(
      { file, dryRun: false },
      {
        onSuccess: (rep) => {
          setApplied(rep);
          toast({ variant: "success", title: `Imported ${rep.rowsRead} rows`, description: `${rep.merchantsCreated} new merchants, ${rep.merchantsMatched} updated` });
        },
        onError: (err) => setError(err.messages.join(" · ")),
      },
    );
  };

  const rep = applied ?? preview;

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Import a churn workbook"
      description="The CSM team's spreadsheets: the contacts list (BA / LA sheets) or the churn reasons sheet. Every row becomes a merchant with status Churned."
      size="xl"
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">{applied ? "Done — the list is updated." : preview ? "Preview only — nothing has been written yet." : ""}</span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={close}>
              {applied ? "Close" : "Cancel"}
            </Button>
            {!applied && (
              <Button variant="default" size="sm" onClick={apply} disabled={!preview || run.isPending} loading={run.isPending && !!preview}>
                Import {preview ? `${preview.rowsRead} rows` : ""}
              </Button>
            )}
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {!applied && (
          <label
            className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-border px-4 py-6 text-center hover:bg-accent"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              choose(e.dataTransfer.files?.[0]);
            }}
          >
            {file ? <FileSpreadsheet className="size-8 text-muted-foreground" /> : <Upload className="size-8 text-muted-foreground" />}
            <span className="text-sm font-medium text-foreground">{file ? file.name : "Drop the .xlsx here, or click to choose"}</span>
            <span className="max-w-md text-table text-muted-foreground">
              Sheets are read by their header row (an “Account Name” column). Subtotal and month rows are skipped. Re-importing the same file is safe: nothing is duplicated and win-back work is kept.
            </span>
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPT}
              hidden
              data-testid="churn-import-file"
              onChange={(e) => {
                choose(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
        )}

        {run.isPending && !preview && <p className="text-table text-muted-foreground">Reading the workbook…</p>}

        {error && (
          <p className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-text-destructive">
            <CircleAlert className="mt-0.5 size-4 shrink-0" />
            {error}
          </p>
        )}

        {rep && (
          <div className="flex flex-col gap-3" data-testid="churn-import-report">
            <p className="text-xs font-semibold text-foreground">{applied ? "Imported" : "What this file would do"}</p>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-table sm:grid-cols-3">
              <Stat label="Rows read" value={rep.rowsRead} />
              <Stat label="New merchants" value={rep.merchantsCreated} />
              <Stat label="Existing merchants updated" value={rep.merchantsMatched} />
              <Stat label="Contacts added" value={rep.contactsAdded} />
              <Stat label="Locations added" value={rep.locationsAdded} />
              <Stat label="Same place listed twice" value={rep.duplicatesInFile} />
            </dl>
            <ul className="text-xs text-muted-foreground">
              {rep.sheets.map((s) => (
                <li key={s.name}>
                  Sheet <span className="font-medium text-foreground">{s.name}</span>:{" "}
                  {s.layout === "unknown" ? "no Account Name column — skipped" : `${s.rows} rows (${s.layout} layout)`}
                  {s.skipped ? `, ${s.skipped} skipped` : ""}
                </li>
              ))}
            </ul>
            {rep.ambiguous.length > 0 && (
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer">
                  {rep.ambiguous.length} name{rep.ambiguous.length === 1 ? "" : "s"} matched several locations (the one in the same region was used)
                </summary>
                <ul className="mt-1 list-disc pl-4">
                  {rep.ambiguous.slice(0, 30).map((a) => (
                    <li key={`${a.sheet}-${a.row}`}>
                      {a.sheet} row {a.row}: {a.name} → {a.matched} ({a.candidates} candidates)
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {rep.skipped.length > 0 && (
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer">{rep.skipped.length} rows skipped</summary>
                <ul className="mt-1 list-disc pl-4">
                  {rep.skipped.slice(0, 30).map((s) => (
                    <li key={`${s.sheet}-${s.row}`}>
                      {s.sheet} row {s.row}: {s.reason}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-[0.04em] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-foreground tabular">{value}</dd>
    </div>
  );
}
