"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileChartColumn, Search } from "lucide-react";
import { Badge, Button, Card, ErrorState, Input, Select, Skeleton, StatTile, Tabs, TabsContent, TabsList, TabsTrigger, Table, TableBody, TableCell, TableHead, TableHeader, TableMessageRow, TableRow, useToast } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import { useGenerateReport, useReportsCenter, useSeoStatus, useSignOff } from "../api";
import { fmtDay, fmtNum, fmtRange, PACKAGE } from "../lib";
import type { Package, ReportsCenter } from "../types";
import { CoherencePreview, SchedulesPreview } from "./reports-preview";
import { AreaLine, ChangeText, Chip, DemoBadge, Segmented, HealthScore, InfoNote, PackageBadge, ReportStatusBadge, Section, SeverityBadge, cadenceLabel } from "./parts";
import { usePager } from "./pager";

const RANGES = [30, 90, 180] as const;

/** /web/seo/reports — Reports Center: what's due, what's waiting for sign-off, package trends. */
export function ReportsPage() {
  const [days, setDays] = useState<number>(30);
  const [tab, setTab] = useState("overview");
  const q = useReportsCenter(days);
  const d = q.data;

  if (q.error) return <ErrorState title="Couldn't load the Reports Center" description={q.error.message} />;
  if (!d) return <Skeleton className="h-96 w-full" />;
  const t = d.tiles;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1">
          <h2 className="text-base font-semibold text-foreground">Reporting Center</h2>
          <p className="text-xs text-muted-foreground">Innowi-branded, signed client reporting for every site — assembled automatically, signed off by a manager, then e-mailed.</p>
        </div>
        <Segmented label="Period" value={days} onChange={setDays} options={RANGES.map((r) => ({ value: r as number, label: `Last ${r} days` }))} />
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="projects" count={d.projects.length}>Projects &amp; Reports</TabsTrigger>
          <TabsTrigger value="signoff" count={t.awaitingSignoff + t.signed}>Sign-off</TabsTrigger>
          <TabsTrigger value="schedules">Schedules</TabsTrigger>
          <TabsTrigger value="coherence">Coherence</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="flex flex-col gap-5 pt-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Sent" value={t.sent} status={`of ${t.total} reports in the period`} />
        <StatTile label="Awaiting sign-off" value={t.awaitingSignoff} tone={t.awaitingSignoff ? "warning" : "neutral"} status={t.awaitingSignoff ? "Review and sign off" : "Nothing waiting"} />
        <StatTile label="Signed, not sent" value={t.signed} tone={t.signed ? "warning" : "neutral"} />
        <StatTile label="Delivery failed" value={t.failed} tone={t.failed ? "danger" : "ok"} status={t.failed ? "Check the recipients" : "No failures"} />
        <StatTile label="Due ≤ 7 days" value={t.due7} status={t.overdue ? `${t.overdue} overdue` : "None overdue"} tone={t.overdue ? "danger" : "neutral"} />
        <StatTile label="Auto-assembled" value={t.autoAssembled} hint="The daily sync assembles a report once its period's data is complete. A manager still signs it off before it's sent." />
      </div>
      {!d.emailConfigured && (
        <InfoNote>
          Email sending isn&apos;t set up yet, so reports can be assembled, signed off and printed to PDF but not e-mailed.{" "}
          <Link href="/settings/integrations#seo-email" className="font-medium text-primary hover:underline">
            Set it up in Settings → Integrations
          </Link>
        </InfoNote>
      )}
      <Section title="Packages" aside={<span className="text-xs text-muted-foreground">Organic clicks per week, all active sites in the package</span>}>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {d.packages.map((p) => (
            <Card key={p.key} className="flex flex-col gap-3 p-4">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-foreground">{p.label}</span>
                <span className="ml-auto text-xs text-muted-foreground">{p.projects} sites</span>
              </div>
              <div className="text-xs text-muted-foreground">{p.reports}</div>
              {p.series.length ? <AreaLine values={p.series} /> : <div className="grid h-[72px] place-items-center text-xs text-muted-foreground">No data</div>}
              <div className="flex items-baseline gap-2">
                <span className="text-lg font-semibold tabular-nums text-foreground">{fmtNum(p.avgClicks4w)}</span>
                <span className="text-xs text-muted-foreground">avg clicks / site / week (4 wk)</span>
                <ChangeText v={p.change} className="ml-auto" />
              </div>
            </Card>
          ))}
        </div>
      </Section>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-[repeat(2,minmax(0,1fr))]">
        <RiskTable rows={d.topRisk} />
        <PerformingTable rows={d.topPerforming} />
      </div>
        </TabsContent>
        <TabsContent value="projects" className="flex flex-col gap-5 pt-4">
          {tab === "projects" && <Projects d={d} />}
        </TabsContent>
        <TabsContent value="signoff" className="flex flex-col gap-5 pt-4">
          {tab === "signoff" && <SignoffQueue d={d} />}
        </TabsContent>
        <TabsContent value="schedules" className="flex flex-col gap-5 pt-4">
          {tab === "schedules" && <SchedulesPreview />}
        </TabsContent>
        <TabsContent value="coherence" className="flex flex-col gap-5 pt-4">
          {tab === "coherence" && <CoherencePreview />}
        </TabsContent>
      </Tabs>
    </>
  );
}

