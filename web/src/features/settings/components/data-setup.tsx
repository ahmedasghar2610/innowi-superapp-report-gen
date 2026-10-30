"use client";

/**
 * Settings → Data setup (API: app/modules/linking).
 *  1. Refresh all data — starts the GBP, Google Ads and SEO refreshes (skips what isn't connected).
 *  2. Link all modules — preview, then link GBP listings, Ads accounts, Websites and SEO sites to merchants,
 *     create merchants from unmatched GBP listings, and give SEO sites their GBP listing / Ads account / GA4.
 *  3. Coverage — one row per merchant: what each module has, what's missing.
 * Links stay when a module is refreshed later; only empty links are ever filled.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, CircleCheck, CircleDashed, Link2, Plug, RefreshCw, Search, Undo2, X } from "lucide-react";
import {
  Badge,
  Button,
  Dialog,
  Input,
  Select,
  Skeleton,
  StatTile,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableMessageRow,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  useToast,
} from "@/components/ui";
import { api, type ApiError } from "@/lib/api/client";
import { queryKeys } from "@/lib/query/query-keys";
import { cn } from "@/lib/utils/cn";
import { SettingsCard } from "./settings-shell";

/* --------------------------------------------------------------- types ---- */

type ModuleKey = "gbp" | "ads" | "seo";
interface ModuleStatus {
  key: ModuleKey;
  label: string;
  state: "ready" | "not_connected" | "needs_keys";
  note: string | null;
  records: number;
  sampleRecords: number;
  lastRun: { status: string; startedAt: string; finishedAt: string | null; error: string | null } | null;
}
interface Status {
  modules: ModuleStatus[];
  lastLink: { id: string; at: string; summary: Record<string, number>; undone: boolean } | null;
}
interface MerchantRef {
  merchantId: string;
  name: string;
  city: string | null;
  code: string | null;
}
interface PlanItem {
  id: string;
  module: "gbp" | "ads" | "website" | "seo";
  entityId: string;
  entity: string;
  detail: string | null;
}
type SureItem = PlanItem & MerchantRef & { reasons: string[] };
type ReviewItem = PlanItem & {
  candidates: (MerchantRef & { score: number; reasons: string[] })[];
  canCreate?: boolean;
  manual?: boolean;
  note?: string;
  /** A candidate good enough to be pre-chosen (still changeable). */
  suggested?: string | null;
};
interface CreateGroup {
  id: string;
  /** "seo" = from an SEO site no merchant matches (with its Ads account); otherwise from GBP listings. */
  kind?: "seo";
  name: string;
  category: string | null;
  phone: string | null;
  ordering: string | null;
  website?: string;
  listings: { id: string; title: string; detail: string }[];
  seo?: { id: string; domain: string };
  ads?: { id: string; name: string; why: string } | null;
  /** Ticked by default (false = an SEO site with no Ads account: maybe not a client). */
  preselect?: boolean;
}
interface Plan {
  modules: Record<string, { total: number; linked: number; enabled?: boolean }>;
  sure: SureItem[];
  review: ReviewItem[];
  create: CreateGroup[];
  unmatched: PlanItem[];
  counts: { sure: number; review: number; create: number; createListings: number; unmatched: number };
  merchants: number;
}
interface CoverageRow {
  merchantId: string;
  name: string;
  code: string | null;
  websiteUrl: string | null;
  onlineOrdering: string | null;
  gbp: number;
  ads: number;
  websites: number;
  seoSites: number;
  gsc: boolean;
  ga4: boolean;
  domains: string[];
}
interface Coverage {
  rows: CoverageRow[];
  unlinked: { gbp: number; ads: number; website: number; seo: number };
  accessEmail: string | null;
}

const BASE = "/settings/data-setup";
const K = {
  status: [...queryKeys.settings.all, "data-setup", "status"] as const,
  plan: [...queryKeys.settings.all, "data-setup", "plan"] as const,
  coverage: [...queryKeys.settings.all, "data-setup", "coverage"] as const,
};
const MODULE_LABEL: Record<PlanItem["module"], string> = { gbp: "GBP listing", ads: "Ads account", website: "Website", seo: "SEO site" };

