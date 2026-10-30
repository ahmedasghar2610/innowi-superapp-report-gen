"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { GitCompareArrows, Plus, X } from "lucide-react";
import { Card, EmptyState, ErrorState, Select, Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import { useCompare, useSeoOverview } from "../api";
import { changeOf, fmtNum, fmtPct1, GRADE, gradeOf } from "../lib";
import type { CompareSite, PillarMeta } from "../types";
import { ChangeText, DemoBadge, GradeBadge, HealthScore, PackageBadge, Section, SeverityBadge, Sparkline } from "./parts";

const MAX = 4;

/** /web/seo/compare?ids=a,b — 2 to 4 sites side by side. */
export function ComparePage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const ids = useMemo(() => (params.get("ids") ?? "").split(",").filter(Boolean).slice(0, MAX), [params]);
  const overview = useSeoOverview();
  const q = useCompare(ids);
  const [pick, setPick] = useState("");

  const setIds = (next: string[]) => {
    const sp = new URLSearchParams(params.toString());
    if (next.length) sp.set("ids", next.join(","));
    else sp.delete("ids");
    router.replace(`${pathname}${sp.toString() ? `?${sp}` : ""}`, { scroll: false });
  };
  const options = (overview.data?.rows ?? []).filter((r) => !ids.includes(r.id)).sort((a, b) => a.name.localeCompare(b.name));
  const nameOf = (id: string) => overview.data?.rows.find((r) => r.id === id)?.name ?? q.data?.sites.find((s) => s.id === id)?.name ?? "…";

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-2 text-base font-semibold text-foreground">Compare sites</h2>
        {ids.map((id) => (
          <span key={id} className="inline-flex h-8 items-center gap-1 rounded-full border border-primary bg-accent pl-2.5 pr-1 text-xs font-medium text-primary-subtle-foreground">
            {nameOf(id)}
            <button type="button" aria-label={`Remove ${nameOf(id)}`} onClick={() => setIds(ids.filter((x) => x !== id))} className="grid size-6 place-items-center rounded hover:bg-primary/10">
              <X className="size-3.5" />
            </button>
          </span>
        ))}
        {ids.length < MAX && (
          <span className="inline-flex items-center gap-1.5">
            <Plus className="size-4 text-muted-foreground" />
            <Select
              value={pick}
              onChange={(e) => {
                if (e.target.value) setIds([...ids, e.target.value]);
                setPick("");
              }}
              className="h-8 w-56 text-xs"
              aria-label="Add a site"
              disabled={!overview.data}
            >
              <option value="">Add a site…</option>
              {options.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} — {r.domain}
                </option>
              ))}
            </Select>
          </span>
        )}
      </div>
      {ids.length < 2 ? (
        <Card>
          <EmptyState
            icon={GitCompareArrows}
            title="Pick at least two sites"
            description="Add 2 to 4 sites above, or tick sites on the Command page and choose Compare."
          />
        </Card>
      ) : q.error ? (
        <ErrorState title="Couldn't compare these sites" description={q.error.message} />
      ) : !q.data ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <Grid sites={q.data.sites} pillarMeta={q.data.pillarMeta} />
      )}
    </>
  );
}

type Row = { label: string; hint?: string; render: (s: CompareSite) => React.ReactNode; best?: (s: CompareSite) => number | null; lowerIsBetter?: boolean };

