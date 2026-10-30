"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowUpRight, Search, X } from "lucide-react";
import { Badge, Button, Card, Dialog, ErrorState, Field, Input, Select, Skeleton, StatTile, Textarea, useToast } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import { useFindings, useLinkOptions, useUpdateFinding } from "../api";
import { fmtAgo, fmtDateTime, OUTCOME, SEVERITY } from "../lib";
import type { Finding, FindingGroup, FindingQuery, FindingState, Severity } from "../types";
import { HowItDecides } from "./how-it-decides";
import { DemoBadge, SeverityBadge, StateBadge } from "./parts";

const GROUPS: { key: FindingGroup; label: string; count: keyof NonNullable<ReturnType<typeof useFindings>["data"]>["counts"]; status: string }[] = [
  { key: "needs_decision", label: "Needs decision", count: "needsDecision", status: "Detected · evidenced · recommended" },
  { key: "in_flight", label: "In flight", count: "inFlight", status: "Task created · in progress" },
  { key: "awaiting_verification", label: "Awaiting verification", count: "awaitingVerification", status: "Re-checked on the next sync" },
  { key: "closed", label: "Closed (7 days)", count: "closed7d", status: "Verified, cleared or dismissed" },
];
const TEAMS = ["SEO", "Web Development", "Analytics"];