function fmtWhen(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function useInvalidateAll() {
  const qc = useQueryClient();
  return () => {
    for (const k of [K.status, K.plan, K.coverage, queryKeys.gbp.all, queryKeys.ads.all, queryKeys.seo.all, ["merchants"]]) void qc.invalidateQueries({ queryKey: k });
  };
}

/* ---------------------------------------------------------------- page ---- */

export function DataSetupPage() {
  const status = useQuery<Status, ApiError>({
    queryKey: K.status,
    queryFn: () => api.get<Status>(`${BASE}/status`),
    refetchInterval: (q) => (q.state.data?.modules.some((m) => m.lastRun?.status === "running") ? 4000 : false),
  });
  return (
    <>
      <ConnectorCard />
      <RefreshStep status={status.data} />
      <LinkStep status={status.data} />
      <CoverageStep />
    </>
  );
}

/** Settings → Integrations: short pointer to the full page. */
export function DataSetupPointer() {
  return (
    <SettingsCard
      title="Data setup — link all modules"
      description="Refresh GBP, Google Ads and SEO together, then link every listing, Ads account, website and SEO site to its merchant in one go — and see which merchant is missing what."
      action={
        <Link href="/settings/data-setup" className="inline-flex h-7 items-center gap-1 rounded-sm border border-border bg-card px-2.5 text-xs font-medium text-foreground hover:bg-accent">
          Open data setup
          <ArrowRight className="size-3.5" />
        </Link>
      }
    >
      <p className="text-xs text-muted-foreground">Links stay in place when a module is refreshed later; only empty links are ever filled.</p>
    </SettingsCard>
  );
}

/* ---------------------------------------------------------- connector ---- */

interface ConnectorSettings {
  modules: { seo: boolean; ads: boolean; gbp: boolean; website: boolean };
  autoLinkSure: boolean;
  runAfterCreate: boolean;
  offerCreateMerchants: boolean;
  ignoreDomains: string[];
  ignoreAdsNames: string[];
  extraStopWords: string[];
}
const CONNECTOR_KEY = [...queryKeys.settings.all, "connector"] as const;
const MODULE_TOGGLES: { key: keyof ConnectorSettings["modules"]; label: string; note?: string }[] = [
  { key: "seo", label: "SEO sites", note: "by domain = the merchant's website, or the domain spelling its name" },
  { key: "ads", label: "Google Ads accounts", note: "by account name" },
  { key: "website", label: "Websites (managed sites)", note: "by name / phone" },
  { key: "gbp", label: "GBP listings", note: "off while Google Business Profile access is pending" },
];

function Toggle({ on, onChange, label, note }: { on: boolean; onChange: (v: boolean) => void; label: string; note?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 text-sm">
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 size-4 accent-[var(--primary)]" />
      <span>
        <span className="font-medium text-foreground">{label}</span>
        {note && <span className="block text-xs text-muted-foreground">{note}</span>}
      </span>
    </label>
  );
}

const toList = (v: string) => v.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);

