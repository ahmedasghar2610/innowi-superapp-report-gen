"use client";

import { Download, Lock, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import { exportUrl } from "../api";
import { dateTime, historyLine, longDate } from "../format";
import { BTN, ICON_DOWN } from "./sidebar-fx";
import type { Report, Snapshot } from "../types";

/**
 * Panels used by the review page's sidebar toolkit (see report-sidebar.tsx):
 * report details, the client-view switch, the export links and the privacy
 * note. The sidebar decides which tab each one appears in.
 *
 * None of these render their own Card any more — every tab's panel lives
 * inside the sidebar's single card, so they return bare sections.
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
      <div className="flex flex-col gap-1.5">
        <div className="flex gap-2">
          <Button variant="outline" disabled className="flex-1">
            <Download /> PDF
          </Button>
          <Button variant="outline" disabled className="flex-1">
            <Download /> DOCX
          </Button>
        </div>
        <p className="text-xs leading-5 text-muted-foreground">A file is made from the approved snapshot, so approve the report first.</p>
      </div>
    );
  }
  return (
    <div className="flex gap-2">
      {(["pdf", "docx"] as const).map((kind) => (
        // <a> wrapping <Button>, the pattern the queue page already uses for Link.
        <a key={kind} href={exportUrl(r.id, kind)} download className="flex-1" data-testid={`report-export-${kind}`}>
          <Button variant="outline" className={cn("w-full", BTN, ICON_DOWN)}>
            <Download /> {kind.toUpperCase()}
          </Button>
        </a>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------- details ---- */
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
    <section className="flex flex-col gap-3.5">
      <h2 className="text-sm font-semibold text-foreground">Report details</h2>
      <dl className="flex flex-col text-xs">
        {rows.map(([k, v]) => (
          <div
            key={k}
            className="flex justify-between gap-3 rounded-md border-b border-border px-2 py-2 transition-colors last:border-0 hover:bg-muted/60"
          >
            <dt className="shrink-0 text-muted-foreground">{k}</dt>
            <dd className="min-w-0 text-right font-medium text-foreground [overflow-wrap:anywhere]">{v}</dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold text-foreground">Included services</span>
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
          Only subscribed services appear in the report. Crossed-out items are not part of this package.
        </p>
        {snap.services.length > 0 && <p className="text-xs text-muted-foreground">Contracted: {snap.services.join(" · ")}</p>}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------- preview ---- */
export function PreviewOptions({ merchantView, onChange }: { merchantView: boolean; onChange: (v: boolean) => void }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold text-foreground">Preview</h2>
      <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground transition-colors hover:bg-muted/60">
        <input type="checkbox" className="size-4" checked={merchantView} onChange={(e) => onChange(e.target.checked)} data-testid="report-merchant-view" />
        Client view
      </label>
      <p className="text-xs leading-5 text-muted-foreground">Hides internal reference codes. Estimate labels always stay visible.</p>
    </section>
  );
}

/* -------------------------------------------------------------- frozen ---- */
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

/* --------------------------------------------------------- privacy note --- */
export function PrivacyProtection() {
  return (
    <section className="flex flex-col gap-2 border-t border-border pt-3.5">
      <div className="flex items-center gap-2">
        <span className="flex size-7 items-center justify-center rounded-md bg-destructive-subtle text-text-destructive">
          <Lock className="size-4" />
        </span>
        <h2 className="text-sm font-semibold text-foreground">Privacy protection</h2>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">
        Personal data, internal notes, billing and pipeline data are excluded automatically.
      </p>
    </section>
  );
}

/** Small helper the review page uses for the "data through" footnote. */
export function dataThroughLine(snap: Snapshot): string | null {
  const entries = Object.entries(snap.dataThrough ?? {});
  if (!entries.length) return null;
  return entries.map(([k, v]) => `${snap.sections[k]?.title ?? k}: ${longDate(v)}`).join(" · ");
}