function RiskTable({ rows }: { rows: ReportsCenter["topRisk"] }) {
  return (
    <Section title="Top risk" aside={<span className="text-xs text-muted-foreground">Open S1/S2 findings, falling clicks, low health</span>}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Site</TableHead>
            <TableHead>Health</TableHead>
            <TableHead>Open</TableHead>
            <TableHead align="right">Clicks</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell>
                <SiteLink id={r.id} name={r.name} domain={r.domain} isDemo={r.isDemo} />
              </TableCell>
              <TableCell>
                <HealthScore score={r.health} />
              </TableCell>
              <TableCell>
                <span className="inline-flex gap-1">
                  {(["S1", "S2", "S3"] as const).map((s) => (r.open[s] ? <span key={s} className="inline-flex items-center gap-0.5"><SeverityBadge s={s} /><span className="text-xs tabular-nums">{r.open[s]}</span></span> : null))}
                </span>
              </TableCell>
              <TableCell align="right">
                <ChangeText v={r.clicksChange} />
              </TableCell>
              <TableCell align="right">
                <AssembleButton siteId={r.id} label="Report" />
              </TableCell>
            </TableRow>
          ))}
          {rows.length === 0 && <Empty cols={5}>No site at risk.</Empty>}
        </TableBody>
      </Table>
    </Section>
  );
}

function PerformingTable({ rows }: { rows: ReportsCenter["topPerforming"] }) {
  return (
    <Section title="Top performing" aside={<span className="text-xs text-muted-foreground">Biggest growth in organic clicks</span>}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Site</TableHead>
            <TableHead>Package</TableHead>
            <TableHead>Health</TableHead>
            <TableHead align="right">Clicks</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell>
                <SiteLink id={r.id} name={r.name} domain={r.domain} isDemo={r.isDemo} />
              </TableCell>
              <TableCell>
                <PackageBadge p={r.package} />
              </TableCell>
              <TableCell>
                <HealthScore score={r.health} />
              </TableCell>
              <TableCell align="right">
                <ChangeText v={r.clicksChange} />
              </TableCell>
              <TableCell align="right">
                <AssembleButton siteId={r.id} label="Report" />
              </TableCell>
            </TableRow>
          ))}
          {rows.length === 0 && <Empty cols={5}>Not enough data yet.</Empty>}
        </TableBody>
      </Table>
    </Section>
  );
}