/** How merchants link themselves to the other modules (API: linking/connector.py). */
function ConnectorCard() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const q = useQuery<ConnectorSettings, ApiError>({ queryKey: CONNECTOR_KEY, queryFn: () => api.get<ConnectorSettings>("/settings/connector") });
  const [draft, setDraft] = useState<ConnectorSettings | null>(null);
  const [lists, setLists] = useState<{ ignoreDomains: string; ignoreAdsNames: string; extraStopWords: string } | null>(null);
  useEffect(() => {
    if (q.data && !draft) {
      setDraft(q.data);
      setLists({ ignoreDomains: q.data.ignoreDomains.join(", "), ignoreAdsNames: q.data.ignoreAdsNames.join(", "), extraStopWords: q.data.extraStopWords.join(", ") });
    }
  }, [q.data, draft]);
  const save = useMutation<ConnectorSettings, ApiError, ConnectorSettings>({
    mutationFn: (body) => api.put("/settings/connector", body),
    onSuccess: (v) => {
      qc.setQueryData(CONNECTOR_KEY, v);
      setDraft(v);
      setLists({ ignoreDomains: v.ignoreDomains.join(", "), ignoreAdsNames: v.ignoreAdsNames.join(", "), extraStopWords: v.extraStopWords.join(", ") });
      void qc.invalidateQueries({ queryKey: K.plan });
      void qc.invalidateQueries({ queryKey: ["merchants"] });
      toast({ variant: "success", title: "Connector saved" });
    },
    onError: (e) => toast({ variant: "error", title: "Couldn't save", description: e.messages?.[0] ?? e.message }),
  });

  if (q.error) return <p className="text-sm text-text-destructive">Couldn&apos;t load the connector settings: {q.error.message}</p>;
  if (!draft || !lists) return <Skeleton className="h-48 w-full" />;
  const set = (patch: Partial<ConnectorSettings>) => setDraft({ ...draft, ...patch });
  const full: ConnectorSettings = { ...draft, ignoreDomains: toList(lists.ignoreDomains), ignoreAdsNames: toList(lists.ignoreAdsNames), extraStopWords: toList(lists.extraStopWords) };
  const dirty = JSON.stringify(full) !== JSON.stringify(q.data);

  return (
    <SettingsCard
      title="Connector — how merchants link to the other modules"
      description="Each merchant is matched to SEO sites and Google Ads accounts from its own website and name. The same matching runs here (Link all), on each merchant's SEO / Google Ads tabs, from Connect all on the Merchants list, and right after a merchant is added or imported."
      action={
        <Button size="sm" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate(full)}>
          <Plug className="size-4" />
          Save
        </Button>
      }
    >
      <div className="grid gap-6 md:grid-cols-2">
        <div className="flex flex-col gap-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Link</p>
          {MODULE_TOGGLES.map((t) => (
            <Toggle key={t.key} on={draft.modules[t.key]} label={t.label} note={t.note} onChange={(v) => set({ modules: { ...draft.modules, [t.key]: v } })} />
          ))}
        </div>
        <div className="flex flex-col gap-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">When</p>
          <Toggle on={draft.autoLinkSure} onChange={(v) => set({ autoLinkSure: v })} label="Link sure matches without asking"
            note="Same domain, or the same name apart from words like “restaurant”. Close matches always wait for a person." />
          <Toggle on={draft.runAfterCreate} onChange={(v) => set({ runAfterCreate: v })} label="Right after a merchant is added or imported" />
          <Toggle on={draft.offerCreateMerchants} onChange={(v) => set({ offerCreateMerchants: v })} label="Offer new merchants for SEO sites no merchant matches"
            note="Named after the site's Google Ads account when one goes with it." />
        </div>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-foreground">Never match these domains</span>
          <Textarea rows={2} value={lists.ignoreDomains} onChange={(e) => setLists({ ...lists, ignoreDomains: e.target.value })} />
          <span className="text-xs text-muted-foreground">Comma separated. Subdomains count too (innowi.com covers blog.innowi.com).</span>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-foreground">Never link Ads accounts whose name contains</span>
          <Textarea rows={2} value={lists.ignoreAdsNames} onChange={(e) => setLists({ ...lists, ignoreAdsNames: e.target.value })} />
          <span className="text-xs text-muted-foreground">For Innowi&apos;s own accounts.</span>
        </label>
        <label className="flex flex-col gap-1 text-sm md:col-span-2">
          <span className="font-medium text-foreground">Also leave these words out when comparing names</span>
          <Input value={lists.extraStopWords} onChange={(e) => setLists({ ...lists, extraStopWords: e.target.value })} placeholder="e.g. express, cuisine" />
          <span className="text-xs text-muted-foreground">Already left out: the, and, restaurant, grill, kitchen, cafe, food, halal, authentic, bar, house, llc, inc.</span>
        </label>
      </div>
    </SettingsCard>
  );
}

/* --------------------------------------------------------- 1 · refresh ---- */

function ModuleState({ m }: { m: ModuleStatus }) {
  if (m.lastRun?.status === "running")
    return (
      <Badge tone="accent" icon={RefreshCw}>
        Refreshing…
      </Badge>
    );
  if (m.state === "ready")
    return (
      <Badge tone="success" icon={CircleCheck}>
        Connected
      </Badge>
    );
  if (m.state === "needs_keys")
    return (
      <Badge tone="warning" icon={CircleDashed}>
        Needs keys
      </Badge>
    );
  return (
    <Badge tone="neutral" icon={CircleDashed}>
      {m.key === "gbp" ? "Waiting for approval" : "Not connected"}
    </Badge>
  );
}

