"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  Check,
  Circle,
  Download,
  FileSpreadsheet,
  Globe,
  Loader2,
  Sparkles,
  Trash2,
  UploadCloud,
} from "lucide-react";
import {
  Badge,
  BadgeLink,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  Field,
  Input,
  SectionHead,
  Skeleton,
} from "@/components/ui";
import { cn } from "@/lib/utils/cn";

/**
 * "Clone a Website" — the two generators ported from the standalone Site
 * Builder tool (crawl-and-clone, and CSV-driven SEO pages), surfaced inside
 * the Website module so a merchant site can be started from an existing
 * site or a spreadsheet instead of the blank intake questionnaire.
 *
 * Real implementation: "Start cloning" / "Create pages from CSV" POST to
 * /api/clone and /api/seo (src/features/site-builder), which stream
 * newline-delimited JSON progress events (see clone-progress.ts's
 * CloneProgress type) while the site is crawled, converted and packaged.
 *
 * On the "done" event, the run is auto-saved into "My Clones" (POST
 * /api/clone/save/<id> — exempts the workspace from the 24h TTL so it stays
 * around) and appears in the list at the bottom of this panel: a card per
 * clone with "Visit" (opens the live preview at
 * /api/clone/preview/<id> — served straight from the stored workspace
 * files, no separate Next.js process, no local command needed), "Download
 * zip", "Edit" (opens the Studio visual editor at /web/website/studio/<id>
 * in a new tab — protected by the same session cookie as the rest of the
 * app, per src/middleware.ts), and "Remove".
 */

type CloneMethod = "url" | "csv";

type LogStep = {
  id: string;
  label: string;
  /** Progress phases (from CloneProgress["phase"]) that map to this step. */
  phases: string[];
};

const URL_LOG_STEPS: LogStep[] = [
  { id: "connect", label: "Connecting to the site", phases: ["launch"] },
  { id: "crawl", label: "Crawling same-domain pages", phases: ["load", "crawl"] },
  { id: "assets", label: "Downloading images & fonts", phases: ["assets"] },
  { id: "a11y", label: "Applying accessibility fixes & packaging", phases: ["zip"] },
  { id: "ready", label: "Ready to review", phases: ["done"] },
];

const CSV_LOG_STEPS: LogStep[] = [
  { id: "connect", label: "Connecting to the site", phases: ["launch"] },
  { id: "crawl", label: "Crawling same-domain pages", phases: ["load", "crawl"] },
  { id: "csv", label: "Downloading images & converting pages", phases: ["assets"] },
  { id: "pages", label: "Generating category, location & blog pages", phases: ["pages", "zip"] },
  { id: "ready", label: "Ready to review", phases: ["done"] },
];

const PSEO_LOG_STEPS: LogStep[] = [
  { id: "crawl", label: "Reading the workbook & crawling the site", phases: ["launch", "load", "crawl"] },
  { id: "assets", label: "Downloading images & converting pages", phases: ["assets"] },
  { id: "pages", label: "Building menu, location, combo & blog pages", phases: ["pages"] },
  { id: "save", label: "Breadcrumbs, schema, redirects & publish schedule", phases: ["zip"] },
  { id: "ready", label: "Ready to review", phases: ["done"] },
];

/** Mirrors src/features/site-builder/server/pseo/build.ts's PseoReport (fields the UI shows). */
type PseoReport = {
  business: string;
  total: number;
  byType: Record<string, number>;
  live: number;
  scheduled: number;
  hold: number;
  kept: number;
  generated: number;
  redirects: Array<{ from: string; to: string }>;
  held: Array<{ path: string; reasons: string[] }>;
  warnings: string[];
  orderUrl: string;
  cateringUrl: string;
};

const CSV_COLUMN_MAP = [
  { column: "URL / path", field: "url" },
  { column: "Title", field: "title" },
  { column: "Keyword", field: "keyword" },
  { column: "Location", field: "location" },
  { column: "Category", field: "category" },
];

