"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { PenLine, Plus, ShieldAlert, Trash2 } from "lucide-react";
import { Button, Input, useToast } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import { useUpdateNextSteps } from "../api";
import { CADENCE, fmtNum, GRADE, gradeOf } from "../lib";
import type { Metric, Report, ReportCrawl } from "../types";
import { PackageBadge, SampleBadge } from "./parts";
import { ReportDocumentV2 } from "./report-document-v2";

/**
 * The client report document — same sections, order and wording as the
 * prototype's Module 9-R report (#/reportdoc), in Super App styling.
 * Real data everywhere a source exists; sections without a data source yet are
 * shown as clearly-marked placeholders that are never printed or e-mailed.
 */
export function ReportDocument({
  r,
  showPlaceholders,
  canEdit,
}: {
  r: Report;
  showPlaceholders: boolean;
  canEdit: boolean;
}) {
  const s = r.snapshot;
  if (s.v2) return <ReportDocumentV2 r={r} canEdit={canEdit} />;
  const fg = s.firstGlance;
  const pillars = Object.entries(s.pillars);

  return (
    <article className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-card shadow-sm print:rounded-none print:border-0 print:shadow-none">
      {/* Brand band */}
      <header className="flex items-center gap-3 bg-slate-900 px-7 py-5 text-white print:bg-slate-900">
        <span
          className="size-2.5 rounded-full bg-orange-500 ring-4 ring-orange-500/30"
          aria-hidden
        />
        <span className="text-lg font-bold tracking-tight">innowi</span>
        <span className="text-xs text-slate-400">SEO Performance Report</span>
        <div className="ml-auto text-right text-[11px] text-slate-400">
          {CADENCE[s.period.cadence] ?? s.period.cadence} report
          <b className="block text-[13px] text-white">{s.period.label}</b>
        </div>
      </header>
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-7 py-3">
        <h2 className="text-lg font-semibold text-foreground">{s.site.name}</h2>
        <PackageBadge p={s.site.package} />
        <span className="text-xs text-muted-foreground">
          {s.site.domain} · compared with {s.previous.start} – {s.previous.end}{" "}
          · method {s.method}
        </span>
      </div>

      <div className="flex flex-col px-7 pb-2">
        <DocSection title="First glance">
          <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3">
            <Glance label="Unique visitors" m={fg.users} />
            <Glance label="Total visits" m={fg.sessions} />
            <Glance label="Organic clicks" m={fg.organicClicks} />
            <GlanceBox
              label="Dropped sessions"
              value="—"
              sub={
                <span className="text-muted-foreground">
                  &lt;10s, no event — metric not built yet
                </span>
              }
              placeholder
            />
            <GlanceBox
              label="Key events → orders"
              value={`${fg.keyEvents ? fmtNum(fg.keyEvents.value) : "—"} → —`}
              sub={
                <span className="text-muted-foreground">
                  orders pending (ordering data on hold)
                </span>
              }
            />
            <GlanceBox
              label="SEO health"
              value={
                s.health == null ? (
                  "—"
                ) : (
                  <>
                    {s.health}{" "}
                    <span className="text-sm font-medium text-muted-foreground">
                      {s.grade}
                    </span>
                  </>
                )
              }
              sub={
                <span className="text-muted-foreground">
                  six-pillar weighted
                </span>
              }
            />
          </div>
        </DocSection>

        <DocSection title="What changed">
          {s.whatChanged.length ? (
            <ul className="flex list-disc flex-col gap-1 pl-5 text-sm leading-6 text-foreground">
              {s.whatChanged.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              Not enough data for this period yet.
            </p>
          )}
          {s.dailyClicks.length > 1 && (
            <ClicksChart cur={s.dailyClicks} prev={s.prevDailyClicks} />
          )}
        </DocSection>

        {s.queries.length > 0 && (
          <DocSection title="Top search queries — actual terms">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="py-1.5 font-semibold">Query</th>
                  <th className="py-1.5 font-semibold">
                    {monthShort(s.prevQueriesMonth)} clicks
                  </th>
                  <th className="py-1.5 font-semibold">
                    {monthShort(s.queriesMonth)} clicks
                  </th>
                  <th className="py-1.5 font-semibold">
                    {monthShort(s.prevQueriesMonth)} pos.
                  </th>
                  <th className="py-1.5 font-semibold">
                    {monthShort(s.queriesMonth)} pos.
                  </th>
                </tr>
              </thead>
              <tbody>
                {s.queries.slice(0, 8).map((q) => (
                  <tr key={q.query} className="border-b border-border/60">
                    <td className="py-1.5">{q.query}</td>
                    <td className="py-1.5 tabular-nums">
                      {q.prevClicks ?? "—"}
                    </td>
                    <td className="py-1.5 font-semibold tabular-nums">
                      {fmtNum(q.clicks)}
                    </td>
                    <td className="py-1.5 tabular-nums">
                      {q.prevPosition ?? "—"}
                    </td>
                    <td className="py-1.5 tabular-nums">{q.position ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Note>
              Google hides very low-volume searches, so these rows add up to
              less than the site total — expected, and directionally sound.
            </Note>
          </DocSection>
        )}

        {pillars.length > 0 && (
          <DocSection title="Site health — on-page SEO">
            <div className="flex flex-col gap-1.5">
              {pillars.map(([k, p]) => {
                const g = gradeOf(p.score);
                return (
                  <div
                    key={k}
                    className="grid grid-cols-[9.5rem_1fr_2.5rem] items-center gap-3 text-sm"
                  >
                    <span className="text-muted-foreground">{p.label}</span>
                    <span className="h-2 overflow-hidden rounded-full bg-muted">
                      {p.score != null && g && (
                        <span
                          className={cn(
                            "block h-full rounded-full",
                            GRADE[g].bar,
                          )}
                          style={{ width: `${p.score}%` }}
                        />
                      )}
                    </span>
                    <b className="text-right tabular-nums">{p.score ?? "—"}</b>
                  </div>
                );
              })}
            </div>
            <Note>
              Open findings: {s.findings.openCount}
              {s.findings.fixed.length > 0 &&
                ` · fixed this period: ${s.findings.fixed.length}`}{" "}
              · weighted per the six-pillar method.
            </Note>
          </DocSection>
        )}

        {s.crawl && <CrawlSection c={s.crawl} />}

        <PlaceholderSection
          show={showPlaceholders}
          title="Links & risk flags"
          why="Needs Screaming Frog link metrics (Ahrefs, Majestic or Moz connected inside Screaming Frog)."
        >
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive-subtle px-3 py-2 text-sm text-foreground">
            <ShieldAlert className="mt-0.5 size-4 shrink-0 text-text-destructive" />
            <span>
              <b>Backlink risk flagged:</b> ~50% of anchors form a
              purchased-link cluster (several referring domains on one IP). Not
              a penalty yet — recommend removal requests + disavow via Search
              Console.
            </span>
          </div>
        </PlaceholderSection>

        <DocSection title="Local SEO — map pack & GBP glance">
          {s.local ? (
            <p className="text-sm leading-6 text-foreground">
              Map-pack presence:{" "}
              <span className="text-muted-foreground">
                pending (local rank tracking not built)
              </span>
              . Google Business Profile:{" "}
              {s.local.views && (
                <>
                  <b>{fmtNum(s.local.views.value)}</b> profile views ·{" "}
                </>
              )}
              <b>{fmtNum(s.local.calls.value)}</b> calls ·{" "}
              <b>{fmtNum(s.local.directions.value)}</b> direction requests ·{" "}
              <b>{fmtNum(s.local.website.value)}</b> website clicks.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              No Google Business Profile listing is linked to this site.
            </p>
          )}
        </DocSection>

        <PlaceholderSection
          show={showPlaceholders}
          title={'AI visibility — "Maturity"'}
          why="No AI-engine probing service yet (prototype data was simulated)."
        >
          <div className="mb-2 flex items-center gap-3">
            <span className="grid size-11 place-items-center rounded-full border-2 border-warning text-sm font-bold text-warning-text">
              40
            </span>
            <span className="text-sm">
              <b>AI Visibility Index</b> — share of engine × prompt cells where
              the restaurant is mentioned.
            </span>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-left uppercase tracking-wide text-muted-foreground">
                <th className="py-1">Prompt</th>
                {["ChatGPT", "Gemini", "Perplexity", "Claude", "Copilot"].map(
                  (e) => (
                    <th key={e} className="py-1 text-center">
                      {e}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {[
                [
                  `best restaurant near ${s.site.domain.split(".")[0]}`,
                  "—",
                  "—",
                  "—",
                  "—",
                  "✓",
                ],
                [
                  `${s.site.name.toLowerCase()} menu prices`,
                  "✓",
                  "—",
                  "✓",
                  "—",
                  "—",
                ],
                [
                  `is ${s.site.name.toLowerCase()} open now`,
                  "✓",
                  "★",
                  "—",
                  "—",
                  "—",
                ],
              ].map((row) => (
                <tr key={row[0]} className="border-b border-border/60">
                  <td className="py-1">&quot;{row[0]}&quot;</td>
                  {row.slice(1).map((c, i) => (
                    <td key={i} className="py-1 text-center">
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </PlaceholderSection>

        {s.keywords.length > 0 && (
          <DocSection title="Keyword positions — Google average (Search Console)">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="py-1.5 font-semibold">Keyword</th>
                  <th className="py-1.5 font-semibold">Prev. month</th>
                  <th className="py-1.5 font-semibold">This month</th>
                  <th className="py-1.5 font-semibold">Change</th>
                </tr>
              </thead>
              <tbody>
                {s.keywords.map((k) => {
                  const d =
                    k.position != null && k.previous != null
                      ? Math.round((k.previous - k.position) * 10) / 10
                      : null;
                  return (
                    <tr key={k.keyword} className="border-b border-border/60">
                      <td className="py-1.5">{k.keyword}</td>
                      <td className="py-1.5 tabular-nums">
                        {k.previous ?? "—"}
                      </td>
                      <td className="py-1.5 font-semibold tabular-nums">
                        {k.position ?? "Not showing"}
                      </td>
                      <td className="py-1.5 font-semibold">
                        {d == null || d === 0 ? (
                          <span className="text-muted-foreground">—</span>
                        ) : d > 0 ? (
                          <span className="text-success-subtle-foreground">
                            ▲ {d}
                          </span>
                        ) : (
                          <span className="text-text-destructive">▼ {-d}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </DocSection>
        )}

        <NextSteps r={r} canEdit={canEdit && r.status === "awaiting_signoff"} />

        {s.notes.length > 0 && (
          <div className="mt-4 flex flex-col gap-0.5 text-xs text-muted-foreground">
            {s.notes.map((n, i) => (
              <p key={i}>{n}</p>
            ))}
          </div>
        )}
      </div>

      {/* Sign block */}
      <footer className="mt-4 flex flex-wrap items-center gap-3 border-t border-border bg-muted/50 px-7 py-4">
        <PenLine className="size-4 text-orange-600" aria-hidden />
        {r.signedAt ? (
          <div>
            <div className="text-sm font-semibold text-foreground">
              {r.signedBy?.name ?? "Signed"}
            </div>
            <div className="text-xs text-muted-foreground">
              Digitally signed{" "}
              {new Date(r.signedAt).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </div>
          </div>
        ) : (
          <div>
            <div className="text-sm font-semibold text-muted-foreground">
              Awaiting digital sign-off
            </div>
            <div className="text-xs text-muted-foreground">
              Unsigned reports never send.
            </div>
          </div>
        )}
        <div className="ml-auto text-xs text-muted-foreground">
          © Innowi Inc. · figures from Google Search Console, Google Analytics
          and Google Business Profile
          {s.crawl ? " plus a full-site crawl (Screaming Frog)" : ""}
        </div>
      </footer>
    </article>
  );
}

/** Section heading style: "caps" (original report) or "plain" (monthly report in the SEO team's format). */
export const DocHeadingStyle = createContext<"caps" | "plain">("caps");

function DocSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const style = useContext(DocHeadingStyle);
  return (
    <section className="flex flex-col gap-2.5 border-b border-border/70 py-5 last:border-b-0 print:break-inside-avoid">
      <h3
        className={
          style === "plain"
            ? "text-base font-bold text-foreground"
            : "text-[11px] font-bold uppercase tracking-[0.08em] text-orange-600"
        }
      >
        {title}
      </h3>
      {children}
    </section>
  );
}

/** A report section with no data source yet: visible in the preview (marked), never printed or e-mailed. */
function PlaceholderSection({
  show,
  title,
  why,
  children,
}: {
  show: boolean;
  title: string;
  why: string;
  children: React.ReactNode;
}) {
  if (!show) return null;
  return (
    <section className="my-3 flex flex-col gap-2.5 rounded-lg border border-dashed border-border bg-muted/40 p-4 print:hidden">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
          {title}
        </h3>
        <SampleBadge>Placeholder — not in the sent report</SampleBadge>
        <span className="text-xs text-muted-foreground">{why}</span>
      </div>
      <div className="opacity-70">{children}</div>
    </section>
  );
}

function Glance({ label, m }: { label: string; m: Metric | undefined }) {
  const c = m?.change;
  return (
    <GlanceBox
      label={label}
      value={m ? fmtNum(m.value) : "—"}
      sub={
        c == null ? (
          <span className="text-muted-foreground">
            {m ? "no previous period" : "not linked"}
          </span>
        ) : (
          <span
            className={
              c >= 0
                ? "text-success-subtle-foreground"
                : "text-text-destructive"
            }
          >
            {c > 0 ? "+" : ""}
            {Math.round(c * 100)}% vs prev
          </span>
        )
      }
    />
  );
}

function GlanceBox({
  label,
  value,
  sub,
  placeholder,
}: {
  label: string;
  value: React.ReactNode;
  sub: React.ReactNode;
  placeholder?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-0.5 rounded-lg border border-border p-3",
        placeholder && "border-dashed",
      )}
    >
      <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="text-xl font-semibold tabular-nums text-foreground">
        {value}
      </span>
      <span className="text-xs font-medium">{sub}</span>
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>;
}

/** Area chart of daily clicks; the previous period as a dashed line on the same scale. */
function ClicksChart({
  cur,
  prev,
}: {
  cur: { clicks: number }[];
  prev?: { clicks: number }[];
}) {
  const W = 800;
  const H = 110;
  const p = prev && prev.length > 1 ? prev : null;
  const all = [
    ...cur.map((d) => d.clicks),
    ...(p ? p.map((d) => d.clicks) : []),
  ];
  const max = Math.max(1, ...all);
  const pts = (a: { clicks: number }[]) =>
    a
      .map(
        (d, i) =>
          `${((i / (a.length - 1)) * W).toFixed(1)},${(H - 6 - (d.clicks / max) * (H - 16)).toFixed(1)}`,
      )
      .join(" ");
  return (
    <div className="flex flex-col gap-1">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-28 w-full text-primary"
        role="img"
        aria-label="Google clicks per day"
      >
        <polygon
          points={`0,${H - 6} ${pts(cur)} ${W},${H - 6}`}
          fill="currentColor"
          opacity={0.1}
        />
        {p && (
          <polyline
            points={pts(p)}
            fill="none"
            stroke="var(--muted-foreground)"
            strokeWidth={1.5}
            strokeDasharray="5 5"
            vectorEffect="non-scaling-stroke"
          />
        )}
        <polyline
          points={pts(cur)}
          fill="none"
          stroke="currentColor"
          strokeWidth={2.2}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="flex gap-4 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-4 bg-primary" /> Google clicks per day, this
          period
        </span>
        {p && (
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0 w-4 border-t border-dashed border-muted-foreground" />{" "}
            previous period
          </span>
        )}
      </div>
    </div>
  );
}

/** "What happens next" — suggested from open findings; a manager can edit it until sign-off. */
export function NextSteps({
  r,
  canEdit,
  title = "What happens next",
}: {
  r: Report;
  canEdit: boolean;
  title?: string;
}) {
  // New-format reports call these "Recommendations"; editing saves both (see client_reports.update_next_steps).
  const steps = r.snapshot.v2?.recommendations ?? r.snapshot.nextSteps ?? [];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string[]>(steps);
  const save = useUpdateNextSteps();
  const { toast } = useToast();
  useEffect(
    () =>
      setDraft(r.snapshot.v2?.recommendations ?? r.snapshot.nextSteps ?? []),
    [r.snapshot.v2?.recommendations, r.snapshot.nextSteps],
  );
  if (!steps.length && !canEdit) return null;

  return (
    <DocSection title={title}>
      {editing ? (
        <div className="flex flex-col gap-2 print:hidden">
          {draft.map((d, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-4 text-sm text-muted-foreground">
                {i + 1}.
              </span>
              <Input
                value={d}
                onChange={(e) =>
                  setDraft(draft.map((x, j) => (j === i ? e.target.value : x)))
                }
                className="h-8 text-sm"
              />
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Remove step"
                onClick={() => setDraft(draft.filter((_, j) => j !== i))}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
          <div className="flex gap-2">
            {draft.length < 6 && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setDraft([...draft, ""])}
              >
                <Plus className="size-4" />
                Add step
              </Button>
            )}
            <Button
              size="sm"
              className="ml-auto"
              loading={save.isPending}
              onClick={() =>
                save.mutate(
                  { id: r.id, nextSteps: draft },
                  {
                    onSuccess: () => {
                      setEditing(false);
                      toast({ variant: "success", title: "Next steps saved" });
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
              onClick={() => (setDraft(steps), setEditing(false))}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-3">
          <ol className="flex flex-1 list-decimal flex-col gap-1 pl-5 text-sm leading-6 text-foreground">
            {steps.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ol>
          {canEdit && (
            <Button
              size="sm"
              variant="ghost"
              className="print:hidden"
              onClick={() => setEditing(true)}
            >
              <PenLine className="size-4" />
              Edit
            </Button>
          )}
        </div>
      )}
    </DocSection>
  );
}

function monthShort(iso: string | undefined): string {
  if (!iso) return "";
  return new Date(`${iso.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString(
    "en-US",
    { month: "short", timeZone: "UTC" },
  );
}

/** "Full-site technical check" — the newest Screaming Frog crawl imported for the site. */
export function CrawlSection({
  c,
  title = "Full-site technical check",
}: {
  c: ReportCrawl;
  title?: string;
}) {
  const tone: Record<string, string> = {
    High: "text-text-destructive",
    Medium: "text-warning-text",
    Low: "text-muted-foreground",
  };
  return (
    <DocSection title={title}>
      <p className="text-sm leading-6 text-foreground">
        We checked every page of the website: <b>{fmtNum(c.pages)}</b> pages,{" "}
        <b>{fmtNum(c.indexable)}</b> indexable, <b>{fmtNum(c.broken)}</b>{" "}
        broken, <b>{fmtNum(c.redirects)}</b> redirects
        {c.avgWords != null && (
          <>
            , average <b>{fmtNum(c.avgWords)}</b> words per page
          </>
        )}
        .
      </p>
      {c.top.length > 0 && (
        <table className="mt-2 w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="py-1.5 font-semibold">Priority</th>
              <th className="py-1.5 font-semibold">Issue</th>
              <th className="py-1.5 text-right font-semibold">Pages</th>
              {c.hasPrevious && (
                <th className="py-1.5 text-right font-semibold">
                  Since last check
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {c.top.slice(0, 6).map((i) => (
              <tr key={i.name} className="border-b border-border/60">
                <td
                  className={cn(
                    "py-1.5 text-xs font-semibold",
                    tone[i.priority],
                  )}
                >
                  {i.priority}
                </td>
                <td className="py-1.5">{i.name}</td>
                <td className="py-1.5 text-right tabular-nums">
                  {fmtNum(i.urls)}
                </td>
                {c.hasPrevious && (
                  <td className="py-1.5 text-right tabular-nums">
                    {i.prevUrls == null
                      ? "new"
                      : i.prevUrls === i.urls
                        ? "—"
                        : i.urls < i.prevUrls
                          ? `−${fmtNum(i.prevUrls - i.urls)}`
                          : `+${fmtNum(i.urls - i.prevUrls)}`}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Note>
        Full-site crawl by Screaming Frog
        {c.crawledAt
          ? ` on ${new Date(c.crawledAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
          : ""}
        .
      </Note>
    </DocSection>
  );
}