function RefreshStep({ status }: { status?: Status }) {
  const { toast } = useToast();
  const invalidate = useInvalidateAll();
  const refresh = useMutation<{ data: { key: ModuleKey; started: boolean; reason: string | null }[] }, ApiError>({
    mutationFn: () => api.postLong(`${BASE}/refresh`),
    onSuccess: (d) => {
      invalidate();
      const started = d.data.filter((x) => x.started).length;
      toast({
        variant: started ? "success" : "warning",
        title: started ? `Refreshing ${started} module${started > 1 ? "s" : ""}` : "Nothing refreshed",
        description: d.data.filter((x) => !x.started).map((x) => `${x.key.toUpperCase()}: ${x.reason}`).join(" · ") || "Step 2 can run when they finish.",
      });
    },
    onError: (e) => toast({ variant: "error", title: "Couldn't start the refresh", description: e.messages?.[0] ?? e.message }),
  });
  const running = status?.modules.some((m) => m.lastRun?.status === "running");
  const anyReady = status?.modules.some((m) => m.state === "ready");

  return (
    <SettingsCard
      title="1 · Refresh all data"
      description="Runs each module's own refresh — the same as its Refresh button — so step 2 links the newest listings, accounts and sites. Modules that aren't connected are skipped."
      action={
        <Button size="sm" loading={refresh.isPending || running} disabled={!anyReady} onClick={() => refresh.mutate()} title={anyReady ? undefined : "No module can refresh right now"}>
          <RefreshCw className="size-4" />
          {running ? "Refreshing…" : "Refresh all"}
        </Button>
      }
    >
      {!status ? (
        <Skeleton className="h-32 w-full" />
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {status.modules.map((m) => (
              <div key={m.key} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2.5 text-sm">
                <span className="w-48 font-medium text-foreground">{m.label}</span>
                <ModuleState m={m} />
                <span className="text-xs text-muted-foreground">
                  {m.records.toLocaleString()} {m.key === "gbp" ? "listings" : m.key === "ads" ? "accounts" : "sites"}
                  {m.sampleRecords > 0 && ` · ${m.sampleRecords} sample (ignored)`}
                </span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {m.lastRun ? (
                    <>
                      Last refresh {fmtWhen(m.lastRun.finishedAt ?? m.lastRun.startedAt)} ·{" "}
                      <span className={cn(m.lastRun.status === "failed" && "text-text-destructive")}>{m.lastRun.status}</span>
                    </>
                  ) : (
                    "Never refreshed"
                  )}
                </span>
                {m.note && m.state !== "ready" && <span className="basis-full text-xs text-muted-foreground">{m.note}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </SettingsCard>
  );
}

/* ------------------------------------------------------------ 2 · link ---- */

function LinkStep({ status }: { status?: Status }) {
  const { toast } = useToast();
  const invalidate = useInvalidateAll();
  const [load, setLoad] = useState(false);
  const plan = useQuery<Plan, ApiError>({ queryKey: K.plan, queryFn: () => api.get<Plan>(`${BASE}/plan`), enabled: load });
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [skipCreate, setSkipCreate] = useState<string[]>([]);
  const [confirmUndo, setConfirmUndo] = useState(false);

  const apply = useMutation<{ id: string; summary: Record<string, number> }, ApiError>({
    mutationFn: () =>
      api.post(`${BASE}/apply`, {
        decisions: effective,
        create: plan.data ? plan.data.create.map((g) => g.id).filter((id) => !skipCreate.includes(id)) : undefined,
      }),
    onSuccess: (d) => {
      setChoices({});
      setSkipCreate([]);
      invalidate();
      const s = d.summary;
      toast({
        variant: "success",
        title: "Modules linked",
        description:
          [s.gbp && `${s.gbp} GBP listings`, s.ads && `${s.ads} Ads accounts`, s.website && `${s.website} websites`, s.seo && `${s.seo} SEO sites`, s.merchantsCreated && `${s.merchantsCreated} merchants created`]
            .filter(Boolean)
            .join(" · ") || "Nothing new to link.",
      });
    },
    onError: (e) => toast({ variant: "error", title: "Couldn't link", description: e.messages?.[0] ?? e.message }),
  });
  const undo = useMutation<{ undone: number; kept: string[] }, ApiError>({
    mutationFn: () => api.post(`${BASE}/undo`),
    onSuccess: (d) => {
      setConfirmUndo(false);
      invalidate();
      toast({ variant: "success", title: `Undone (${d.undone} changes)`, description: d.kept.length ? `Kept because they were edited since: ${d.kept.join(", ")}` : undefined });
    },
    onError: (e) => toast({ variant: "error", title: "Couldn't undo", description: e.messages?.[0] ?? e.message }),
  });

  const d = plan.data;
  // New merchants from an SEO site with no Ads account start unticked; good review candidates start chosen.
  useEffect(() => {
    if (d) setSkipCreate(d.create.filter((g) => g.preselect === false).map((g) => g.id));
  }, [d]);
  const effective = useMemo(() => {
    const out: Record<string, string> = {};
    for (const r of d?.review ?? []) {
      const v = choices[r.id] ?? r.suggested ?? undefined;
      if (v && !r.manual) out[r.id] = v;
    }
    return out;
  }, [d, choices]);
  const picked = d ? d.review.filter((r) => effective[r.id] && effective[r.id] !== "skip").length : 0;
  const creating = d ? d.create.filter((g) => !skipCreate.includes(g.id)) : [];
  const last = status?.lastLink;

  return (
    <SettingsCard
      title="2 · Link all modules"
      description="Matches every SEO site, Ads account, website (and GBP listing, when it's on in the Connector) to its merchant, offers new merchants for SEO sites and listings that have none, and gives each SEO site its Ads account and GA4 property. Only empty links are filled — anything linked by hand stays as it is — and sample data is ignored."
      action={
        <Button size="sm" variant={d ? "outline" : "default"} loading={plan.isFetching} onClick={() => (load ? void plan.refetch() : setLoad(true))}>
          <Search className="size-4" />
          {d ? "Check again" : "Find links"}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        {last && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>
              Last run {fmtWhen(last.at)}: {last.summary.gbp ?? 0} listings · {last.summary.ads ?? 0} Ads accounts · {last.summary.website ?? 0} websites · {last.summary.seo ?? 0} SEO
              sites · {last.summary.merchantsCreated ?? 0} merchants created{last.undone && " (undone)"}
            </span>
            {!last.undone && (
              <Button size="xs" variant="ghost" onClick={() => setConfirmUndo(true)}>
                <Undo2 className="size-3.5" />
                Undo last run
              </Button>
            )}
          </div>
        )}
        {!load ? (
          <p className="text-sm text-muted-foreground">
            Click <b>Find links</b> to see what would be linked. Nothing changes until you press <b>Link</b>.
          </p>
        ) : !d ? (
          <Skeleton className="h-48 w-full" />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatTile label="Sure matches" value={d.counts.sure} tone={d.counts.sure ? "ok" : "neutral"} status="Linked when you press Link" />
              <StatTile label="To review" value={d.counts.review} tone={d.counts.review ? "warning" : "neutral"} status={d.counts.review ? `${picked} chosen` : "Nothing to review"} />
              <StatTile label="New merchants" value={creating.length} status={`of ${d.create.length} offered`} />
              <StatTile label="No match" value={d.counts.unmatched} status="Link by hand in the module" />
            </div>
            <ModuleProgress d={d} />
            <PlanTabs d={d} choices={effective} setChoices={(v) => setChoices({ ...choices, ...v })} skipCreate={skipCreate} setSkipCreate={setSkipCreate} />
            <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
              <Button loading={apply.isPending} disabled={!d.counts.sure && !picked && !creating.length} onClick={() => apply.mutate()}>
                <Link2 className="size-4" />
                Link {d.counts.sure + picked} · create {creating.length} merchant{creating.length === 1 ? "" : "s"}
              </Button>
              <span className="text-xs text-muted-foreground">
                Links stay when a module is refreshed later.
              </span>
            </div>
          </>
        )}
      </div>
      <Dialog
        open={confirmUndo}
        onClose={() => setConfirmUndo(false)}
        tone="danger"
        title="Undo the last link run?"
        description="Every link it filled is emptied again and the merchants it created are removed (unless someone edited them since). Links made by hand or by earlier runs stay."
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmUndo(false)}>
              Cancel
            </Button>
            <Button variant="destructive" loading={undo.isPending} onClick={() => undo.mutate()}>
              Undo
            </Button>
          </>
        }
      />
    </SettingsCard>
  );
}

function ModuleProgress({ d }: { d: Plan }) {
  const rows: [string, { total: number; linked: number; enabled?: boolean }][] = [
    ["GBP listings", d.modules.gbp],
    ["Ads accounts", d.modules.ads],
    ["Websites", d.modules.website],
    ["SEO sites", d.modules.seo],
  ];
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
      <span>{d.merchants} merchants</span>
      {rows.map(([label, m]) =>
        m.enabled === false ? (
          <span key={label}>{label}: off</span>
        ) : (
          <span key={label}>
            {label}: <b className="text-foreground">{m.linked}</b> of {m.total} linked
          </span>
        ),
      )}
    </div>
  );
}

function PlanTabs({
  d,
  choices,
  setChoices,
  skipCreate,
  setSkipCreate,
}: {
  d: Plan;
  choices: Record<string, string>;
  setChoices: (v: Record<string, string>) => void;
  skipCreate: string[];
  setSkipCreate: (v: string[]) => void;
}) {
  const first = d.review.length ? "review" : d.create.length ? "create" : "sure";
  const [tab, setTab] = useState(first);
  return (
    <Tabs value={tab} onValueChange={setTab} className="flex flex-col gap-3">
      <TabsList>
        <TabsTrigger value="review" count={d.review.length}>
          To review
        </TabsTrigger>
        <TabsTrigger value="create" count={d.create.length}>
          New merchants
        </TabsTrigger>
        <TabsTrigger value="sure" count={d.sure.length}>
          Sure matches
        </TabsTrigger>
        <TabsTrigger value="unmatched" count={d.unmatched.length}>
          No match
        </TabsTrigger>
      </TabsList>
      <TabsContent value="review">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Module</TableHead>
              <TableHead className="min-w-56">Record</TableHead>
              <TableHead className="min-w-72">Link to</TableHead>
              <TableHead>Why</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {d.review.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <Badge tone="outline" icon={false}>
                    {MODULE_LABEL[r.module]}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="font-medium text-foreground">{r.entity}</div>
                  {r.detail && <div className="text-xs text-muted-foreground">{r.detail}</div>}
                </TableCell>
                <TableCell>
                  {r.manual ? (
                    <div className="flex flex-col gap-1 text-xs">
                      <span className="text-foreground">{r.candidates[0]?.name}</span>
                      <span className="text-muted-foreground">{r.note}</span>
                      <Link href="/web/website" className="font-medium text-primary hover:underline">
                        Open Websites
                      </Link>
                    </div>
                  ) : (
                    <Select value={choices[r.id] ?? "skip"} onChange={(e) => setChoices({ ...choices, [r.id]: e.target.value })} aria-label={`Link ${r.entity}`}>
                      <option value="skip">Skip for now</option>
                      {r.candidates.map((c) => (
                        <option key={c.merchantId} value={c.merchantId}>
                          {c.name}
                          {c.city ? ` · ${c.city}` : ""}
                        </option>
                      ))}
                      {r.canCreate && <option value="create">Create a new merchant from this listing</option>}
                    </Select>
                  )}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{r.candidates[0]?.reasons.join(", ")}</TableCell>
              </TableRow>
            ))}
            {d.review.length === 0 && <Empty cols={4} text="Nothing needs a decision." />}
          </TableBody>
        </Table>
      </TabsContent>
      <TabsContent value="create">
        <p className="mb-2 text-xs text-muted-foreground">
          SEO sites no merchant matches become a merchant named after its Google Ads account (when one goes with the site) with the site as its website; sites with no
          Ads account start unticked. GBP listings (when GBP is on) become one merchant per name, filled from Google. Untick any you don&apos;t want.
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10" />
              <TableHead className="min-w-56">New merchant</TableHead>
              <TableHead>From</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Phone</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {d.create.map((g) => {
              const on = !skipCreate.includes(g.id);
              return (
                <TableRow key={g.id}>
                  <TableCell>
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => setSkipCreate(on ? [...skipCreate, g.id] : skipCreate.filter((x) => x !== g.id))}
                      aria-label={`Create ${g.name}`}
                      className="size-4 accent-[var(--primary)]"
                    />
                  </TableCell>
                  <TableCell className="font-medium">{g.name}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {g.kind === "seo" ? (
                      <>
                        SEO site {g.seo?.domain}
                        {g.ads ? <> · Ads account {g.ads.name} <span className="text-muted-foreground">({g.ads.why.toLowerCase()})</span></> : " · no Ads account"}
                      </>
                    ) : (
                      g.listings.map((l) => l.detail || l.title).join(" · ")
                    )}
                  </TableCell>
                  <TableCell className="text-xs">{g.category ?? "—"}</TableCell>
                  <TableCell className="whitespace-nowrap text-xs">{g.phone ?? "—"}</TableCell>
                </TableRow>
              );
            })}
            {d.create.length === 0 && <Empty cols={5} text="Every SEO site and GBP listing has a merchant or a suggestion." />}
          </TableBody>
        </Table>
      </TabsContent>
      <TabsContent value="sure">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Module</TableHead>
              <TableHead className="min-w-56">Record</TableHead>
              <TableHead className="min-w-56">Merchant</TableHead>
              <TableHead>Why</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {d.sure.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <Badge tone="outline" icon={false}>
                    {MODULE_LABEL[r.module]}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="font-medium text-foreground">{r.entity}</div>
                  {r.detail && <div className="text-xs text-muted-foreground">{r.detail}</div>}
                </TableCell>
                <TableCell>
                  <span className="inline-flex items-center gap-1.5">
                    <Check className="size-3.5 text-success-subtle-foreground" />
                    {r.name}
                    {r.city && <span className="text-xs text-muted-foreground">· {r.city}</span>}
                  </span>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{r.reasons.join(", ")}</TableCell>
              </TableRow>
            ))}
            {d.sure.length === 0 && <Empty cols={4} text="No sure matches right now." />}
          </TableBody>
        </Table>
      </TabsContent>
      <TabsContent value="unmatched">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Module</TableHead>
              <TableHead className="min-w-56">Record</TableHead>
              <TableHead>Where to link it</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {d.unmatched.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <Badge tone="outline" icon={false}>
                    {MODULE_LABEL[r.module]}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="font-medium text-foreground">{r.entity}</div>
                  {r.detail && <div className="text-xs text-muted-foreground">{r.detail}</div>}
                </TableCell>
                <TableCell>
                  <Link href={WHERE[r.module]} className="text-xs font-medium text-primary hover:underline">
                    {WHERE_LABEL[r.module]}
                  </Link>
                </TableCell>
              </TableRow>
            ))}
            {d.unmatched.length === 0 && <Empty cols={3} text="Everything has a match." />}
          </TableBody>
        </Table>
      </TabsContent>
    </Tabs>
  );
}

