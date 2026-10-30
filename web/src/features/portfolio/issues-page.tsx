"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Search, TriangleAlert } from "lucide-react";
import { Button, EmptyState, Input, Select, StatTile } from "@/components/ui";
import { IssueCard } from "@/features/home/components/issue-card";
import { CardsSkeleton, ConnectNote, DataThrough, SampleNote } from "@/features/home/components/live-bits";
import { useCommandCenter } from "@/features/home/live/use-command-center";
import type { IssueItem, Severity } from "@/features/home/data/command-center.mock";
import { FilterPills, PageHeader } from "./filter-pills";

type Kind = "all" | "issues" | "opportunities";
const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "data", "low", "opportunity"];
const SEVERITY_LABEL: Record<Severity, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
  data: "Data",
  opportunity: "Opportunity",
};
const PAGE = 40;

/**
 * /issues — every live "Needs Attention" item and opportunity across the
 * portfolio (GBP listings, Ads accounts, tickets, merchant profiles), most
 * severe first. `?kind=opportunities` opens on the opportunities.
 */
export function IssuesPage() {
  const params = useSearchParams();
  const initial = params.get("kind");
  const cc = useCommandCenter();
  const [kind, setKind] = useState<Kind>(initial === "opportunities" || initial === "issues" ? initial : "all");
  const [severity, setSeverity] = useState<"" | Severity>("");
  const [module, setModule] = useState("");
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(PAGE);

  const all = useMemo(() => [...cc.issues, ...cc.opportunities], [cc.issues, cc.opportunities]);
  const modules = useMemo(() => Array.from(new Set(all.map((i) => i.module))).sort(), [all]);

  const rows = useMemo(() => {
    const base: IssueItem[] = kind === "issues" ? cc.issues : kind === "opportunities" ? cc.opportunities : all;
    const needle = q.trim().toLowerCase();
    return base
      .filter((i) => !severity || i.severity === severity)
      .filter((i) => !module || i.module === module)
      .filter((i) => !needle || `${i.title} ${i.merchant} ${i.location} ${i.impact}`.toLowerCase().includes(needle));
  }, [kind, severity, module, q, all, cc.issues, cc.opportunities]);

  const count = (s: Severity) => cc.issues.filter((i) => i.severity === s).length;
  const reset = () => setShown(PAGE);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Issues"
        description={`Everything that needs attention across your merchants, plus the opportunities worth acting on · last ${cc.days} days.`}
        action={<DataThrough cc={cc} />}
      />
      {!cc.loading && <ConnectNote cc={cc} />}
      <SampleNote cc={cc} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Open issues" value={cc.issues.length} loading={cc.loading} status={`${count("critical")} critical`} tone={count("critical") ? "danger" : "ok"} />
        <StatTile label="High severity" value={count("high")} loading={cc.loading} status={count("high") ? "Act this week" : "None"} tone={count("high") ? "warning" : "ok"} />
        <StatTile label="Data problems" value={cc.issues.filter((i) => i.module === "Data").length} loading={cc.loading} status="Can hide other issues" tone="warning" />
        <StatTile label="Opportunities" value={cc.opportunities.length} loading={cc.loading} status="Upside available" tone="ok" />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <FilterPills<Kind>
          label="Show"
          value={kind}
          onChange={(v) => {
            setKind(v);
            reset();
          }}
          options={[
            { value: "all", label: "All", count: all.length },
            { value: "issues", label: "Needs attention", count: cc.issues.length },
            { value: "opportunities", label: "Opportunities", count: cc.opportunities.length },
          ]}
        />
        <Select aria-label="Severity" value={severity} onChange={(e) => (setSeverity(e.target.value as "" | Severity), reset())} className="w-40">
          <option value="">Any severity</option>
          {SEVERITY_ORDER.map((s) => (
            <option key={s} value={s}>
              {SEVERITY_LABEL[s]}
            </option>
          ))}
        </Select>
        <Select aria-label="Module" value={module} onChange={(e) => (setModule(e.target.value), reset())} className="w-40">
          <option value="">Any module</option>
          {modules.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </Select>
        <div className="relative min-w-52 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-2 size-4 text-muted-foreground" aria-hidden />
          <Input aria-label="Search issues" placeholder="Search merchant or issue" value={q} onChange={(e) => (setQ(e.target.value), reset())} className="pl-8" />
        </div>
      </div>

      {cc.loading && !all.length ? (
        <CardsSkeleton count={6} />
      ) : rows.length ? (
        <>
          <div className="grid gap-3 lg:grid-cols-2">
            {rows.slice(0, shown).map((i) => (
              <IssueCard key={i.id} item={i} />
            ))}
          </div>
          {rows.length > shown && (
            <div className="flex justify-center">
              <Button variant="outline" onClick={() => setShown((n) => n + PAGE)}>
                Show more ({rows.length - shown} left)
              </Button>
            </div>
          )}
        </>
      ) : (
        <div className="rounded-lg border border-border bg-card">
          <EmptyState icon={TriangleAlert} title={all.length ? "No issues match" : "No issues"} description={all.length ? "Try a different severity, module or search." : "Nothing needs attention right now."} />
        </div>
      )}
    </div>
  );
}