/** Mirrors src/features/site-builder/server/clone-progress.ts's CloneProgress type. */
type CloneProgress = {
  phase: "launch" | "load" | "crawl" | "pages" | "assets" | "zip" | "done" | "error";
  percent: number;
  message: string;
  current?: number;
  total?: number;
  downloadId?: string;
  filename?: string;
  studioPath?: string;
  error?: string;
  /** pSEO runs only. */
  report?: PseoReport;
};

/** Mirrors src/features/site-builder/server/workspaces.ts's CloneSummary type. */
type CloneSummary = {
  id: string;
  filename: string;
  siteName: string;
  origin: string;
  kind: "clone" | "seo";
  createdAt: string;
  pageCount: number;
  savedAt: string;
};

export function CloneWebsitePanel() {
  const [method, setMethod] = useState<CloneMethod>("url");
  const clones = useMyClones();

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <SectionHead
          title="Clone a Website"
          description="Turn an existing site into an editable, ADA-compliant Innowi website — clone it from a live URL, or generate SEO pages in bulk from a spreadsheet."
        />

        {/* Sub-tabs: the two generators the clone engine exposes. Plain
            buttons rather than <Tabs>, which owns aria-controls/roving focus
            via a single content region — here the two forms need independent
            layouts (mono URL field vs. dropzone + column map), so each renders
            in its own branch below instead of a shared TabsContent. */}
        <div className="inline-flex gap-1 rounded-lg border border-border bg-muted p-1">
          <SubtabButton active={method === "url"} onClick={() => setMethod("url")} icon={Globe}>
            Clone from URL
          </SubtabButton>
          <SubtabButton active={method === "csv"} onClick={() => setMethod("csv")} icon={FileSpreadsheet}>
            SEO pages from XLSX
          </SubtabButton>
        </div>

        {method === "url" ? (
          <CloneFromUrl onSaved={clones.refresh} />
        ) : (
          <SeoFromCsv onSaved={clones.refresh} />
        )}
      </div>

      <MyClonesSection clones={clones} />
    </div>
  );
}

function SubtabButton({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Globe;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md px-3 text-sm font-medium transition-colors",
        active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="size-4" aria-hidden />
      {children}
    </button>
  );
}

/* ---------------------------------------------------------------- Clone from URL */

function CloneFromUrl({ onSaved }: { onSaved: () => void }) {
  const [url, setUrl] = useState("");
  const [saveImages, setSaveImages] = useState(true);
  const run = useCloneRun(URL_LOG_STEPS, onSaved);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:[&>*]:min-w-0">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Clone from URL</CardTitle>
        </CardHeader>
        <CardBody>
          <p className="mb-4 text-table text-muted-foreground">
            We&apos;ll load the full site, crawl every same-domain page, and package it as an editable Innowi
            website.
          </p>

          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              run.start("/api/clone", { url, downloadImages: saveImages });
            }}
          >
            <Field label="Website URL" required>
              <Input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com"
                className="font-mono"
                required
              />
            </Field>

            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={saveImages}
                onChange={(e) => setSaveImages(e.target.checked)}
                className="size-4 rounded border-border text-primary focus-visible:ring-4 focus-visible:ring-accent"
              />
              Save cloned images into the new site
            </label>

            <div className="border-t border-border pt-4">
              <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                What happens next
              </p>
              <ol className="flex flex-col gap-3">
                <NextStep index={1} title="Full page load">
                  Every same-domain page is visited and given time to finish loading (sliders, lazy images, dynamic
                  sections).
                </NextStep>
                <NextStep index={2} title="Convert to an Innowi site">
                  Pages, styles and assets are rewritten into an editable site, with accessibility fixes applied
                  automatically (alt text, labels, contrast, keyboard support).
                </NextStep>
                <NextStep index={3} title="Review & keep it">
                  Visit the live preview, download the project as a zip, or open it in the visual editor —
                  right from this page, no commands needed.
                </NextStep>
              </ol>
            </div>

            <Button type="submit" variant="default" className="w-full" loading={run.running} disabled={!url}>
              <Sparkles className="size-4" aria-hidden />
              Start cloning
            </Button>
          </form>
        </CardBody>
      </Card>

      <CloneProgressCard run={run} steps={URL_LOG_STEPS} siteLabel={hostnameOf(url)} />
    </div>
  );
}