function Projects({ d }: { d: ReportsCenter }) {
  const router = useRouter();
  const gen = useGenerateReport();
  const { toast } = useToast();
  const [pkg, setPkg] = useState<Package | "">("");
  const [search, setSearch] = useState("");
  const [rstatus, setRstatus] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const rows = useMemo(() => {
    const t = search.trim().toLowerCase();
    return d.projects
      .filter(
        (p) =>
          (!pkg || p.package === pkg) &&
          (!t || p.name.toLowerCase().includes(t) || p.domain.includes(t)) &&
          (!rstatus || (rstatus === "none" ? !p.latest : p.latest?.status === rstatus)),
      )
      .sort((a, b) => (a.due?.inDays ?? 999) - (b.due?.inDays ?? 999));
  }, [d.projects, pkg, search, rstatus]);
  const pg = usePager(rows);

  const assemble = (siteId: string, period?: { periodStart: string; periodEnd: string }) => {
    setBusy(siteId);
    gen.mutate(
      { siteId, period },
      {
        onSuccess: (r) => router.push(`/web/seo/reports/${r.id}`),
        onError: (e) => toast({ variant: "error", title: "Couldn't assemble the report", description: e.messages?.[0] ?? e.message }),
        onSettled: () => setBusy(null),
      },
    );
  };

  return (
    <Section title="Projects" aside={<span className="text-xs text-muted-foreground">Next report per site, soonest first</span>}>
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative w-full max-w-xs">
          <span className="sr-only">Search sites</span>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Site or domain" className="pl-8" />
        </label>
        <Select value={rstatus} onChange={(e) => setRstatus(e.target.value)} className="w-48" aria-label="Report status">
          <option value="">Any report status</option>
          <option value="awaiting_signoff">Awaiting sign-off</option>
          <option value="signed">Signed off</option>
          <option value="sent">Sent</option>
          <option value="failed">Delivery failed</option>
          <option value="none">No report yet</option>
        </Select>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Package">
          <Chip on={pkg === ""} onClick={() => setPkg("")} count={d.projects.length}>
            All
          </Chip>
          {(Object.keys(PACKAGE) as Package[]).map((k) => (
            <Chip key={k} on={pkg === k} onClick={() => setPkg(k)} count={d.projects.filter((p) => p.package === k).length}>
              {PACKAGE[k].label}
            </Chip>
          ))}
        </div>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-56">Site</TableHead>
            <TableHead>Package</TableHead>
            <TableHead>Cadence</TableHead>
            <TableHead>Health</TableHead>
            <TableHead>Latest report</TableHead>
            <TableHead>Next period</TableHead>
            <TableHead>Due</TableHead>
            <TableHead align="right">Recipients</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {pg.rows.map((p) => (
            <TableRow key={p.id}>
              <TableCell>
                <SiteLink id={p.id} name={p.name} domain={p.domain} isDemo={p.isDemo} />
                {p.status === "paused" && (
                  <Badge tone="neutral" className="mt-1">
                    Paused
                  </Badge>
                )}
              </TableCell>
              <TableCell>
                <PackageBadge p={p.package} />
              </TableCell>
              <TableCell className="text-xs">{cadenceLabel(p.cadence)}</TableCell>
              <TableCell>
                <HealthScore score={p.health} />
              </TableCell>
              <TableCell>
                {p.latest ? (
                  <Link href={`/web/seo/reports/${p.latest.id}`} className="flex flex-col gap-1 hover:underline">
                    <span className="text-xs text-foreground">{p.latest.label ?? fmtRange(p.latest.periodStart, p.latest.periodEnd)}</span>
                    <ReportStatusBadge s={p.latest.status} />
                  </Link>
                ) : (
                  <span className="text-xs text-muted-foreground">None yet</span>
                )}
              </TableCell>
              <TableCell className="whitespace-nowrap text-xs">{p.due ? fmtRange(p.due.periodStart, p.due.periodEnd) : "—"}</TableCell>
              <TableCell className="whitespace-nowrap text-xs">
                {p.due ? (
                  <span className={cn(p.due.inDays < 0 ? "text-text-destructive" : p.due.inDays <= 7 ? "text-warning-text" : "text-muted-foreground")}>
                    {fmtDay(p.due.due)} · {p.due.inDays < 0 ? `${-p.due.inDays} d overdue` : p.due.inDays === 0 ? "today" : `in ${p.due.inDays} d`}
                  </span>
                ) : (
                  "—"
                )}
              </TableCell>
              <TableCell align="right">
                {p.recipients ? p.recipients : <span className="text-xs text-warning-text" title="Add recipients in SEO → Site settings">None</span>}
              </TableCell>
              <TableCell align="right">
                {p.due?.reportId ? (
                  <Link href={`/web/seo/reports/${p.due.reportId}`} className="whitespace-nowrap text-xs font-medium text-primary hover:underline">
                    Open
                  </Link>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    loading={busy === p.id}
                    disabled={!!busy}
                    onClick={() => assemble(p.id, p.due ? { periodStart: p.due.periodStart, periodEnd: p.due.periodEnd } : undefined)}
                  >
                    <FileChartColumn className="size-4" />
                    Assemble
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
          {rows.length === 0 && <Empty cols={9}>No sites match.</Empty>}
        </TableBody>
      </Table>
      {pg.bar}
    </Section>
  );
}

function SiteLink({ id, name, domain, isDemo }: { id: string; name: string; domain: string; isDemo: boolean }) {
  return (
    <Link href={`/web/seo/sites/${id}`} className="flex flex-col hover:underline">
      <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
        {name}
        {isDemo && <DemoBadge />}
      </span>
      <span className="text-xs text-muted-foreground">{domain}</span>
    </Link>
  );
}

function Empty({ cols, children }: { cols: number; children: React.ReactNode }) {
  return (
    <TableMessageRow colSpan={cols}>
      <p className="py-4 text-center text-sm text-muted-foreground">{children}</p>
    </TableMessageRow>
  );
}

/** "Generate report": assemble the site's due report and open it. */
function AssembleButton({ siteId, period, label = "Generate report" }: { siteId: string; period?: { periodStart: string; periodEnd: string }; label?: string }) {
  const router = useRouter();
  const gen = useGenerateReport();
  const { toast } = useToast();
  return (
    <Button
      size="sm"
      variant="outline"
      loading={gen.isPending}
      title="Generate this site's report"
      onClick={() =>
        gen.mutate(
          { siteId, period },
          {
            onSuccess: (r) => router.push(`/web/seo/reports/${r.id}`),
            onError: (e) => toast({ variant: "error", title: "Couldn't assemble the report", description: e.messages?.[0] ?? e.message }),
          },
        )
      }
    >
      <FileChartColumn className="size-4" />
      {label}
    </Button>
  );
}

/** Sign-off tab: every report waiting for a signature or ready to send. */
function SignoffQueue({ d }: { d: ReportsCenter }) {
  const rows = d.projects.filter((p) => p.latest && (p.latest.status === "awaiting_signoff" || p.latest.status === "signed" || p.latest.status === "failed"));
  const sign = useSignOff();
  const status = useSeoStatus();
  const { toast } = useToast();
  const pg = usePager(rows);
  return (
    <Section title="Sign-off queue" aside={<span className="text-xs text-muted-foreground">assembled → sign off → send · unsigned reports never send</span>}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-56">Site</TableHead>
            <TableHead>Package</TableHead>
            <TableHead>Report</TableHead>
            <TableHead>Status</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {pg.rows.map((p) => (
            <TableRow key={p.id}>
              <TableCell>
                <SiteLink id={p.id} name={p.name} domain={p.domain} isDemo={p.isDemo} />
              </TableCell>
              <TableCell>
                <PackageBadge p={p.package} />
              </TableCell>
              <TableCell className="text-xs">{p.latest!.label ?? fmtRange(p.latest!.periodStart, p.latest!.periodEnd)}</TableCell>
              <TableCell>
                <ReportStatusBadge s={p.latest!.status} />
              </TableCell>
              <TableCell align="right">
                <span className="inline-flex gap-2">
                  {p.latest!.status === "awaiting_signoff" && status.data?.canApprove && (
                    <Button
                      size="sm"
                      loading={sign.isPending && sign.variables === p.latest!.id}
                      onClick={() =>
                        sign.mutate(p.latest!.id, {
                          onSuccess: () => toast({ variant: "success", title: `${p.name}: signed off` }),
                          onError: (e) => toast({ variant: "error", title: "Couldn't sign off", description: e.messages?.[0] ?? e.message }),
                        })
                      }
                    >
                      Sign
                    </Button>
                  )}
                  <Link href={`/web/seo/reports/${p.latest!.id}`} className="inline-flex h-7 items-center rounded-sm border border-border bg-card px-2.5 text-xs font-medium hover:bg-accent">
                    {p.latest!.status === "awaiting_signoff" ? "Review" : "Open & send"}
                  </Link>
                </span>
              </TableCell>
            </TableRow>
          ))}
          {rows.length === 0 && <Empty cols={5}>Nothing waiting for sign-off.</Empty>}
        </TableBody>
      </Table>
      {pg.bar}
      <p className="text-xs text-muted-foreground">Every sign-off and send is recorded in the Audit Log.</p>
    </Section>
  );
}