function Grid({ sites, pillarMeta }: { sites: CompareSite[]; pillarMeta: PillarMeta[] }) {
  const k = (s: CompareSite) => s.kpis;
  const rows: { section: string; rows: Row[] }[] = [
    {
      section: "Overview",
      rows: [
        { label: "Health", render: (s) => <HealthScore score={s.health} />, best: (s) => s.health },
        { label: "Package", render: (s) => <PackageBadge p={s.package} /> },
        { label: "Segment", render: (s) => <span className="text-xs">{s.segment}</span> },
        {
          label: "Open findings",
          render: (s) => (
            <span className="inline-flex gap-2">
              {(["S1", "S2", "S3"] as const).map((x) => (
                <span key={x} className="inline-flex items-center gap-1">
                  <SeverityBadge s={x} />
                  <span className="text-xs tabular-nums">{s.open[x]}</span>
                </span>
              ))}
            </span>
          ),
          best: (s) => s.open.S1 * 100 + s.open.S2 * 10 + s.open.S3,
          lowerIsBetter: true,
        },
      ],
    },
    {
      section: "Pillars",
      rows: pillarMeta.map((m) => ({
        label: m.label,
        render: (s: CompareSite) => {
          const v = s.pillars[m.key];
          const g = gradeOf(v);
          return v == null ? <span className="text-xs text-muted-foreground">No data</span> : <span className={cn("font-semibold tabular-nums", g && GRADE[g].text)}>{v}</span>;
        },
        best: (s: CompareSite) => s.pillars[m.key],
      })),
    },
    {
      section: "Last 28 days",
      rows: [
        { label: "Google clicks", render: (s) => <Num v={k(s).clicks} c={changeOf(k(s).clicks, k(s).clicksPrev)} />, best: (s) => k(s).clicks ?? null },
        { label: "Impressions", render: (s) => <Num v={k(s).impressions} c={changeOf(k(s).impressions, k(s).impressionsPrev)} />, best: (s) => k(s).impressions ?? null },
        { label: "CTR", render: (s) => <span className="tabular-nums">{fmtPct1(k(s).ctr)}</span>, best: (s) => k(s).ctr ?? null },
        { label: "Avg position", render: (s) => <span className="tabular-nums">{k(s).position ?? "—"}</span>, best: (s) => k(s).position ?? null, lowerIsBetter: true },
        { label: "Visits (GA4)", render: (s) => <Num v={k(s).sessions} c={changeOf(k(s).sessions, k(s).sessionsPrev)} />, best: (s) => k(s).sessions ?? null },
        { label: "Key actions", render: (s) => <Num v={k(s).keyEvents} c={changeOf(k(s).keyEvents, k(s).keyEventsPrev)} />, best: (s) => k(s).keyEvents ?? null },
        { label: "Clicks trend", render: (s) => <Sparkline values={s.trend.clicks} width={110} /> },
      ],
    },
    {
      section: "Technical & local",
      rows: [
        { label: "PageSpeed (avg, mobile)", render: (s) => <span className="tabular-nums">{s.psiAvg ?? "—"}</span>, best: (s) => s.psiAvg },
        { label: "Local (GBP) grade", render: (s) => <GradeBadge grade={s.localGrade} /> },
      ],
    },
  ];

  return (
    <>
      {rows.map((sec) => (
        <Section key={sec.section} title={sec.section}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-48" />
                {sites.map((s) => (
                  <TableHead key={s.id}>
                    {sec.section === "Overview" ? (
                      <Link href={`/web/seo/sites/${s.id}`} className="flex flex-col normal-case hover:underline">
                        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-foreground">
                          {s.name}
                          {s.isDemo && <DemoBadge />}
                        </span>
                        <span className="text-xs font-normal text-muted-foreground">{s.domain}</span>
                      </Link>
                    ) : (
                      s.name
                    )}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {sec.rows.map((r) => {
                const winner = bestIndex(sites, r);
                return (
                  <TableRow key={r.label}>
                    <TableCell className="text-xs font-medium text-muted-foreground">{r.label}</TableCell>
                    {sites.map((s, i) => (
                      <TableCell key={s.id} className={cn(winner === i && "bg-success-subtle/40")}>
                        {r.render(s)}
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Section>
      ))}
      <Section title="Top searches">
        <div className={cn("grid gap-3", sites.length > 2 ? "md:grid-cols-2 xl:grid-cols-4" : "md:grid-cols-2")}>
          {sites.map((s) => (
            <Card key={s.id} className="flex flex-col gap-2 p-4">
              <div className="text-sm font-semibold text-foreground">{s.name}</div>
              {s.queries.length ? (
                <ol className="flex flex-col gap-1 text-xs">
                  {s.queries.map((q) => (
                    <li key={q.query} className="flex gap-2">
                      <span className="min-w-0 flex-1 truncate text-foreground">{q.query}</span>
                      <span className="tabular-nums text-muted-foreground">{fmtNum(q.clicks)}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <span className="text-xs text-muted-foreground">No Search Console data</span>
              )}
            </Card>
          ))}
        </div>
      </Section>
    </>
  );
}

function bestIndex(sites: CompareSite[], r: Row): number | null {
  if (!r.best) return null;
  let idx: number | null = null;
  let val: number | null = null;
  let ties = 0;
  sites.forEach((s, i) => {
    const v = r.best!(s);
    if (v == null) return;
    if (val == null || (r.lowerIsBetter ? v < val : v > val)) {
      val = v;
      idx = i;
      ties = 0;
    } else if (v === val) ties++;
  });
  return ties ? null : idx;
}

function Num({ v, c }: { v: number | null | undefined; c: number | null }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="tabular-nums">{fmtNum(v)}</span>
      {v != null && <ChangeText v={c} />}
    </span>
  );
}