/** /web/seo/intelligence — what happened → why → evidence → recommendation → action → verified outcome. */
export function IntelligencePage() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const set = (k: string, v: string | undefined) => {
    const p = new URLSearchParams(params.toString());
    if (v) p.set(k, v);
    else p.delete(k);
    router.replace(`${pathname}?${p.toString()}`, { scroll: false });
  };
  const query: FindingQuery = {
    group: (params.get("group") as FindingGroup) || undefined,
    severity: (params.get("severity") as Severity) || undefined,
    team: params.get("team") || undefined,
    owner: params.get("owner") || undefined,
    siteId: params.get("siteId") || undefined,
  };
  const [search, setSearch] = useState("");
  const q = useFindings(query);
  const owners = useLinkOptions("");
  const openId = params.get("open");
  const data = q.data;

  const rows = useMemo(() => {
    const t = search.trim().toLowerCase();
    return (data?.data ?? []).filter((f) => !t || f.title.toLowerCase().includes(t) || f.site.name.toLowerCase().includes(t) || f.site.domain.includes(t));
  }, [data, search]);
  const open = openId ? (data?.data.find((f) => f.id === openId) ?? null) : null;
  const siteName = query.siteId ? data?.data[0]?.site.name : null;

  if (q.error) return <ErrorState title="Couldn't load findings" description={q.error.message} />;

  return (
    <>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-foreground">Issue Intelligence</h2>
          <p className="text-xs text-muted-foreground">What happened → why → evidence → recommendation → action → verified outcome, across every site.</p>
        </div>
        <HowItDecides />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {GROUPS.map((g) => (
          <button key={g.key} type="button" onClick={() => set("group", query.group === g.key ? undefined : g.key)} className="text-left" aria-pressed={query.group === g.key}>
            <StatTile
              label={g.label}
              value={data ? data.counts[g.count] : "—"}
              status={g.status}
              tone={g.key === "needs_decision" && (data?.counts.needsDecision ?? 0) > 0 ? "warning" : "neutral"}
              className={cn(query.group === g.key && "ring-2 ring-primary")}
            />
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative w-full max-w-xs">
          <span className="sr-only">Search findings</span>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Finding or site" className="pl-8" />
        </label>
        <Select value={query.severity ?? ""} onChange={(e) => set("severity", e.target.value || undefined)} className="w-40" aria-label="Severity">
          <option value="">All severities</option>
          {(["S1", "S2", "S3"] as const).map((s) => (
            <option key={s} value={s}>
              {s} · {SEVERITY[s].sla.toLowerCase()}
            </option>
          ))}
        </Select>
        <Select value={query.team ?? ""} onChange={(e) => set("team", e.target.value || undefined)} className="w-44" aria-label="Team">
          <option value="">All teams</option>
          {TEAMS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </Select>
        <Select value={query.owner ?? ""} onChange={(e) => set("owner", e.target.value || undefined)} className="w-44" aria-label="Owner">
          <option value="">All owners</option>
          <option value="none">No owner</option>
          {owners.data?.owners.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </Select>
        {query.siteId && (
          <Badge tone="accent" icon={false} className="gap-1.5">
            Site: {siteName ?? "selected"}
            <button type="button" aria-label="Clear site filter" onClick={() => set("siteId", undefined)}>
              <X className="size-3.5" />
            </button>
          </Badge>
        )}
        <span className="ml-auto text-xs text-muted-foreground">{data ? `${rows.length} of ${data.total} findings` : ""}</span>
      </div>
      {!data ? (
        <Skeleton className="h-96 w-full" />
      ) : rows.length === 0 ? (
        <Card>
          <p className="p-6 text-center text-sm text-muted-foreground">No findings here.</p>
        </Card>
      ) : (
        <Card>
          <ul className="divide-y divide-border">
            {rows.map((f) => (
              <li key={f.id}>
                <button type="button" onClick={() => set("open", f.id)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 text-left hover:bg-secondary">
                  <span className={cn("h-9 w-0.5 shrink-0 rounded-full", f.severity === "S1" ? "bg-destructive" : f.severity === "S2" ? "bg-warning" : "bg-border")} aria-hidden />
                  <SeverityBadge s={f.severity} />
                  <span className="min-w-56 flex-1">
                    <span className="block text-sm font-medium text-foreground">{f.title}</span>
                    <span className="block text-xs text-muted-foreground">
                      {f.site.name} · {f.site.domain} · {fmtAgo(f.detectedAt)}
                      {f.overdue && <span className="text-text-destructive"> · past SLA</span>}
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <Badge tone="neutral" icon={false}>
                      {f.team}
                    </Badge>
                    <Badge tone={f.confidence === "High" ? "success" : "neutral"} icon={false}>
                      Confidence: {f.confidence}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      Impact {f.impact} · Effort {f.effort}
                    </span>
                    <StateBadge s={f.state} />
                    {f.owner && <span className="text-xs text-muted-foreground">{f.owner.name}</span>}
                    {f.isDemo && <DemoBadge />}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <FindingDrawer finding={open} owners={owners.data?.owners ?? []} onClose={() => set("open", undefined)} />
    </>
  );
}

const NEXT: Partial<Record<FindingState, { state: string; label: string; outcome?: "dismissed"; variant?: "default" | "outline" | "ghost" }[]>> = {
  detected: [{ state: "task_created", label: "Create task" }, { state: "closed", label: "Dismiss", outcome: "dismissed", variant: "ghost" }],
  recommended: [{ state: "task_created", label: "Create task" }, { state: "closed", label: "Dismiss", outcome: "dismissed", variant: "ghost" }],
  task_created: [{ state: "in_progress", label: "Start work" }, { state: "awaiting_verification", label: "Mark fixed", variant: "outline" }, { state: "closed", label: "Dismiss", outcome: "dismissed", variant: "ghost" }],
  in_progress: [{ state: "awaiting_verification", label: "Mark fixed" }, { state: "closed", label: "Dismiss", outcome: "dismissed", variant: "ghost" }],
  awaiting_verification: [{ state: "in_progress", label: "Back to in progress", variant: "outline" }],
  closed: [{ state: "recommended", label: "Reopen", variant: "outline" }],
};

function FindingDrawer({ finding: f, owners, onClose }: { finding: Finding | null; owners: { id: string; name: string | null }[]; onClose: () => void }) {
  const update = useUpdateFinding();
  const { toast } = useToast();
  const [note, setNote] = useState("");
  useEffect(() => setNote(""), [f?.id]);
  if (!f) return <Dialog open={false} onClose={onClose} />;
  const act = (body: { state?: string; outcome?: "fixed" | "dismissed"; ownerId?: string | null; note?: string }, ok: string) =>
    update.mutate(
      { id: f.id, ...body },
      {
        onSuccess: () => {
          setNote("");
          toast({ variant: "success", title: ok });
        },
        onError: (e) => toast({ variant: "error", title: "Couldn't update", description: e.messages?.[0] ?? e.message }),
      },
    );
  const evidence = Object.entries(f.evidence ?? {}).filter(([, v]) => v != null && v !== "" && !(Array.isArray(v) && v.length === 0));

  return (
    <Dialog open onClose={onClose} title={f.title} description={`${f.site.name} · ${f.site.domain}`} size="xl">
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-1.5">
          <SeverityBadge s={f.severity} />
          <StateBadge s={f.state} />
          {f.outcome && <Badge tone="neutral" icon={false}>{OUTCOME[f.outcome]}</Badge>}
          <Badge tone="neutral" icon={false}>{f.team}</Badge>
          <span className="text-xs text-muted-foreground">
            Confidence {f.confidence} · Impact {f.impact} · Effort {f.effort}
          </span>
        </div>
        <Block label="What happened">{f.detail}</Block>
        {evidence.length > 0 && (
          <Block label="Evidence">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              {evidence.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="break-all text-foreground">{Array.isArray(v) ? v.join(", ") : String(v)}</dd>
                </div>
              ))}
            </dl>
          </Block>
        )}
        <Block label="Recommended fix">{f.recommendation}</Block>
        {f.pageUrl && (
          <a href={f.pageUrl} target="_blank" rel="noreferrer" className="inline-flex w-fit items-center gap-1 text-sm text-primary hover:underline">
            Open the page <ArrowUpRight className="size-3.5" />
          </a>
        )}
        <div className="grid grid-cols-2 gap-3 text-xs">
          <Block label="Detected">{fmtDateTime(f.detectedAt)}</Block>
          <Block label="Respond by">
            <span className={cn(f.overdue && "text-text-destructive")}>
              {fmtDateTime(f.slaDue)} · {SEVERITY[f.severity].sla.toLowerCase()}
            </span>
          </Block>
        </div>
        <Field label="Owner">
          <Select value={f.owner?.id ?? ""} onChange={(e) => act({ ownerId: e.target.value || null }, "Owner updated")} aria-label="Owner">
            <option value="">No owner</option>
            {owners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Note" hint="Saved with the next action, or on its own.">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="What was done, what's blocking…" />
        </Field>
        <div className="flex flex-wrap gap-2">
          {(NEXT[f.state] ?? []).map((n) => (
            <Button
              key={n.label}
              variant={n.variant ?? "default"}
              loading={update.isPending}
              onClick={() => act({ state: n.state, outcome: n.outcome, note: note || undefined }, n.label === "Mark fixed" ? "Marked fixed — the next sync verifies it" : `${n.label}: done`)}
            >
              {n.label}
            </Button>
          ))}
          {note.trim() && (
            <Button variant="outline" loading={update.isPending} onClick={() => act({ note }, "Note saved")}>
              Save note
            </Button>
          )}
        </div>
        {f.state === "awaiting_verification" && <p className="text-xs text-muted-foreground">The next sync re-checks this. If it&apos;s still there, the finding goes back to in progress.</p>}
        {f.note && (
          <Block label="History">
            <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
              {f.note.split("\n").map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          </Block>
        )}
        <Link href={`/web/seo/sites/${f.site.id}`} className="text-xs font-medium text-primary hover:underline">
          Open the site scorecard
        </Link>
      </div>
    </Dialog>
  );
}

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm text-foreground">{children}</div>
    </div>
  );
}
