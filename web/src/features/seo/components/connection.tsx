"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CircleAlert, CircleCheck, CircleDashed, Link2, Link2Off, Loader2, RefreshCw, RotateCcw, Search, Settings } from "lucide-react";
import { Badge, Button, Dialog, Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, useToast } from "@/components/ui";
import { useConnectSeo, useDisconnectSeo, useSampleData, useSeoStatus, useStartSync, useSyncRuns } from "../api";
import { autoTime, fmtAgo, fmtDateTime, fmtDay } from "../lib";
import type { SeoStatus, SyncRun } from "../types";

/** The Google connection lives in Settings → Integrations (next to GBP and Ads); site settings stay in SEO. */
export const SEO_CONNECTIONS_HREF = "/settings/integrations#seo";
export const SEO_SITES_HREF = "/web/seo/site-settings";

/** After Google sends the browser back (?seo=connected | error&reason=…), show the outcome once. */
export function useSeoOAuthReturnToast() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { toast } = useToast();
  const result = params.get("seo");
  useEffect(() => {
    if (!result) return;
    if (result === "connected") toast({ variant: "success", title: "Search Console & GA4 connected", description: "The first refresh is running — it reads up to 16 months per site." });
    else toast({ variant: "error", title: "Couldn't connect Google", description: params.get("reason") ?? "Try again." });
    const p = new URLSearchParams(params.toString());
    p.delete("seo");
    p.delete("reason");
    router.replace(p.toString() ? `${pathname}?${p}` : pathname, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);
}

function keysOf(status: SeoStatus) {
  return status.missingEnv.filter((k) => k !== "CREDENTIAL_ENCRYPTION_KEY");
}

function Keys({ keys }: { keys: string[] }) {
  return (
    <>
      {keys.map((k, i) => (
        <span key={k}>
          {i > 0 && ", "}
          <code className="rounded bg-muted px-1 py-0.5 text-[11px]">{k}</code>
        </span>
      ))}
    </>
  );
}

/** The strip above every SEO page: where the data comes from, how fresh it is, "Refresh data", and the first-time "Connect". */
export function ConnectionStrip({ status }: { status: SeoStatus }) {
  const { toast } = useToast();
  useSeoOAuthReturnToast();
  const startSync = useStartSync();
  const connect = useConnectSeo("seo");
  const sample = useSampleData();
  const keys = keysOf(status);
  const c = status.connection;
  const run = status.lastRun;
  const connected = c?.status === "connected";

  let tone: "neutral" | "danger" | "accent" = "neutral";
  let title: string;
  let body: React.ReactNode;
  if (status.running) {
    tone = "accent";
    title = "Refreshing SEO data…";
    body = run ? `${run.sites} sites done so far${run.sitesFailed ? `, ${run.sitesFailed} with errors` : ""}.` : "Starting…";
  } else if (c?.status === "error") {
    tone = "danger";
    title = "Google access stopped working";
    body = c.error ?? "Reconnect in Settings → Integrations to resume the daily refresh.";
  } else if (c) {
    title = `Search Console & GA4 · ${c.email ?? "connected"}`;
    body = (
      <>
        Last refreshed {fmtAgo(c.lastSyncAt)}
        {status.autoSync.enabled && status.autoSync.nextAt && <> · refreshes automatically every day at {autoTime(status.autoSync.nextAt)}</>}
        {run && (run.status === "failed" || run.status === "partial") && (
          <>
            {" "}
            · <span className={run.status === "failed" ? "text-text-destructive" : "text-warning-text"}>{run.status === "failed" ? `last refresh failed: ${run.error}` : `${run.sitesFailed} sites had errors`}</span>
          </>
        )}
        {status.dataThrough && <> · Search Console data through {fmtDay(status.dataThrough)}</>}
      </>
    );
  } else {
    title = "Search Console & GA4 aren't connected yet";
    body = !status.canManage ? (
      "A manager connects the Google account that has access to the sites' Search Console and GA4."
    ) : keys.length ? (
      <>
        Add <Keys keys={keys} /> to the API&apos;s environment variables and redeploy it, then connect. Until then, sample data shows how the pages work.
      </>
    ) : (
      "Sign in with the Google account that has access to the sites' Search Console and GA4. The first refresh starts within the hour, or use Sync now."
    );
  }

  return (
    <div
      className={
        "flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] border px-4 py-3 " +
        (tone === "danger" ? "border-destructive/40 bg-destructive-subtle" : tone === "accent" ? "border-primary-border bg-accent" : "border-border bg-card")
      }
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
        {status.running ? <Loader2 className="size-4 animate-spin" /> : tone === "danger" ? <CircleAlert className="size-4 text-text-destructive" /> : <Search className="size-4" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-foreground">{title}</div>
        <div className="text-xs text-muted-foreground">{body}</div>
      </div>
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        {status.sites.demo > 0 && (
          <Badge tone="dataq" title="Sample data — the first real refresh replaces it. Remove it in Settings → Integrations.">
            Showing {status.sites.demo} sample sites
          </Badge>
        )}
        {status.canManage && !c && status.sites.demo === 0 && status.sites.google === 0 && status.sites.manual === 0 && (
          <Button
            size="sm"
            variant="ghost"
            loading={sample.load.isPending}
            onClick={() =>
              sample.load.mutate(undefined, {
                onSuccess: (r) => toast({ variant: "success", title: `Loaded ${r.sites} sample sites` }),
                onError: (e) => toast({ variant: "error", title: "Couldn't load sample data", description: e.messages?.[0] ?? e.message }),
              })
            }
          >
            Load sample data
          </Button>
        )}
        {status.canManage && (c || status.sites.manual > 0) && (
          <Button
            size="sm"
            variant="outline"
            loading={startSync.isPending}
            disabled={status.running || (!!c && !connected)}
            onClick={() =>
              startSync.mutate(undefined, {
                onSuccess: () => toast({ variant: "success", title: "Refreshing SEO data", description: "The pages update by themselves when it's done." }),
                onError: (e) => toast({ variant: "error", title: "Refresh didn't start", description: e.messages?.[0] ?? e.message }),
              })
            }
          >
            <RefreshCw className="size-4" />
            Refresh data
          </Button>
        )}
        {status.canManage && !c && (
          <Button
            size="sm"
            loading={connect.isPending}
            disabled={keys.length > 0}
            title={keys.length ? "Add the Google OAuth keys to the API's environment variables first" : undefined}
            onClick={() => connect.mutate(undefined, { onError: (e) => toast({ variant: "error", title: "Can't connect yet", description: e.messages?.[0] ?? e.message }) })}
          >
            <Link2 className="size-4" />
            Connect Search Console & GA4
          </Button>
        )}
        {status.canManage && c && (
          <Link
            href={SEO_CONNECTIONS_HREF}
            className={
              "inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium " +
              (connected ? "text-muted-foreground hover:bg-secondary hover:text-foreground" : "bg-primary text-primary-foreground hover:bg-primary-hover")
            }
          >
            <Settings className="size-4" />
            {connected ? "Manage connection" : "Reconnect"}
          </Link>
        )}
      </div>
    </div>
  );
}

const RUN_TONE: Record<SyncRun["status"], "success" | "warning" | "danger" | "accent"> = { success: "success", partial: "warning", failed: "danger", running: "accent" };
const RUN_LABEL: Record<SyncRun["status"], string> = { success: "Done", partial: "Done with errors", failed: "Failed", running: "Running" };
const TRIGGER: Record<SyncRun["trigger"], string> = { manual: "Refresh data", schedule: "Daily, automatic", connect: "After connecting" };

/** Settings → Integrations card (next to GBP and Ads): connect / change / disconnect, refresh, sample data, refresh history. */
export function SeoConnectionSettings() {
  const { data: status, isPending } = useSeoStatus();
  const connect = useConnectSeo("settings");
  const disconnect = useDisconnectSeo();
  const startSync = useStartSync();
  const sample = useSampleData();
  const runs = useSyncRuns(true);
  const { toast } = useToast();
  const [confirm, setConfirm] = useState<null | "disconnect" | "change">(null);
  useSeoOAuthReturnToast();

  if (isPending || !status) return <Skeleton className="h-48 w-full" />;
  const c = status.connection;
  const keys = keysOf(status);
  const startConnect = () => connect.mutate(undefined, { onError: (e) => toast({ variant: "error", title: "Can't connect yet", description: e.messages?.[0] ?? e.message }) });
  const state = !c
    ? { label: keys.length ? "Waiting for keys" : "Not connected", tone: "warning" as const, icon: CircleDashed }
    : c.status === "error"
      ? { label: "Needs reconnect", tone: "danger" as const, icon: CircleAlert }
      : { label: "Connected", tone: "success" as const, icon: CircleCheck };

  return (
    <div id="seo" className="flex scroll-mt-24 flex-col gap-4 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-foreground">Search Console & Google Analytics 4</div>
          <div className="text-xs text-muted-foreground">
            Clicks, search terms, indexing, visits and key events for every site the connected Google account can read. Uses the same Google Cloud project and OAuth client as
            GBP and Ads. Read-only.
          </div>
        </div>
        <Badge tone={state.tone} icon={state.icon}>
          {state.label}
        </Badge>
      </div>
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <Row label="Google account">{c?.email ?? "—"}</Row>
        <Row label="Access granted">
          {c ? (
            <span className="flex flex-wrap gap-1">
              <Badge tone={c.scopes.searchConsole ? "success" : "warning"}>Search Console</Badge>
              <Badge tone={c.scopes.analytics ? "success" : "warning"}>Analytics</Badge>
              <Badge tone={c.scopes.gmail ? "success" : "warning"} title="Needed to e-mail client SEO reports from this account">
                Send email
              </Badge>
            </span>
          ) : (
            "—"
          )}
        </Row>
        <Row label="Connected">{c ? `${fmtDateTime(c.connectedAt)}${c.connectedBy ? ` by ${c.connectedBy}` : ""}` : "—"}</Row>
        <Row label="Last refresh">{c?.lastSyncAt ? `${fmtAgo(c.lastSyncAt)} · data through ${fmtDay(status.dataThrough)}` : "—"}</Row>
        <Row label="Automatic refresh">
          {status.autoSync.enabled ? `Every day at ${status.autoSync.nextAt ? autoTime(status.autoSync.nextAt) : `${status.autoSync.hour}:00`} (${status.autoSync.timezone})` : "Off (SEO_AUTO_SYNC=false)"}
        </Row>
        <Row label="Sites">
          {status.sites.google ? `${status.sites.google} from Search Console` : "None synced yet"}
          {status.sites.manual > 0 && ` · ${status.sites.manual} added by hand`}
          {status.sites.demo > 0 && ` · ${status.sites.demo} sample`}
          {c && ` · ${c.ga4Properties} GA4 properties visible`}
        </Row>
        <Row label="Reports">
          <span className="flex flex-wrap gap-x-3">
            <Link href="/web/seo" className="text-primary hover:underline">
              Marketing → SEO
            </Link>
            <Link href={SEO_SITES_HREF} className="text-primary hover:underline">
              Site settings
            </Link>
          </span>
        </Row>
      </dl>
      {c?.status === "error" && <p className="rounded-md bg-destructive-subtle px-3 py-2 text-sm text-text-destructive">{c.error}</p>}
      {!c && keys.length > 0 && (
        <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
          Add <Keys keys={keys} /> to the API&apos;s environment variables and redeploy it. The OAuth client must list{" "}
          <code className="rounded bg-card px-1 py-0.5 text-[11px]">{status.redirectUri}</code> as a redirect URI, and the Search Console, Analytics Data, Analytics Admin and Gmail APIs
          must be enabled in its Google Cloud project.
        </p>
      )}
      {status.canManage ? (
        <div className="flex flex-wrap gap-2">
          {!c && (
            <Button size="sm" onClick={startConnect} loading={connect.isPending} disabled={keys.length > 0}>
              <Link2 className="size-4" />
              Connect Search Console & GA4
            </Button>
          )}
          {c?.status === "error" && (
            <Button size="sm" onClick={startConnect} loading={connect.isPending}>
              <RotateCcw className="size-4" />
              Reconnect
            </Button>
          )}
          {c?.status === "connected" && (
            <Button
              size="sm"
              variant="outline"
              loading={startSync.isPending}
              disabled={status.running}
              onClick={() =>
                startSync.mutate(undefined, {
                  onSuccess: () => toast({ variant: "success", title: "Refreshing SEO data" }),
                  onError: (e) => toast({ variant: "error", title: "Refresh didn't start", description: e.messages?.[0] ?? e.message }),
                })
              }
            >
              <RefreshCw className="size-4" />
              {status.running ? "Refreshing…" : "Refresh data"}
            </Button>
          )}
          {c && (
            <Button size="sm" variant="outline" onClick={() => setConfirm("change")}>
              <Link2 className="size-4" />
              Change Google account
            </Button>
          )}
          {c && (
            <Button size="sm" variant="ghost" onClick={() => setConfirm("disconnect")}>
              <Link2Off className="size-4" />
              Disconnect
            </Button>
          )}
          {!c && status.sites.demo === 0 && status.sites.google === 0 && status.sites.manual === 0 && (
            <Button
              size="sm"
              variant="ghost"
              loading={sample.load.isPending}
              onClick={() =>
                sample.load.mutate(undefined, {
                  onSuccess: (r) => toast({ variant: "success", title: `Loaded ${r.sites} sample sites` }),
                  onError: (e) => toast({ variant: "error", title: "Couldn't load sample data", description: e.messages?.[0] ?? e.message }),
                })
              }
            >
              Load sample data
            </Button>
          )}
          {status.sites.demo > 0 && (
            <Button size="sm" variant="ghost" loading={sample.remove.isPending} onClick={() => sample.remove.mutate(undefined, { onSuccess: (r) => toast({ variant: "success", title: `Removed ${r.removed} sample sites` }) })}>
              Remove sample data
            </Button>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Managers and admins can connect, change or disconnect the Google account.</p>
      )}
      {(runs.data?.length ?? 0) > 0 && (
        <div className="flex flex-col gap-2">
          <div className="text-xs font-medium text-muted-foreground">Recent refreshes</div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Started</TableHead>
                <TableHead>How</TableHead>
                <TableHead>Result</TableHead>
                <TableHead align="right">Sites</TableHead>
                <TableHead align="right">Pages checked</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.data!.slice(0, 5).map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap">{fmtDateTime(r.startedAt)}</TableCell>
                  <TableCell>{TRIGGER[r.trigger]}</TableCell>
                  <TableCell>
                    <Badge tone={RUN_TONE[r.status]}>{RUN_LABEL[r.status]}</Badge>
                    {r.error && <div className="mt-1 max-w-sm text-xs text-muted-foreground">{r.error}</div>}
                  </TableCell>
                  <TableCell align="right">
                    {r.sites}
                    {r.sitesFailed ? ` (${r.sitesFailed} failed)` : ""}
                  </TableCell>
                  <TableCell align="right">{r.pagesChecked.toLocaleString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <Dialog
        open={confirm === "disconnect"}
        onClose={() => setConfirm(null)}
        tone="danger"
        title="Disconnect Search Console & GA4?"
        description="The daily refresh stops and the stored Google access is revoked. The SEO pages keep the data already synced. Connect again any time."
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              loading={disconnect.isPending}
              onClick={() =>
                disconnect.mutate(undefined, {
                  onSuccess: () => {
                    setConfirm(null);
                    toast({ variant: "success", title: "Disconnected" });
                  },
                })
              }
            >
              Disconnect
            </Button>
          </>
        }
      />
      <Dialog
        open={confirm === "change"}
        onClose={() => setConfirm(null)}
        title="Change the Google account?"
        description="Google's sign-in opens; choose the account that has the Search Console and GA4 access. The new account replaces the current one."
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button onClick={startConnect} loading={connect.isPending} disabled={keys.length > 0}>
              Continue to Google
            </Button>
          </>
        }
      />
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 gap-2">
      <dt className="w-36 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-foreground">{children}</dd>
    </div>
  );
}
