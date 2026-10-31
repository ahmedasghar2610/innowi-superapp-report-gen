"use client";

import { Download, Lock, ShieldCheck } from "lucide-react";
import { Button, Card } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import { exportUrl } from "../api";
import { dateTime, historyLine, longDate } from "../format";
import type { Report, Snapshot } from "../types";

/**
 * The right-hand column of the prototype's merchant report: report setup, the
 * preview switch, and the standing note about what never appears in a
 * merchant-facing report.
 */

/* ----------------------------------------------------------- downloads ---- */
/**
 * PDF / DOCX are plain links, not fetches: the API returns file bytes with a
 * Content-Disposition, and the auth cookie rides along on the navigation. Both
 * routes refuse anything that is not approved or sent, so the buttons are
 * disabled until then rather than offering a download the API will reject.
 */
export function ExportButtons({ r }: { r: Report }) {
  const ready = r.status === "approved" || r.status === "sent";
  if (!ready) {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled className="flex-1">
            <Download /> PDF
          </Button>
          <Button size="sm" variant="outline" disabled className="flex-1">
            <Download /> DOCX
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">A file is made from the approved snapshot, so approve the report first.</p>
      </div>
    );
  }
  return (
    <div className="flex gap-2">
      {(["pdf", "docx"] as const).map((kind) => (
        // <a> wrapping <Button>, the pattern the queue page already uses for Link.
        <a key={kind} href={exportUrl(r.id, kind)} download className="flex-1" data-testid={`report-export-${kind}`}>
          <Button size="sm" variant="outline" className="w-full">
            <Download /> {kind.toUpperCase()}
          </Button>
        </a>
      ))}
    </div>
  );
}

/* --------------------------------------------------------------- setup ---- */
export function ReportSetup({ r, snap }: { r: Report; snap: Snapshot }) {
  const locations = snap.merchant.locationCount ?? null;
  const where = [snap.merchant.city, snap.merchant.state].filter(Boolean).join(", ");
  // The "package" chips come from the sections themselves: `included` is the
  // only place the payload says a module is NOT in the package (MFR01, DQ07).
  // `services[]` lists what was contracted, so on its own it can never show a
  // struck-through module.
  const modules = snap.sectionOrder.map((key) => ({ key, title: snap.sections[key]?.title ?? key, included: !!snap.sections[key]?.included }));

  const rows: [string, string][] = [
    ["Template", snap.template ?? r.template],
    ["Period", `${snap.period.label} · ${snap.period.days} days`],
    ["Locations", locations && locations > 1 ? `${locations}${where ? ` · primary ${where}` : ""}` : where || "1"],
    ["History", historyLine(snap.merchant.goLiveDate)],
    ["Recipients", r.defaultRecipients.length ? r.defaultRecipients.join(", ") : "none on file"],
  ];

  return (
    <Card className="flex flex-col gap-3.5 p-4">
      <h2 className="text-sm font-semibold text-foreground">Report setup</h2>
      <dl className="flex flex-col text-xs">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3 border-b border-border py-2 last:border-0">
            <dt className="shrink-0 text-muted-foreground">{k}</dt>
            <dd className="text-right font-medium text-foreground">{v}</dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold text-foreground">Service package</span>
        <div className="flex flex-wrap gap-1.5">
          {modules.map((m) => (
            <span
              key={m.key}
              className={cn(
                "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                m.included ? "bg-accent text-primary-subtle-foreground" : "bg-muted text-muted-foreground line-through",
              )}
            >
              {m.title}
            </span>
          ))}
        </div>
        <p className="text-xs leading-5 text-muted-foreground">
          A section appears only for a module the merchant has taken. Struck-through modules are not in this package, so they get no section at all.
        </p>
        {snap.services.length > 0 && <p className="text-xs text-muted-foreground">Contracted: {snap.services.join(" · ")}</p>}
      </div>
    </Card>
  );
}

/* ----------------------------------------------------- preview options ---- */
export function PreviewOptions({ merchantView, onChange }: { merchantView: boolean; onChange: (v: boolean) => void }) {
  return (
    <Card className="flex flex-col gap-2 p-4">
      <h2 className="text-sm font-semibold text-foreground">Preview options</h2>
      <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
        <input type="checkbox" className="size-4" checked={merchantView} onChange={(e) => onChange(e.target.checked)} data-testid="report-merchant-view" />
        Preview as the merchant sees it
      </label>
      <p className="text-xs leading-5 text-muted-foreground">
        Hides the internal metric IDs. The modelled and tracked labels stay visible either way — a merchant has to see when a figure is
        attributed rather than measured.
      </p>
    </Card>
  );
}

/* ------------------------------------------------------------- frozen ---- */
export function FrozenBanner({ r }: { r: Report }) {
  if (!r.frozen) return null;
  const at = dateTime(r.approvedAt) || dateTime(r.generatedAt);
  return (
    <div className="flex items-start gap-3 rounded-xl border border-success-border bg-success-subtle p-4 text-sm leading-6 text-success-subtle-foreground">
      <ShieldCheck className="mt-0.5 size-5 shrink-0" />
      <span>
        <span className="font-semibold">Snapshot frozen{at ? ` ${at}` : ""}.</span> This approved version will not change if a source updates
        later, and its PDF and DOCX are rendered from it.
      </span>
    </div>
  );
}

/* ------------------------------------------------- never in this report --- */
export function NeverInThisReport() {
  return (
    <Card className="flex flex-col gap-2 p-4">
      <div className="flex items-center gap-2">
        <span className="flex size-7 items-center justify-center rounded-md bg-destructive-subtle text-text-destructive">
          <Lock className="size-4" />
        </span>
        <h2 className="text-sm font-semibold text-foreground">Never in this report</h2>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">
        Customer personal data, reviewer names, internal notes and ticket comments, account-health labels, billing, and partner or pipeline
        data. The generator reads a whitelist and the export refuses to render a blocked field.
      </p>
    </Card>
  );
}

/** Small helper the review page uses for the "data through" footnote. */
export function dataThroughLine(snap: Snapshot): string | null {
  const entries = Object.entries(snap.dataThrough ?? {});
  if (!entries.length) return null;
  return entries.map(([k, v]) => `${snap.sections[k]?.title ?? k}: ${longDate(v)}`).join(" · ");
}
