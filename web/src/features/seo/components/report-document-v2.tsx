"use client";

import { useEffect, useState } from "react";
import { PenLine, ShieldAlert } from "lucide-react";
import { Button, Textarea, useToast } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import { useUpdateSummary } from "../api";
import { fmtNum } from "../lib";
import type { Report, ReportNoteKey, ReportV2 } from "../types";
import { BrandedClicks, ClicksVsImpressions, DevicePanels } from "./report-charts";
import { CrawlSection, DocHeadingStyle, NextSteps } from "./report-document";

/**
 * Monthly client report in the SEO team's format (Zainab's September 2026 reports):
 * alert · executive summary · key metrics + 4-month table · branded vs non-branded ·
 * highlighted finding · top queries · pages · devices · countries · technical check ·
 * recommendations · sources. Built by report_v2.py; the summary, the paragraph under each
 * table and the recommendations are editable until sign-off.
 */
export function ReportDocumentV2({
  r,
  canEdit,
}: {
  r: Report;
  canEdit: boolean;
}) {
  const s = r.snapshot;
  const v = s.v2 as ReportV2;
  const editable = canEdit && r.status === "awaiting_signoff";
  const cur = v.keyMetrics.cur;
  const prev = v.keyMetrics.prev;
  const cm = v.monthLabel.split(" ")[0];
  const pm = v.prevMonthLabel.split(" ")[0];
  const note = (section: ReportNoteKey, fallback?: string[]) => (
    <Note r={r} v={v} section={section} editable={editable} fallback={fallback} />
  );

  return (
    <article className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-card shadow-sm print:overflow-visible print:rounded-none print:border-0 print:shadow-none">
      <header className="bg-slate-900 px-7 py-5 text-white print:bg-slate-900">
        <div className="flex items-center gap-2 text-[11px] font-bold tracking-[0.14em] text-slate-400">
          <span className="size-2 rounded-full bg-orange-500" aria-hidden />
          SEO PERFORMANCE REPORT
        </div>
        <h2 className="mt-1.5 text-xl font-semibold">
          {s.site.name} — {s.site.domain}
        </h2>
        <p className="mt-1 text-xs text-slate-300">
          Reporting month: {v.monthLabel} (compared with {v.prevMonthLabel}) ·
          Prepared by Innowi SEO Department
        </p>
      </header>

      <DocHeadingStyle.Provider value="plain">
        <div className="flex flex-col px-7 pb-4">
          {v.alert && (
            <div className="mt-5 flex gap-3 rounded-lg border-2 border-destructive bg-destructive-subtle p-4">
              <ShieldAlert className="mt-0.5 size-5 shrink-0 text-text-destructive" />
              <div>
                <div className="text-sm font-bold text-text-destructive">
                  {v.alert.title}
                </div>
                <p className="mt-1 text-sm leading-6 text-foreground">
                  {v.alert.text}
                </p>
              </div>
            </div>
          )}

          <Summary r={r} v={v} editable={editable} />

          {cur && (
            <Sec title={`Key Metrics — ${v.monthLabel}`}>
              <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4 print:grid-cols-4">
                <Tile
                  label={`${cm} clicks`}
                  value={fmtNum(cur.clicks)}
                  sub={chg(cur.clicks, prev?.clicks, pm)}
                />
                <Tile
                  label={`${cm} impressions`}
                  value={fmtNum(cur.impressions)}
                  sub={chg(cur.impressions, prev?.impressions, pm)}
                />
                <Tile
                  label="Avg. CTR"
                  value={pct(cur.ctr)}
                  sub={prev ? `vs ${pct(prev.ctr)} in ${pm}` : ""}
                />
                <Tile
                  label="Avg. position"
                  value={cur.position?.toFixed(2) ?? "—"}
                  sub={
                    prev?.position != null && cur.position != null
                      ? `${cur.position < prev.position ? "improved" : "vs"} ${prev.position.toFixed(2)} in ${pm}`
                      : ""
                  }
                />
              </div>
              {v.months.length > 1 && (
                <>
                  <Table
                    head={[
                      "Month",
                      "Clicks",
                      "Impressions",
                      "Avg. CTR",
                      "Avg. position",
                      "MoM clicks",
                    ]}
                    right={[1, 2, 3, 4, 5]}
                    rows={v.months.map((m) => [
                      m.label,
                      fmtNum(m.clicks),
                      fmtNum(m.impressions),
                      pct(m.ctr),
                      m.position?.toFixed(2) ?? "—",
                      m.clicksChange == null ? "—" : signed(m.clicksChange),
                    ])}
                  />
                  <ClicksVsImpressions
                    title={`Clicks vs. Impressions — ${v.months[0].label.split(" ")[0]} to ${v.monthLabel}`}
                    months={v.months.map((m) => ({ label: m.label.split(" ")[0].slice(0, 3) + " " + m.label.split(" ")[1], clicks: m.clicks, impressions: m.impressions }))}
                  />
                </>
              )}
              {note("metrics")}
            </Sec>
          )}

          {v.brand && v.brand.trackedClicks > 0 && (
            <Sec title="Branded vs. Non-Branded Search">

              <Table
                head={[
                  "",
                  `${pm} clicks`,
                  `${cm} clicks`,
                  `${cm} impressions`,
                  "CTR",
                  "Share of clicks",
                ]}
                right={[1, 2, 3, 4, 5]}
                rows={(["branded", "generic"] as const).map((k) => [
                  k === "branded" ? "Branded" : "Non-branded",
                  v.brandPrev ? fmtNum(v.brandPrev[k].clicks) : "—",
                  fmtNum(v.brand![k].clicks),
                  fmtNum(v.brand![k].impressions),
                  pct(v.brand![k].ctr),
                  v.brand!.brandedShare == null
                    ? "—"
                    : pct(
                        k === "branded"
                          ? v.brand!.brandedShare
                          : 1 - v.brand!.brandedShare,
                        0,
                      ),
                ])}
              />
              <BrandedClicks
                groups={[
                  ...(v.brandPrev ? [{ label: v.prevMonthLabel, values: [v.brandPrev.branded.clicks, v.brandPrev.generic.clicks] as [number, number] }] : []),
                  { label: v.monthLabel, values: [v.brand.branded.clicks, v.brand.generic.clicks] as [number, number] },
                ]}
              />
              {note("brand")}
            </Sec>
          )}

          {v.highlight && (
            <Sec
              title={v.highlight.title}
              tone={v.highlight.kind === "security" ? "danger" : undefined}
            >
              {note("highlight", [v.highlight.text])}
              {v.highlight.rows && (
                <Table
                  head={[
                    "Page",
                    `${pm} impr.`,
                    `${cm} impr.`,
                    "Position",
                    "Status",
                  ]}
                  right={[1, 2, 3]}
                  rows={v.highlight.rows.map((x) => [
                    x.path,
                    fmtNum(x.prevImpressions),
                    fmtNum(x.impressions),
                    x.position?.toFixed(2) ?? "—",
                    x.status,
                  ])}
                />
              )}
              {v.highlight.queries && (
                <Table
                  head={["Search", "Impressions", "Clicks", "Position"]}
                  right={[1, 2, 3]}
                  rows={v.highlight.queries.map((q) => [
                    q.query,
                    fmtNum(q.impressions),
                    fmtNum(q.clicks),
                    q.position?.toFixed(2) ?? "—",
                  ])}
                />
              )}
            </Sec>
          )}

          {v.progress && (
            <Sec title={v.progress.title}>
              {note("progress", [v.progress.note])}
              <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm leading-6 text-foreground">
                {v.progress.items.map((it, i) => (
                  <li key={i}>
                    {it.text}
                    {it.evidence && (
                      <div className="text-xs text-muted-foreground">
                        {it.evidence}
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            </Sec>
          )}

          {v.queries.length > 0 && (
            <Sec title={`Top Performing Queries — ${v.monthLabel}`}>
              <Table
                head={[
                  "Search",
                  `${pm} clicks`,
                  `${cm} clicks`,
                  `${cm} impr.`,
                  `${cm} CTR`,
                  `${pm} pos.`,
                  `${cm} pos.`,
                ]}
                right={[1, 2, 3, 4, 5, 6]}
                rows={v.queries.map((q) => [
                  q.query,
                  q.prevClicks == null ? "—" : fmtNum(q.prevClicks),
                  <b key="c">{fmtNum(q.clicks)}</b>,
                  fmtNum(q.impressions),
                  pct(q.ctr),
                  q.prevPosition?.toFixed(2) ?? "—",
                  q.position?.toFixed(2) ?? "—",
                ])}
              />
              {note("queries")}
            </Sec>
          )}

          {v.pages.length > 0 && (
            <Sec title="Page-Level Performance">
              <Table
                head={[
                  "Page",
                  `${pm} clicks`,
                  `${cm} clicks`,
                  `${pm} impr.`,
                  `${cm} impr.`,
                  `${cm} position`,
                ]}
                right={[1, 2, 3, 4, 5]}
                rows={v.pages.map((p) => [
                  <span key="p" className="break-all font-mono text-xs print:text-[9.5px]">
                    {p.path}
                    {p.spam && (
                      <b className="ml-1 font-sans text-text-destructive">
                        (SPAM)
                      </b>
                    )}
                  </span>,
                  p.prevClicks == null ? "—" : fmtNum(p.prevClicks),
                  <b key="c">{fmtNum(p.clicks)}</b>,
                  p.prevImpressions == null ? "—" : fmtNum(p.prevImpressions),
                  fmtNum(p.impressions),
                  p.position?.toFixed(2) ?? "—",
                ])}
              />
              {note("pages")}
            </Sec>
          )}

          {v.devices.length > 0 && (
            <Sec title="Device Breakdown">
              <Table
                head={[
                  "Device",
                  `${pm} clicks`,
                  `${cm} clicks`,
                  `${pm} impr.`,
                  `${cm} impr.`,
                  `${cm} CTR`,
                  `${pm} pos.`,
                  `${cm} pos.`,
                ]}
                right={[1, 2, 3, 4, 5, 6, 7]}
                rows={v.devices.map((d) => [
                  d.device,
                  d.prevClicks == null ? "—" : fmtNum(d.prevClicks),
                  <b key="c">{fmtNum(d.clicks)}</b>,
                  d.prevImpressions == null ? "—" : fmtNum(d.prevImpressions),
                  fmtNum(d.impressions),
                  pct(d.ctr),
                  d.prevPosition?.toFixed(2) ?? "—",
                  d.position?.toFixed(2) ?? "—",
                ])}
              />
              <DeviceCharts v={v} pm={pm} cm={cm} />
              {note("devices")}
            </Sec>
          )}

          {v.countries && (
            <Sec title="Geographic Distribution">
              <Table
                head={["Country", `${cm} clicks`, `${cm} impressions`]}
                right={[1, 2]}
                rows={v.countries.top.map((c) => [
                  c.country,
                  fmtNum(c.clicks),
                  fmtNum(c.impressions),
                ])}
              />
              {note("geo", v.notes ? undefined : [
                `${fmtNum(v.countries.homeClicks)} of ${fmtNum(v.countries.totalClicks)} clicks (${pct(v.countries.homeShare, 0)}) came from ${v.countries.home}.`,
              ])}
            </Sec>
          )}

          {s.crawl && (
            <div className="flex flex-col border-b border-border/70 pb-5 [&>section]:border-b-0 [&>section]:pb-3">
              <CrawlSection c={s.crawl} title="Full-Site Technical Check" />

              {note("crawl")}
            </div>
          )}

          <NextSteps r={r} canEdit={editable} title="Recommendations" />

          <p className="border-t border-border/70 pt-4 text-[11px] leading-5 text-muted-foreground print:break-after-avoid">
            <b>Sources:</b> {v.sources}. {v.dataNotes.join(" ")}
          </p>
        </div>
      </DocHeadingStyle.Provider>
      <footer className="border-t border-border bg-muted/40 px-7 py-3 text-xs text-muted-foreground print:break-before-avoid print:break-inside-avoid">
        {r.signedBy ? (
          <>
            <b className="text-foreground">{r.signedBy.name}</b> — digitally
            signed {r.signedAt?.slice(0, 10)}
          </>
        ) : (
          "Prepared by Innowi SEO Department — awaiting sign-off"
        )}{" "}
        · © Innowi Inc.
      </footer>
    </article>
  );
}

/* ------------------------------------------------------------------ parts ---- */

function Summary({
  r,
  v,
  editable,
}: {
  r: Report;
  v: ReportV2;
  editable: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(v.summary.join("\n\n"));
  const save = useUpdateSummary();
  const { toast } = useToast();
  useEffect(() => setDraft(v.summary.join("\n\n")), [v.summary]);
  return (
    <Sec
      title="Executive Summary"
      aside={
        editable && !editing ? (
          <Button
            size="sm"
            variant="ghost"
            className="print:hidden"
            onClick={() => setEditing(true)}
          >
            <PenLine className="size-4" />
            Edit
          </Button>
        ) : v.summaryEdited ? (
          <span className="text-[11px] text-muted-foreground print:hidden">
            Edited by the analyst
          </span>
        ) : (
          <span className="text-[11px] text-muted-foreground print:hidden">
            Written from this month&apos;s data
          </span>
        )
      }
    >
      {editing ? (
        <div className="flex flex-col gap-2 print:hidden">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={10}
            className="text-sm leading-6"
          />
          <p className="text-xs text-muted-foreground">
            Leave a blank line between paragraphs.
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              loading={save.isPending}
              onClick={() =>
                save.mutate(
                  { id: r.id, paragraphs: draft.split(/\n\s*\n/) },
                  {
                    onSuccess: () => {
                      setEditing(false);
                      toast({ variant: "success", title: "Summary saved" });
                    },
                    onError: (e) =>
                      toast({
                        variant: "error",
                        title: "Couldn't save",
                        description: e.messages?.[0] ?? e.message,
                      }),
                  },
                )
              }
            >
              Save
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => (
                setDraft(v.summary.join("\n\n")),
                setEditing(false)
              )}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        v.summary.map((p, i) => (
          <p key={i} className="text-sm leading-7 text-foreground">
            {p}
          </p>
        ))
      )}
    </Sec>
  );
}

/**
 * The paragraph under a table — written from this month's data (report_v2.py note_*) and, like the
 * executive summary, rewritable by the analyst until sign-off. Saving an empty box hides it.
 */
function Note({
  r,
  v,
  section,
  editable,
  fallback,
}: {
  r: Report;
  v: ReportV2;
  section: ReportNoteKey;
  editable: boolean;
  fallback?: string[];
}) {
  const paras =
    v.notes && section in v.notes ? (v.notes[section] ?? []) : (fallback ?? []);
  const text = paras.join("\n\n");
  const edited = v.notesEdited?.includes(section);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const save = useUpdateSummary();
  const { toast } = useToast();
  useEffect(() => setDraft(text), [text]);
  const canEdit = editable && !!v.notes;
  if (!paras.length && !canEdit) return null;

  if (editing)
    return (
      <div className="flex flex-col gap-2 print:hidden">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={5}
          className="text-sm leading-6"
        />
        <p className="text-xs text-muted-foreground">
          Leave a blank line between paragraphs. Save an empty box to leave this
          paragraph out of the report.
        </p>
        <div className="flex gap-2">
          <Button
            size="sm"
            loading={save.isPending}
            onClick={() =>
              save.mutate(
                { id: r.id, paragraphs: draft.split(/\n\s*\n/), section },
                {
                  onSuccess: () => {
                    setEditing(false);
                    toast({ variant: "success", title: "Paragraph saved" });
                  },
                  onError: (e) =>
                    toast({
                      variant: "error",
                      title: "Couldn't save",
                      description: e.messages?.[0] ?? e.message,
                    }),
                },
              )
            }
          >
            Save
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => (setDraft(text), setEditing(false))}
          >
            Cancel
          </Button>
        </div>
      </div>
    );

  return (
    <div className="group relative flex flex-col gap-2">
      {paras.length ? (
        paras.map((p, i) => (
          <p key={i} className="text-sm leading-6 text-foreground/90">
            {p}
          </p>
        ))
      ) : (
        <p className="text-xs italic text-muted-foreground print:hidden">
          No paragraph under this table.
        </p>
      )}
      {canEdit && (
        <div className="flex items-center gap-2 print:hidden">
          <Button
            size="sm"
            variant="ghost"
            className="-ml-2 h-7 px-2 text-xs text-muted-foreground"
            onClick={() => setEditing(true)}
          >
            <PenLine className="size-3.5" />
            {paras.length ? "Edit paragraph" : "Add paragraph"}
          </Button>
          <span className="text-[11px] text-muted-foreground">
            {edited ? "Edited by the analyst" : "Written from this month's data"}
          </span>
        </div>
      )}
    </div>
  );
}

function Sec({
  title,
  aside,
  tone,
  children,
}: {
  title: string;
  aside?: React.ReactNode;
  tone?: "danger";
  children: React.ReactNode;
}) {
  return (
    // In print a long section may run onto the next page (no half-empty pages); its heading stays with it.
    <section className="flex flex-col gap-3 border-b border-border/70 py-5 last:border-b-0 print:break-inside-auto print:py-4">
      <div className="flex items-center gap-3 print:break-after-avoid">
        <h3
          className={cn(
            "text-base font-bold text-foreground",
            tone === "danger" && "text-text-destructive",
          )}
        >
          {title}
        </h3>
        {aside && <div className="ml-auto">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

function Tile({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-border px-3 py-2.5">
      <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="text-2xl font-semibold tabular-nums text-foreground">
        {value}
      </span>
      <span className="text-[11px] text-muted-foreground">{sub}</span>
    </div>
  );
}

function Table({
  head,
  rows,
  right = [],
}: {
  head: string[];
  rows: React.ReactNode[][];
  right?: number[];
}) {
  return (
    // On screen wide tables scroll; on paper they shrink and wrap so every column is printed.
    <div className="overflow-x-auto print:overflow-visible">
      <table className="w-full text-sm print:break-inside-auto print:text-[10.5px]">
        <thead>
          <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            {head.map((h, i) => (
              <th
                key={i}
                className={cn(
                  "whitespace-nowrap py-1.5 pr-3 font-semibold last:pr-0 print:whitespace-normal print:pr-2 print:text-[9px]",
                  right.includes(i) && "text-right",
                )}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={i}
              className="border-b border-border/60 print:break-inside-avoid"
            >
              {row.map((c, j) => (
                <td
                  key={j}
                  className={cn(
                    "py-1.5 pr-3 align-top last:pr-0 print:py-1 print:pr-2",
                    right.includes(j) && "text-right tabular-nums",
                    j === 0 && "max-w-80 break-words print:max-w-[16rem]",
                  )}
                >
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Device section chart (as in the Kabob Fusion report): a one-line headline, then Impressions
 * and CTR panels with Mobile and Desktop side by side for last month and this month.
 */
function DeviceCharts({ v, pm, cm }: { v: ReportV2; pm: string; cm: string }) {
  const mob = v.devices.find((d) => d.device === "Mobile");
  const desk = v.devices.find((d) => d.device === "Desktop");
  if (!mob || !desk) return null;
  const pctOf = (c: number | null | undefined, i: number | null | undefined) => (c != null && i ? (c / i) * 100 : null);
  const hasPrev = mob.prevImpressions != null || desk.prevImpressions != null;
  const totalImpr = v.devices.reduce((a, d) => a + d.impressions, 0) || 1;
  const share = Math.round((mob.impressions / totalImpr) * 100);
  const r = mob.ctr != null && desk.ctr ? mob.ctr / desk.ctr : null;
  const frac = r == null ? null : r <= 0.3 ? "a quarter of" : r <= 0.4 ? "a third of" : r <= 0.6 ? "half" : r < 0.9 ? "below" : null;
  const title =
    frac != null
      ? `Mobile carries ${share}% of impressions but converts at ${frac} the desktop rate`
      : `Mobile carries ${share}% of impressions`;
  return (
    <DevicePanels
      title={title}
      names={["Mobile", "Desktop"]}
      impressions={[
        ...(hasPrev ? [{ label: pm.slice(0, 3), values: [mob.prevImpressions, desk.prevImpressions] as [number | null, number | null] }] : []),
        { label: cm.slice(0, 3), values: [mob.impressions, desk.impressions] },
      ]}
      ctr={[
        ...(hasPrev
          ? [{ label: pm.slice(0, 3), values: [pctOf(mob.prevClicks, mob.prevImpressions), pctOf(desk.prevClicks, desk.prevImpressions)] as [number | null, number | null] }]
          : []),
        { label: cm.slice(0, 3), values: [pctOf(mob.clicks, mob.impressions), pctOf(desk.clicks, desk.impressions)] },
      ]}
    />
  );
}

function pct(v: number | null | undefined, digits = 2): string {
  return v == null ? "—" : `${(v * 100).toFixed(digits)}%`;
}

function signed(v: number): string {
  return `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
}

function chg(cur: number, prev: number | undefined, pm: string): string {
  if (!prev) return "";
  return `${signed((cur - prev) / prev)} vs ${pm} (${fmtNum(prev)})`;
}