const WHERE: Record<PlanItem["module"], string> = { gbp: "/web/gbp", ads: "/ads/unmapped", website: "/web/website", seo: "/web/seo/site-settings" };
const WHERE_LABEL: Record<PlanItem["module"], string> = { gbp: "GBP → listing", ads: "Ads → Unmapped accounts", website: "Websites", seo: "SEO → Site settings" };

function Empty({ cols, text }: { cols: number; text: string }) {
  return (
    <TableMessageRow colSpan={cols}>
      <p className="py-4 text-center text-sm text-muted-foreground">{text}</p>
    </TableMessageRow>
  );
}

/* -------------------------------------------------------- 3 · coverage ---- */

type CovFilter = "" | "missing" | "nogbp" | "noads" | "noseo" | "noga4";

/** Icons are block-level SVGs, so wrap them to sit centred like the text cells. */
function Tick({ on, title }: { on: boolean; title?: string }) {
  return (
    <span className="inline-flex justify-center" title={on ? undefined : title}>
      {on ? <Check className="size-4 text-success-subtle-foreground" aria-label="Yes" /> : <X className="size-4 text-muted-foreground/60" aria-label={title ?? "No"} />}
    </span>
  );
}

const Dash = () => <span className="text-xs text-muted-foreground">—</span>;