/* ------------------------------------------------------------ SEO pages from XLSX */

/**
 * "SEO pages from XLSX": clone a site, then build its SEO pages from the
 * pSEO content-tree workbook (.xlsx → /api/pseo: every page in sheet 11 with
 * breadcrumbs, schema, redirects and the publishing schedule). A plain .csv
 * SEO plan still works and goes through the original /api/seo flow.
 */
function SeoFromCsv({ onSaved }: { onSaved: () => void }) {
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [saveImages, setSaveImages] = useState(true);
  const [readError, setReadError] = useState<string | null>(null);
  const isXlsx = !!file && /\.xlsx$/i.test(file.name);
  const steps = isXlsx ? PSEO_LOG_STEPS : CSV_LOG_STEPS;
  const run = useCloneRun(steps, onSaved);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileName = file?.name ?? null;

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setReadError(null);
    setFile(e.target.files?.[0] ?? null);
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:[&>*]:min-w-0">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">SEO pages from XLSX</CardTitle>
        </CardHeader>
        <CardBody>
          <p className="mb-4 text-table text-muted-foreground">
            Clone a site, then generate its menu, category, dish, location, combo, catering and blog pages from the
            SEO workbook.
          </p>

          <form
            className="flex flex-col gap-4"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!file) return;
              setReadError(null);
              try {
                if (isXlsx) {
                  const xlsxBase64 = await fileToBase64(file);
                  run.start("/api/pseo", { url, xlsxBase64, fileName: file.name, downloadImages: saveImages });
                } else {
                  const rows = parseCsvRows(await file.text());
                  run.start("/api/seo", { url, downloadImages: saveImages, rows });
                }
              } catch {
                setReadError("Couldn't read that file.");
              }
            }}
          >
            <Field label="Website URL to clone" required>
              <Input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com"
                className="font-mono"
                required
              />
            </Field>

            <Field label="SEO plan (.xlsx)" required>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                className="sr-only"
                onChange={onFileChange}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className={cn(
                  "flex w-full flex-col items-center gap-2 rounded-lg border border-dashed border-border bg-muted px-4 py-6 text-center transition-colors",
                  "hover:border-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent",
                )}
              >
                <UploadCloud className="size-5 text-muted-foreground" aria-hidden />
                <span className="text-sm text-foreground">
                  {fileName ?? "Drop an XLSX or click to upload"}
                </span>
              </button>
            </Field>

            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={saveImages}
                onChange={(e) => setSaveImages(e.target.checked)}
                className="size-4 rounded border-border text-primary focus-visible:ring-4 focus-visible:ring-accent"
              />
              Save cloned images into the new site
            </label>

            <div className="border-t border-border pt-4">
              <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Column map</p>
              <div className="flex flex-col gap-1.5">
                {CSV_COLUMN_MAP.map((row) => (
                  <div key={row.column} className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{row.column}</span>
                    {row.field ? (
                      <Badge tone="neutral" icon={false} className="font-mono">
                        {row.field}
                      </Badge>
                    ) : (
                      <Badge tone="neutral" icon={false} className="text-muted-foreground">
                        — none —
                      </Badge>
                    )}
                  </div>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Columns are matched automatically by header name (url/path, title, keyword, location, category,
                content, slug); no manual mapping step is needed. In the workbook, sheet 11 lists the pages and sheets
                02–07 supply their titles, keywords, locations and categories.
              </p>
            </div>

            {readError ? <p className="text-sm text-text-destructive">{readError}</p> : null}

            <Button type="submit" variant="default" className="w-full" loading={run.running} disabled={!url || !file}>
              <Sparkles className="size-4" aria-hidden />
              Create pages from XLSX
            </Button>
          </form>
        </CardBody>
      </Card>

      {fileName ? (
        <div className="flex flex-col gap-4">
          <CloneProgressCard run={run} steps={steps} siteLabel={hostnameOf(url) || fileName} />
          {run.report ? <PseoReportCard report={run.report} /> : null}
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Preview</CardTitle>
          </CardHeader>
          <CardBody>
            <p className="text-table text-muted-foreground">
              Upload the XLSX workbook to see progress and the pages it generates.
            </p>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ XLSX helpers */

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function PseoReportCard({ report }: { report: PseoReport }) {
  const [showHeld, setShowHeld] = useState(false);
  const stat = (label: string, value: number) => (
    <div className="rounded-lg border border-border px-3 py-2">
      <p className="text-lg font-semibold text-foreground">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">pSEO report — {report.business}</CardTitle>
      </CardHeader>
      <CardBody>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {stat("pages in workbook", report.total)}
          {stat("live now", report.live)}
          {stat("scheduled", report.scheduled)}
          {stat("on hold", report.hold)}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          {report.generated} generated · {report.kept} kept from the live site · {report.redirects.length} redirects ·{" "}
          {Object.entries(report.byType)
            .map(([k, v]) => `${v} ${k}`)
            .join(", ")}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Order button: {report.orderUrl || "no ordering link found"}
          {report.cateringUrl ? ` · Catering: ${report.cateringUrl}` : ""}
        </p>
        {report.warnings.length ? (
          <ul className="mt-3 flex list-disc flex-col gap-1 pl-5 text-xs text-foreground">
            {report.warnings.slice(0, 6).map((w) => (
              <li key={w}>{w}</li>
            ))}
            {report.warnings.length > 6 ? <li>…and {report.warnings.length - 6} more (see PSEO_REPORT.md in the zip).</li> : null}
          </ul>
        ) : null}
        {report.held.length ? (
          <div className="mt-3">
            <Button variant="secondary" size="sm" onClick={() => setShowHeld((v) => !v)}>
              {showHeld ? "Hide" : "Show"} pages on hold
            </Button>
            {showHeld ? (
              <ul className="mt-2 flex max-h-64 flex-col gap-1 overflow-auto text-xs">
                {report.held.map((h) => (
                  <li key={h.path}>
                    <code>{h.path}</code> — <span className="text-muted-foreground">{h.reasons.join(" ")}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
        <p className="mt-3 text-xs text-muted-foreground">
          Publish held pages from the site&apos;s /admin dashboard (Publish now / Publish all shown) once they have
          enough unique copy.
        </p>
      </CardBody>
    </Card>
  );
}

/* -------------------------------------------------------------------- shared bits */

function NextStep({ index, title, children }: { index: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary-subtle text-xs font-semibold text-primary-subtle-foreground">
        {index}
      </span>
      <div>
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground">{children}</p>
      </div>
    </li>
  );
}

/** Minimal RFC 4180 CSV parser (mirrors the server's parseCsv in csv-pages.ts). */
function parseCsvRows(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i += 1;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  const nonEmpty = rows.filter((r) => r.some((cell) => cell.trim() !== ""));
  if (nonEmpty.length < 2) return [];
  const headers = nonEmpty[0].map((h, index) => h.trim() || `column_${index + 1}`);
  return nonEmpty.slice(1).map((cells) => {
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      record[header] = (cells[index] ?? "").trim();
    });
    return record;
  });
}

/**
 * Runs a clone/SEO job against the real API: POSTs to `path`, then reads the
 * response body as a stream of newline-delimited JSON CloneProgress events
 * (see src/features/site-builder/server/clone-progress.ts) and updates
 * running state as they arrive. On "done", auto-saves the run into "My
 * Clones" (POST /api/clone/save/<id>) so it survives the 24h workspace TTL
 * and shows up in the list below without the user having to do anything.
 */
function useCloneRun(steps: LogStep[], onSaved: () => void) {
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [pct, setPct] = useState(0);
  const [message, setMessage] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const [downloadId, setDownloadId] = useState<string | null>(null);
  const [filename, setFilename] = useState<string | null>(null);
  const [report, setReport] = useState<PseoReport | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const stepIndexForPhase = (phase: string) => {
    const idx = steps.findIndex((step) => step.phases.includes(phase));
    return idx === -1 ? 0 : idx;
  };

  const start = useCallback(
    async (path: string, body: Record<string, unknown>) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setRunning(true);
      setDone(false);
      setFailed(null);
      setPct(0);
      setMessage("");
      setActiveIndex(0);
      setDownloadId(null);
      setFilename(null);
      setReport(null);

      try {
        const res = await fetch(path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          const data = await res.json().catch(() => null);
          throw new Error((data && (data.error as string)) || `Request failed (${res.status}).`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { value, done: streamDone } = await reader.read();
          if (streamDone) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            let event: CloneProgress;
            try {
              event = JSON.parse(trimmed) as CloneProgress;
            } catch {
              continue;
            }
            await applyEvent(event);
          }
        }
        const trailing = buffer.trim();
        if (trailing) {
          try {
            await applyEvent(JSON.parse(trailing) as CloneProgress);
          } catch {
            /* ignore trailing partial line */
          }
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        setRunning(false);
        setFailed(error instanceof Error ? error.message : "Request failed.");
      }

      async function applyEvent(event: CloneProgress) {
        setPct(event.percent);
        setMessage(event.message);
        setActiveIndex(stepIndexForPhase(event.phase));
        if (event.phase === "done") {
          setRunning(false);
          setDone(true);
          setDownloadId(event.downloadId ?? null);
          setFilename(event.filename ?? null);
          setReport(event.report ?? null);
          if (event.downloadId) {
            // Best-effort: keep this run around past the 24h workspace TTL
            // and surface it in "My Clones". A failure here just means the
            // zip download still works but the run won't appear in the
            // list — not worth failing the whole job over.
            try {
              await fetch(`/api/clone/save/${encodeURIComponent(event.downloadId)}`, { method: "POST" });
              onSaved();
            } catch {
              /* non-fatal */
            }
          }
        } else if (event.phase === "error") {
          setRunning(false);
          setFailed(event.error || event.message || "Something went wrong.");
        }
      }
    },
    [steps, onSaved],
  );

  const reset = () => {
    abortRef.current?.abort();
    setRunning(false);
    setDone(false);
    setFailed(null);
    setPct(0);
    setMessage("");
    setActiveIndex(-1);
    setDownloadId(null);
    setFilename(null);
    setReport(null);
  };

  return { running, done, failed, pct, message, activeIndex, downloadId, filename, report, start, reset };
}

function CloneProgressCard({
  run,
  steps,
  siteLabel,
}: {
  run: ReturnType<typeof useCloneRun>;
  steps: LogStep[];
  siteLabel: string;
}) {
  const { running, done, failed, pct, message, activeIndex, downloadId, filename } = run;
  const idle = !running && !done && !failed;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Progress</CardTitle>
      </CardHeader>
      <CardBody>
        {idle ? (
          <div className="flex h-full min-h-[280px] flex-col items-center justify-center gap-2 text-center">
            <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Globe className="size-5" aria-hidden />
            </span>
            <p className="text-sm text-muted-foreground">Progress appears here once you start.</p>
          </div>
        ) : failed ? (
          <div className="flex h-full min-h-[280px] flex-col items-center justify-center gap-3 text-center">
            <span className="flex size-10 items-center justify-center rounded-full bg-destructive-subtle text-text-destructive">
              <Circle className="size-5" aria-hidden />
            </span>
            <p className="max-w-sm text-sm text-foreground">{failed}</p>
            <Button variant="secondary" size="sm" onClick={run.reset}>
              Try again
            </Button>
          </div>
        ) : (
          <>
            <p className="mb-4 text-table text-muted-foreground">Cloning can take a few minutes for larger sites.</p>

            <div className="mb-5 flex flex-col items-center gap-3">
              <ProgressRing pct={pct} />
              <p
                className="w-full max-w-full truncate text-center text-sm text-foreground"
                title={done ? undefined : message || undefined}
              >
                {done
                  ? "Ready — review your cloned site."
                  : truncateMiddle(message, 64) || `Loading ${siteLabel || "the site"}…`}
              </p>
            </div>

            <ul className="flex flex-col gap-2.5">
              {steps.map((step, i) => {
                const isDone = done || i < activeIndex;
                const isActive = !done && i === activeIndex;
                return (
                  <li key={step.id} className="flex items-center gap-2 text-sm">
                    {isDone ? (
                      <Check className="size-4 shrink-0 text-success" aria-hidden />
                    ) : isActive ? (
                      <Loader2 className="size-4 shrink-0 animate-spin text-primary" aria-hidden />
                    ) : (
                      <Circle className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    )}
                    <span className={isDone || isActive ? "text-foreground" : "text-muted-foreground"}>
                      {step.label}
                    </span>
                  </li>
                );
              })}
            </ul>

            {done && (
              <div className="mt-5 flex flex-col gap-3 rounded-lg border border-success-border bg-success-subtle p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-2.5">
                  <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                  <div>
                    <p className="text-sm font-medium text-success-subtle-foreground">
                      {siteLabel || "Site"} cloned successfully
                    </p>
                    <p className="text-xs text-success-subtle-foreground/80">
                      Accessibility fixes applied · saved to My Clones below.
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {/* DS "Open link" badge (node 2122:2443) — same "visit the
                      site" control as the My Websites table's "Visit site"
                      action, so the two lists share one visual pattern. */}
                  {downloadId ? (
                    <BadgeLink href={`/api/clone/preview/${encodeURIComponent(downloadId)}`}>Visit</BadgeLink>
                  ) : (
                    <Badge tone="neutral" icon={false} className="opacity-60">
                      Visit
                      <ArrowUpRight aria-hidden />
                    </Badge>
                  )}
                  {downloadId ? (
                    <a
                      href={`/web/website/studio/${encodeURIComponent(downloadId)}`}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      <Button variant="secondary" size="sm">
                        Open in editor
                      </Button>
                    </a>
                  ) : (
                    <Button variant="secondary" size="sm" disabled>
                      Open in editor
                    </Button>
                  )}
                  <Button
                    variant="default"
                    size="sm"
                    disabled={!downloadId}
                    onClick={() => {
                      if (!downloadId) return;
                      window.location.href = `/api/clone/download?id=${encodeURIComponent(downloadId)}`;
                    }}
                  >
                    Download zip
                    <Download className="size-4" aria-hidden />
                  </Button>
                </div>
              </div>
            )}
            {done && !downloadId && (
              <p className="mt-2 text-xs text-muted-foreground">{filename ? `${filename} — ` : ""}download link unavailable.</p>
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
}

function ProgressRing({ pct }: { pct: number }) {
  const r = 52;
  const circumference = 2 * Math.PI * r;
  const offset = circumference - (pct / 100) * circumference;

  return (
    <div className="relative size-[120px]">
      <svg viewBox="0 0 120 120" className="size-full -rotate-90">
        <circle cx="60" cy="60" r={r} className="fill-none stroke-muted" strokeWidth="10" />
        <circle
          cx="60"
          cy="60"
          r={r}
          className="fill-none stroke-primary transition-[stroke-dashoffset] duration-200"
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-2xl font-semibold text-foreground">
        {pct}
        <span className="text-base text-muted-foreground">%</span>
      </div>
    </div>
  );
}

/**
 * Some progress messages are a single long unbroken token (a redirected
 * tracking/ad-verification URL some sites load, with no spaces to wrap on —
 * see e.g. validate.perfdrive.com below). Rather than let it wrap across a
 * dozen lines, show the start, an ellipsis, and the end so it stays
 * readable and the card stays a fixed height; the full message is still
 * available via the `title` tooltip.
 */
function truncateMiddle(text: string, max: number): string {
  if (!text || text.length <= max) return text;
  const headLen = Math.ceil((max - 1) * 0.6);
  const tailLen = max - 1 - headLen;
  return `${text.slice(0, headLen)}…${text.slice(text.length - tailLen)}`;
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url.trim();
  }
}

/* --------------------------------------------------------------------- My Clones */

/** Fetches and holds the "My Clones" list (GET /api/clone/list). */
function useMyClones() {
  const [data, setData] = useState<CloneSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/clone/list", { cache: "no-store" });
      if (!res.ok) throw new Error(`Failed to load (${res.status}).`);
      const body = (await res.json()) as { data: CloneSummary[] };
      setData(body.data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load your clones.");
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { data, error, refresh };
}

/**
 * The "already cloned" list at the bottom of the panel — a card per saved
 * clone/SEO run, with Visit (live preview, no local command needed),
 * Download zip, and Remove. Backed by GET /api/clone/list.
 */
function MyClonesSection({ clones }: { clones: ReturnType<typeof useMyClones> }) {
  const { data, error, refresh } = clones;
  const [removingId, setRemovingId] = useState<string | null>(null);

  const remove = async (id: string) => {
    setRemovingId(id);
    try {
      await fetch(`/api/clone/save/${encodeURIComponent(id)}`, { method: "DELETE" });
      await refresh();
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <SectionHead
        title="My Clones"
        description="Sites already cloned or generated — visit them live, download the project, or edit them in the visual editor."
      />

      {error ? (
        <Card>
          <CardBody>
            <p className="text-sm text-text-destructive">{error}</p>
          </CardBody>
        </Card>
      ) : data === null ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <CardBody>
                <Skeleton className="h-4 w-32" />
                <Skeleton className="mt-2 h-3 w-48" />
                <Skeleton className="mt-4 h-7 w-full" />
              </CardBody>
            </Card>
          ))}
        </div>
      ) : data.length === 0 ? (
        <Card>
          <EmptyState
            icon={Globe}
            title="No clones yet"
            description="Clone a site or generate SEO pages above — finished runs show up here automatically."
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {data.map((clone) => (
            <CloneCard key={clone.id} clone={clone} busy={removingId === clone.id} onRemove={() => remove(clone.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function CloneCard({
  clone,
  busy,
  onRemove,
}: {
  clone: CloneSummary;
  busy: boolean;
  onRemove: () => void;
}) {
  return (
    <Card>
      <CardBody className="flex flex-col gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-sm font-medium text-foreground" title={clone.siteName}>
              {clone.siteName}
            </p>
            <Badge tone="neutral" icon={false} className="shrink-0">
              {clone.kind === "seo" ? "SEO" : "Clone"}
            </Badge>
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground" title={clone.origin}>
            {clone.origin}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {clone.pageCount} {clone.pageCount === 1 ? "page" : "pages"} · saved {formatSavedAt(clone.savedAt)}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* DS "Open link" badge (node 2122:2443) — matches the My Websites
              table's "Visit site" action. */}
          <BadgeLink href={`/api/clone/preview/${encodeURIComponent(clone.id)}`}>Visit</BadgeLink>
          <a href={`/web/website/studio/${encodeURIComponent(clone.id)}`} target="_blank" rel="noreferrer noopener">
            <Button variant="secondary" size="sm">
              Edit
            </Button>
          </a>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Download ${clone.siteName} as a zip`}
            title="Download zip"
            onClick={() => {
              window.location.href = `/api/clone/download?id=${encodeURIComponent(clone.id)}`;
            }}
          >
            <Download className="size-4" aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Remove ${clone.siteName}`}
            title="Remove from My Clones"
            className="text-muted-foreground hover:text-text-destructive"
            loading={busy}
            onClick={onRemove}
          >
            <Trash2 className="size-4" aria-hidden />
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

function formatSavedAt(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return iso;
  }
}
