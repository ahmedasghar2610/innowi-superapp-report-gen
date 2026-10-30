"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { GitCompareArrows, Lock, Search } from "lucide-react";
import { Button, EmptyState, Input, Select, StatTile } from "@/components/ui";
import { LiveChangeCard } from "@/features/home/components/live-change-card";
import { CardsSkeleton } from "@/features/home/components/live-bits";
import { useLiveChanges, type LiveChange } from "@/features/home/live/changes";
import { FilterPills, PageHeader } from "./filter-pills";

type ActionFilter = "all" | LiveChange["action"];
const STEP = 50;

/**
 * /changes — the change log behind Home "What Changed", read from the audit
 * log: every change saved in the Super App (websites, Ads and GBP links,
 * merchant profiles, tickets, team), newest first.
 */
export function ChangesPage() {
  const [limit, setLimit] = useState(STEP);
  const live = useLiveChanges(limit);
  const [action, setAction] = useState<ActionFilter>("all");
  const [module, setModule] = useState("");
  const [owner, setOwner] = useState("");
  const [q, setQ] = useState("");

  const list = live.changes;
  const modules = useMemo(() => Array.from(new Set(list.map((c) => c.module))).sort(), [list]);
  const owners = useMemo(() => Array.from(new Set(list.map((c) => c.owner))).sort(), [list]);
  const count = (a: LiveChange["action"]) => list.filter((c) => c.action === a).length;
  const today = list.filter((c) => Date.now() - new Date(c.when).getTime() < 86_400_000).length;

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return list
      .filter((c) => action === "all" || c.action === action)
      .filter((c) => !module || c.module === module)
      .filter((c) => !owner || c.owner === owner)
      .filter((c) => !needle || `${c.title} ${c.merchant ?? ""} ${c.details.join(" ")}`.toLowerCase().includes(needle));
  }, [list, action, module, owner, q]);

  if (!live.allowed) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title="Changes" description="Every change saved in the Super App, newest first." />
        <div className="rounded-lg border border-border bg-card">
          <EmptyState icon={Lock} title="Admins only" description="The change log is built from the audit log, which only admins can see. Each merchant's own history is on its History tab." />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Changes"
        description="Every change saved in the Super App — websites, Ads and GBP links, merchant profiles, tickets and team — newest first."
        action={
          <Link href="/audit-log" className="text-xs font-medium leading-4 text-primary hover:underline">
            Full audit log
          </Link>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Changes loaded" value={list.length} loading={live.loading} status={live.total != null ? `of ${live.total.toLocaleString("en-US")} logged` : undefined} />
        <StatTile label="Last 24 hours" value={today} loading={live.loading} status="Saved today" />
        <StatTile label="Added" value={count("CREATE")} loading={live.loading} status="New records" tone="ok" />
        <StatTile label="Removed" value={count("DELETE")} loading={live.loading} status={count("DELETE") ? "Check these were intended" : "None"} tone={count("DELETE") ? "warning" : "ok"} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <FilterPills<ActionFilter>
          label="Action"
          value={action}
          onChange={setAction}
          options={[
            { value: "all", label: "All", count: list.length },
            { value: "UPDATE", label: "Updated", count: count("UPDATE") },
            { value: "CREATE", label: "Added", count: count("CREATE") },
            { value: "DELETE", label: "Removed", count: count("DELETE") },
          ]}
        />
        <Select aria-label="Module" value={module} onChange={(e) => setModule(e.target.value)} className="w-40">
          <option value="">Any module</option>
          {modules.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </Select>
        <Select aria-label="Changed by" value={owner} onChange={(e) => setOwner(e.target.value)} className="w-48">
          <option value="">Anyone</option>
          {owners.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </Select>
        <div className="relative min-w-52 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-2 size-4 text-muted-foreground" aria-hidden />
          <Input aria-label="Search changes" placeholder="Search changes" value={q} onChange={(e) => setQ(e.target.value)} className="pl-8" />
        </div>
      </div>

      {live.loading ? (
        <CardsSkeleton count={6} height="h-[100px]" />
      ) : rows.length ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {rows.map((c) => (
            <LiveChangeCard key={c.id} item={c} />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-card">
          <EmptyState icon={GitCompareArrows} title={list.length ? "No changes match" : "No changes logged yet"} description={list.length ? "Try a different action, module or person." : undefined} />
        </div>
      )}
      {live.total != null && live.total > list.length && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => setLimit((n) => Math.min(n + STEP, 100))} disabled={limit >= 100}>
            {limit >= 100 ? "Showing the latest 100 — see the full audit log" : "Load older changes"}
          </Button>
        </div>
      )}
    </div>
  );
}