function SiteLink({ url, label }: { url: string; label: string }) {
  return (
    <a
      href={/^https?:\/\//i.test(url) ? url : `https://${url}`}
      target="_blank"
      rel="noreferrer"
      className="block max-w-48 truncate text-xs text-muted-foreground hover:text-foreground hover:underline"
      title={url}
    >
      {label}
    </a>
  );
}

function CoverageStep() {
  const q = useQuery<Coverage, ApiError>({ queryKey: K.coverage, queryFn: () => api.get<Coverage>(`${BASE}/coverage`) });
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<CovFilter>("");
  const [page, setPage] = useState(0);
  const rows = useMemo(() => {
    const t = search.trim().toLowerCase();
    return (q.data?.rows ?? []).filter(
      (r) =>
        (!t || r.name.toLowerCase().includes(t) || (r.code ?? "").toLowerCase().includes(t)) &&
        (filter === ""
          ? true
          : filter === "missing"
            ? !r.gbp || !r.seoSites || !r.ga4 || !r.gsc
            : filter === "nogbp"
              ? !r.gbp
              : filter === "noads"
                ? !r.ads
                : filter === "noseo"
                  ? !r.seoSites
                  : !r.ga4),
    );
  }, [q.data, search, filter]);
  const PAGE = 25;
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const slice = rows.slice(page * PAGE, page * PAGE + PAGE);
  const c = q.data;

  return (
    <SettingsCard
      title="3 · Coverage"
      description="What each merchant has in every module. Not running ads or no website is normal; missing Search Console or GA4 usually means the client hasn't given access yet."
    >
      {!c ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">
            Not linked to any merchant yet: <b className="text-foreground">{c.unlinked.gbp}</b> GBP listings · <b className="text-foreground">{c.unlinked.ads}</b> Ads accounts ·{" "}
            <b className="text-foreground">{c.unlinked.website}</b> websites · <b className="text-foreground">{c.unlinked.seo}</b> SEO sites.
            {c.accessEmail && (
              <>
                {" "}
                For missing Search Console / GA4, ask the client to add <b className="text-foreground">{c.accessEmail}</b> (Search Console user · GA4 Viewer).
              </>
            )}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative w-full max-w-xs">
              <span className="sr-only">Search merchants</span>
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(0);
                }}
                placeholder="Merchant or code"
                className="pl-8"
              />
            </label>
            <Select
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value as CovFilter);
                setPage(0);
              }}
              className="w-56"
              aria-label="Filter"
            >
              <option value="">All merchants ({c.rows.length})</option>
              <option value="missing">Missing GBP, SEO, Search Console or GA4</option>
              <option value="nogbp">No GBP listing</option>
              <option value="noads">No Ads account</option>
              <option value="noseo">No SEO site</option>
              <option value="noga4">No GA4</option>
            </Select>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-40">Merchant</TableHead>
                <TableHead align="center">GBP</TableHead>
                <TableHead align="center">Ads</TableHead>
                <TableHead>Website</TableHead>
                <TableHead>SEO site</TableHead>
                <TableHead align="center">Search Console</TableHead>
                <TableHead align="center">GA4</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {slice.map((r) => (
                <TableRow key={r.merchantId}>
                  <TableCell>
                    <Link href={`/merchants/${r.merchantId}`} className="font-medium text-foreground hover:underline">
                      {r.name}
                    </Link>
                    {r.code && <span className="ml-1.5 text-xs text-muted-foreground">{r.code}</span>}
                  </TableCell>
                  <TableCell align="center">{r.gbp ? <span className="tabular-nums">{r.gbp}</span> : <Tick on={false} />}</TableCell>
                  <TableCell align="center">{r.ads ? <span className="tabular-nums">{r.ads}</span> : <Dash />}</TableCell>
                  <TableCell>
                    {r.websites ? <Badge tone="neutral" icon={false}>Managed</Badge> : r.websiteUrl ? <Badge tone="outline" icon={false}>Own site</Badge> : <Dash />}
                  </TableCell>
                  <TableCell>
                    {r.domains.length ? (
                      <span className="flex flex-col gap-0.5">
                        {r.domains.map((d) => (
                          <SiteLink key={d} url={d} label={d} />
                        ))}
                      </span>
                    ) : (
                      <Dash />
                    )}
                  </TableCell>
                  <TableCell align="center">{r.seoSites ? <Tick on={r.gsc} title="No Search Console access" /> : <Dash />}</TableCell>
                  <TableCell align="center">{r.seoSites ? <Tick on={r.ga4} title="No GA4 linked" /> : <Dash />}</TableCell>
                </TableRow>
              ))}
              {slice.length === 0 && <Empty cols={7} text="No merchants match." />}
            </TableBody>
          </Table>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              {rows.length} merchants · page {page + 1} of {pages}
            </span>
            <div className="flex gap-1">
              <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>
                Previous
              </Button>
              <Button size="sm" variant="outline" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>
                Next
              </Button>
            </div>
          </div>
        </div>
      )}
    </SettingsCard>
  );
}
