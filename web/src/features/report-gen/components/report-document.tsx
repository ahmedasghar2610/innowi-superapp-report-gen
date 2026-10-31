"use client";

import { Badge, Card, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import {
  EMPTY,
  TAG_NOTE,
  TAGS,
  changeText,
  changeTone,
  longDate,
  lowerIsBetter,
  metricLabel,
  metricValue,
  notSuppliedText,
  sectionIsEmpty,
  sectionTables,
  unitText,
} from "../format";
import type { HeadlineCard, Metric, Section, Snapshot } from "../types";
import { ReportTable } from "./report-tables";

/**
 * The merchant-facing document, laid out as the approved prototype
 * (web/docs/design/innowi-reports-prototype.html) but drawn with this app's own
 * primitives and Signal Blue tokens rather than the prototype's palette.
 *
 * `merchantView` is the prototype's "Preview as the merchant sees it" switch.
 * It hides the internal metric IDs; it deliberately does NOT hide the
 * modelled / tracked attribution tag, because MFR05 requires the merchant to
 * see that label on an attributed figure.
 *
 * Omitted against the prototype, for want of data rather than time: the
 * headline-card sparklines and the per-section six-month trend bars. The
 * payload carries `value`, `prev` and `change` only — two points — so there is
 * no series to draw and nothing here invents one.
 */
export type DocumentView = { merchantView: boolean };

const TONE_PILL: Record<"ok" | "danger" | "neutral", string> = {
  ok: "bg-success-subtle text-success-subtle-foreground",
  danger: "bg-destructive-subtle text-text-destructive",
  neutral: "bg-muted text-muted-foreground",
};

/** The change on the month before, as a pill. Empty when there is no prior figure. */
function ChangePill({ m }: { m: Pick<Metric, "change" | "id" | "label"> }) {
  if (m.change === null || m.change === undefined) return null;
  const tone = changeTone(m.change, lowerIsBetter(m));
  return (
    <span className={cn("inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-xs font-semibold tabular-nums", TONE_PILL[tone])}>
      {changeText(m.change)}
    </span>
  );
}

function MetricId({ id, hidden }: { id: string; hidden: boolean }) {
  if (hidden) return null;
  return <span className="shrink-0 rounded-sm border border-border bg-muted px-1 text-[10px] font-semibold leading-4 tabular-nums text-muted-foreground">{id}</span>;
}

/* ------------------------------------------------------------- cover ------ */
function Cover({ snap }: { snap: Snapshot }) {
  const where = [snap.merchant.city, snap.merchant.state].filter(Boolean).join(", ");
  const locations = snap.merchant.locationCount && snap.merchant.locationCount > 1 ? `${snap.merchant.locationCount} locations` : where || null;
  const lines = [locations, snap.merchant.website, "Prepared by Innowi Inc.", snap.generatedAt ? `Report prepared ${longDate(snap.generatedAt)}` : null].filter(Boolean);
  return (
    <Card className="overflow-hidden p-0">
      <div className="bg-foreground px-6 py-6 text-background">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm font-semibold">innowi</span>
          <span className="rounded-full border border-background/25 px-2.5 py-0.5 text-xs">{snap.period.label}</span>
        </div>
        <h1 className="mt-3 text-2xl font-semibold tracking-[-0.02em] sm:text-3xl">{snap.merchant.name}</h1>
        <p className="mt-1 text-sm text-background/75">{[snap.merchant.cuisine, ...lines].filter(Boolean).join(" · ")}</p>
      </div>
    </Card>
  );
}

/* --------------------------------------------------- executive summary ---- */
function HeadlineTile({ c, merchantView }: { c: HeadlineCard; merchantView: boolean }) {
  const supplied = c.value !== null && c.value !== undefined;
  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-lg border border-border bg-muted/40 p-3">
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{c.label}</span>
        {c.id && <MetricId id={c.id} hidden={merchantView} />}
      </div>
      <span className={cn("tabular-nums", supplied ? "text-xl font-semibold tracking-[-0.02em] text-foreground" : "text-xs font-medium text-muted-foreground")}>
        {supplied ? unitText(c.value, c.unit) : notSuppliedText(c.reasonText)}
      </span>
      <div className="flex flex-wrap items-center gap-1.5">
        <ChangePill m={c} />
        {c.tag && TAGS[c.tag] && (
          <Badge tone="warning" icon={false}>
            {TAGS[c.tag]}
          </Badge>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- snapshot ----- */
function SnapshotTable({ snap, merchantView }: { snap: Snapshot; merchantView: boolean }) {
  if (!snap.headline.length) return null;
  const prevOf = (c: HeadlineCard) => snap.sections[c.section]?.metrics.find((m) => m.id === c.id)?.prev ?? null;
  return (
    <Card className="p-5">
      <h2 className="text-base font-semibold text-foreground">Snapshot</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">The headline figures beside the month before.</p>
      <div className="mt-3">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Figure</TableHead>
              <TableHead align="right">{snap.period.label}</TableHead>
              <TableHead align="right">{snap.previous.label}</TableHead>
              <TableHead align="right">Change</TableHead>
              <TableHead>Basis</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {snap.headline.map((c, i) => {
              const prev = prevOf(c);
              const supplied = c.value !== null && c.value !== undefined;
              return (
                <TableRow key={`${c.section}-${c.id ?? i}`}>
                  <TableCell>
                    <span className="flex items-center gap-1.5">
                      <span className="text-xs font-medium text-foreground">{c.label}</span>
                      {c.id && <MetricId id={c.id} hidden={merchantView} />}
                    </span>
                  </TableCell>
                  <TableCell align="right" className={cn("text-xs", supplied ? "text-foreground" : "text-muted-foreground")}>
                    {supplied ? unitText(c.value, c.unit) : notSuppliedText(c.reasonText)}
                  </TableCell>
                  <TableCell align="right" className="text-xs text-muted-foreground">
                    {prev === null ? EMPTY : unitText(prev, c.unit)}
                  </TableCell>
                  <TableCell align="right" className="text-xs">
                    {changeText(c.change)}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{c.tag ? TAGS[c.tag] ?? "" : ""}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}

/* ----------------------------------------------------------- sections ---- */
/** MFR04: a taken service with no data keeps its heading and says why. */
function NotSupplied({ reason }: { reason: string | null }) {
  return (
    <div className="mt-3 rounded-lg border border-dashed border-border bg-muted/40 p-4 text-sm text-foreground">
      <span className="font-semibold">Not supplied this month.</span> {reason}
    </div>
  );
}

function MetricTile({ m, merchantView }: { m: Metric; merchantView: boolean }) {
  const supplied = m.value !== null && m.value !== undefined;
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-border px-3 py-2.5">
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-medium leading-4 text-muted-foreground">{metricLabel(m)}</span>
        <MetricId id={m.id} hidden={merchantView} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <span className={cn("tabular-nums", supplied ? "text-base font-semibold text-foreground" : "text-xs font-medium text-muted-foreground")}>{metricValue(m)}</span>
        <ChangePill m={m} />
      </div>
      {supplied && m.prev !== null && m.prev !== undefined && (
        <span className="text-xs tabular-nums text-muted-foreground">
          {unitText(m.prev, m.unit)} the month before
        </span>
      )}
    </div>
  );
}

export function SectionBlock({ s, note, merchantView }: { s: Section; note?: string; merchantView: boolean }) {
  // MFR01: a service the merchant has not taken gets no section at all.
  if (!s.included) return null;
  const empty = sectionIsEmpty(s);
  // Every figure gets a tile, table-unit ones included: a "table" figure that
  // was not supplied still has to show its reason (MFR04), and a supplied one
  // reads "N shown below" over its own grid — the same row the exporter prints.
  const tiles = s.metrics;
  const tables = sectionTables(s);
  const tags = Array.from(new Set(s.metrics.map((m) => m.tag).filter((t): t is string => !!t && !!TAG_NOTE[t]))).sort();

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-foreground">{s.title}</h2>
        {s.dataThrough && <span className="text-xs text-muted-foreground">Data through {longDate(s.dataThrough)}</span>}
      </div>

      {empty ? (
        <NotSupplied reason={s.caption ?? (s.metrics[0]?.reasonText ?? null)} />
      ) : (
        <>
          {s.caption && <p className="mt-1 text-xs text-muted-foreground">{s.caption}</p>}
          {note && <p className="mt-2 text-sm text-foreground">{note}</p>}
          {tiles.length > 0 && <div className="mt-3 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">{tiles.map((m) => <MetricTile key={m.id} m={m} merchantView={merchantView} />)}</div>}
          {tags.map((t) => (
            <p key={t} className="mt-2 text-xs text-muted-foreground">
              {TAG_NOTE[t]}
            </p>
          ))}
          {tables.length > 0 && <div className="mt-4 flex flex-col gap-4">{tables.map((t) => <ReportTable key={t.name} t={t} />)}</div>}
        </>
      )}
    </Card>
  );
}

/* --------------------------------------------------------- the whole ----- */
export function ReportDocument({ snap, merchantView, children }: { snap: Snapshot; merchantView: boolean; children?: React.ReactNode }) {
  const missingBySection = snap.missing.reduce<Record<string, number>>((acc, m) => {
    acc[m.section] = (acc[m.section] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <>
      <Cover snap={snap} />

      <Card className="p-5">
        <h2 className="text-base font-semibold text-foreground">Executive summary</h2>
        {snap.headline.length > 0 && (
          <div className="mt-3 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
            {snap.headline.map((c, i) => (
              <HeadlineTile key={`${c.section}-${c.id ?? i}`} c={c} merchantView={merchantView} />
            ))}
          </div>
        )}
        {/* The reviewer's editable text is injected here by the review page. */}
        {children ?? (
          <div className="mt-4 flex flex-col gap-2 text-sm text-foreground">
            {snap.summary.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
        )}
      </Card>

      <SnapshotTable snap={snap} merchantView={merchantView} />

      {/* MFR02: the assembler's own order, read from the payload. */}
      {snap.sectionOrder.map((key) => {
        const s = snap.sections[key];
        return s ? <SectionBlock key={key} s={s} note={snap.sectionNotes?.[key]} merchantView={merchantView} /> : null;
      })}

      {snap.recommendations.length > 0 && (
        <Card className="p-5">
          <h2 className="text-base font-semibold text-foreground">What we recommend</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Only what this month&apos;s figures support, each with an owner and a target.</p>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            {snap.recommendations.map((rec, i) => (
              <div key={i} className="flex flex-col gap-3 rounded-lg border border-border p-4">
                <div className="flex items-start gap-3">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-accent text-xs font-semibold tabular-nums text-primary-subtle-foreground">{i + 1}</span>
                  <span className="text-sm font-medium leading-5 text-foreground">{rec.action}</span>
                </div>
                {rec.why && <p className="text-xs leading-5 text-muted-foreground">{rec.why}</p>}
                <dl className="flex flex-col gap-1 border-t border-border pt-2.5 text-xs">
                  <div className="flex gap-2">
                    <dt className="w-16 shrink-0 text-muted-foreground">Owner</dt>
                    <dd className="font-medium text-foreground">{rec.owner || EMPTY}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-16 shrink-0 text-muted-foreground">Target</dt>
                    <dd className="font-medium text-foreground">{rec.target || EMPTY}</dd>
                  </div>
                </dl>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card className="overflow-hidden p-0">
        <div className="bg-foreground p-5 text-background">
          <h2 className="text-xs font-semibold uppercase tracking-[0.06em] text-background/70">The bottom line</h2>
          <p className="mt-1.5 text-sm leading-6">{snap.bottomLine}</p>
        </div>
      </Card>

      {snap.missing.length > 0 && (
        <Card className="p-5">
          <h2 className="text-base font-semibold text-foreground">Not supplied this month</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            These figures are not in this report. Each line says what is needed; none of them is shown as zero.
          </p>
          <div className="mt-3">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Section</TableHead>
                  <TableHead align="right">Figures</TableHead>
                  <TableHead>Why</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.entries(
                  snap.missing.reduce<Record<string, Set<string>>>((acc, m) => {
                    const title = snap.sections[m.section]?.title ?? m.section;
                    const key = `${title}\u0000${m.text}`;
                    (acc[key] ??= new Set()).add(m.id);
                    return acc;
                  }, {}),
                ).map(([key, ids]) => {
                  const [title, why] = key.split("\u0000");
                  return (
                    <TableRow key={key}>
                      <TableCell className="text-xs font-medium text-foreground">{title}</TableCell>
                      <TableCell align="right" className="text-xs tabular-nums text-muted-foreground">
                        {ids.size}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{why}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {Object.keys(missingBySection).length} section{Object.keys(missingBySection).length === 1 ? "" : "s"} affected.
          </p>
        </Card>
      )}

      <Card className="p-5">
        <h2 className="text-sm font-semibold text-foreground">Where these figures come from</h2>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {snap.sources.length ? (
            snap.sources.map((s) => (
              <Badge key={s} tone="neutral" icon={false}>
                {s}
              </Badge>
            ))
          ) : (
            <span className="text-xs text-muted-foreground">No external source supplied figures this month.</span>
          )}
        </div>
        <p className="mt-2.5 text-xs leading-5 text-muted-foreground">
          Figures cover {snap.period.label}, compared with {snap.previous.label}. An attributed figure is labelled modelled or tracked and is
          worked out by the platform that served the activity, not measured at the till. A figure with no data shows &quot;not supplied&quot; and the
          reason, never zero. Prepared by Innowi Inc.
        </p>
      </Card>
    </>
  );
}
