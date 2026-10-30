"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CircleAlert, CircleCheck, CircleDashed, Link2, Link2Off, Loader2, RefreshCw, RotateCcw, Settings, Target } from "lucide-react";
import { Badge, Button, Dialog, Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, useToast } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils/cn";
import { useAdsStatus, useConnectAds, useDisconnectAds, useSampleData, useStartSync, useSyncRuns } from "../api";
import { autoTime, fmtAgo, fmtDay } from "../lib";
import type { AdsStatus, SyncRun } from "../types";

export const ADS_SETTINGS_HREF = "/settings/integrations#google-ads";

/** After Google sends the browser back (?ads=connected | error&reason=…), show the outcome once. */
export function useAdsOAuthReturnToast() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { toast } = useToast();
  const result = params.get("ads");
  useEffect(() => {
    if (!result) return;
    if (result === "connected") toast({ variant: "success", title: "Google Ads connected", description: "The first refresh is running — it reads up to 400 days per account." });
    else toast({ variant: "error", title: "Couldn't connect Google Ads", description: params.get("reason") ?? "Try again." });
    const p = new URLSearchParams(params.toString());
    p.delete("ads");
    p.delete("reason");
    router.replace(p.toString() ? `${pathname}?${p}` : pathname, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);
}

function keysOf(status: AdsStatus) {
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

/** The strip above the Ads pages: where the data comes from, how fresh it is,
 *  "Refresh data", and the first-time "Connect Google Ads". */
export function ConnectionStrip({ status }: { status: AdsStatus }) {
  const { toast } = useToast();
  useAdsOAuthReturnToast();
  const connect = useConnectAds("ads");
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
    title = run?.mode === "quick" ? "Refreshing the numbers from Google Ads…" : "Full refresh from Google Ads…";
    body = run ? `${run.accounts} accounts done so far${run.accountsFailed ? `, ${run.accountsFailed} with errors` : ""}.` : "Starting…";
  } else if (c?.status === "error") {
    tone = "danger";
    title = "Google Ads access stopped working";
    body = c.error ?? "Reconnect in Settings → Integrations to resume the daily refresh.";
  } else if (c) {
    title = `Google Ads · ${c.email ?? "connected"}${status.managerCustomerId ? ` · manager ${status.managerCustomerId}` : ""}`;
    body = (
      <>
        Last refreshed {fmtAgo(c.lastSyncAt)}
        {status.autoSync.enabled && status.autoSync.nextAt && <> · refreshes automatically every day at {autoTime(status.autoSync.nextAt)}</>}
        {run && (run.status === "failed" || run.status === "partial") && (
          <>
            {" "}
            ·{" "}
            <span className={run.status === "failed" ? "text-text-destructive" : "text-warning-text"}>
              {run.status === "failed" ? `last refresh failed: ${run.error}` : `${run.accountsFailed} accounts had errors`}
            </span>
          </>
        )}
        {status.dataThrough && <> · data through {fmtDay(status.dataThrough)}</>}
      </>
    );
  } else {
    title = "Google Ads isn't connected yet";
    body = !status.canManage ? (
      "A manager connects the Google user that has access to the Innowi manager account."
    ) : keys.length ? (
      <>
        Replaces the n8n workflow. Add <Keys keys={keys} /> to the API&apos;s environment variables and redeploy it, then connect.
      </>
    ) : (
      "Sign in with a Google user of the manager (MCC) account. The first refresh starts within the hour, or use Sync now."
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
        {status.running ? <Loader2 className="size-4 animate-spin" /> : tone === "danger" ? <CircleAlert className="size-4 text-text-destructive" /> : <Target className="size-4" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-foreground">{title}</div>
        <div className="text-xs text-muted-foreground">{body}</div>
      </div>
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        {status.accounts.demo > 0 && (
          <Badge tone="dataq" title="Sample data — the first real refresh replaces it.">
            Showing {status.accounts.demo} sample accounts
          </Badge>
        )}
        {status.canManage && !c && status.accounts.demo === 0 && status.accounts.google === 0 && (
          <Button
            size="sm"
            variant="ghost"
            loading={sample.load.isPending}
            onClick={() =>
              sample.load.mutate(undefined, {
                onSuccess: (r) => toast({ variant: "success", title: `Loaded ${r.accounts} sample accounts` }),
                onError: (e) => toast({ variant: "error", title: "Couldn't load sample data", description: e.messages?.[0] ?? e.message }),
              })
            }
          >
            Load sample data
          </Button>
        )}
        {status.canManage && c && <RefreshButtons running={status.running} disabled={!connected} />}
        {status.canManage && !c && (
          <Button
            size="sm"
            loading={connect.isPending}
            disabled={keys.length > 0}
            title={keys.length ? "Add the Google Ads keys to the API's environment variables first" : undefined}
            onClick={() => connect.mutate(undefined, { onError: (e) => toast({ variant: "error", title: "Can't connect yet", description: e.messages?.[0] ?? e.message }) })}
          >
            <Link2 className="size-4" />
            Connect Google Ads
          </Button>
        )}
        {status.canManage && c && (
          <Link
            href={ADS_SETTINGS_HREF}
            className={
              "inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium " +
              (connected ? "text-muted-foreground hover:bg-secondary hover:text-foreground" : "bg-primary text-primary-foreground hover:bg-primary-hover")
            }
          >
            <Settings className="size-4" />
            {connected ? "Manage connection" : "Reconnect in Settings"}
          </Link>
        )}
      </div>
    </div>
  );
}

const RUN_TONE: Record<SyncRun["status"], "success" | "warning" | "danger" | "accent"> = { success: "success", partial: "warning", failed: "danger", running: "accent" };
const RUN_LABEL: Record<SyncRun["status"], string> = { success: "Done", partial: "Done with errors", failed: "Failed", running: "Running" };
const TRIGGER: Record<SyncRun["trigger"], string> = {
  quick: "Refresh (numbers only)",
  manual: "Full refresh",
  schedule: "Daily, automatic (full)",
  connect: "After connecting",
  cli: "Command line",
};

/**
 * "Refresh" re-reads accounts, campaigns and daily metrics only — what the
 * report pages show — so it takes seconds, like the old n8n run. "Full
 * refresh" also re-reads assets, sitelinks, promotions, campaign dates and
 * advertiser verification (the daily automatic refresh always does this).
 */
export function RefreshButtons({ running, disabled = false }: { running: boolean; disabled?: boolean }) {
  const { toast } = useToast();
  const startSync = useStartSync();
  const go = (mode: "quick" | "full") =>
    startSync.mutate(mode, {
      onSuccess: () =>
        toast({
          variant: "success",
          title: mode === "quick" ? "Refreshing the numbers" : "Full refresh started",
          description: mode === "quick" ? "Usually done in seconds; the page updates by itself." : "Takes a few minutes; the page updates by itself.",
        }),
      onError: (e) => toast({ variant: "error", title: "Refresh didn't start", description: e.messages?.[0] ?? e.message }),
    });
  const busy = running || startSync.isPending;
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        loading={startSync.isPending && startSync.variables === "quick"}
        disabled={busy || disabled}
        title="Spend, clicks, calls, orders and campaign status for every account — usually a few seconds."
        onClick={() => go("quick")}
      >
        <RefreshCw className={cn("size-4", running && "animate-spin")} />
        {running ? "Refreshing…" : "Refresh"}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        loading={startSync.isPending && startSync.variables === "full"}
        disabled={busy || disabled}
        title="Everything, including assets, sitelinks, promotions, campaign dates and advertiser verification — a few minutes. Runs by itself every day."
        onClick={() => go("full")}
      >
        <RotateCcw className="size-4" />
        Full refresh
      </Button>
    </>
  );
}

/** Settings → Integrations → Google Ads: connect / change / disconnect, refresh history, sample data. */
export function AdsConnectionSettings() {
  const { data: status, isPending } = useAdsStatus();
  const connect = useConnectAds("settings");
  const disconnect = useDisconnectAds();
  const sample = useSampleData();
  const runs = useSyncRuns(true);
  const { toast } = useToast();
  const [confirm, setConfirm] = useState<null | "disconnect" | "change">(null);
  useAdsOAuthReturnToast();

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
    <div id="google-ads" className="flex scroll-mt-24 flex-col gap-4 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-foreground">Google Ads</div>
          <div className="text-xs text-muted-foreground">
            Spend, orders, ROI/ROAS, budgets, assets and verification for every client account under the manager account. Read-only. Replaces the n8n
            &quot;Google Ads Reporting&quot; workflow.
          </div>
        </div>
        <Badge tone={state.tone} icon={state.icon}>
          {state.label}
        </Badge>
      </div>
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <Row label="Google account">{c?.email ?? "—"}</Row>
        <Row label="Manager account">{status.managerCustomerId ?? "Not set (GOOGLE_ADS_LOGIN_CUSTOMER_ID)"}</Row>
        <Row label="Connected">{c ? `${formatDateTime(c.connectedAt)}${c.connectedBy ? ` by ${c.connectedBy}` : ""}` : "—"}</Row>
        <Row label="Last refresh">{c?.lastSyncAt ? `${fmtAgo(c.lastSyncAt)} · data through ${fmtDay(status.dataThrough)}` : "—"}</Row>
        <Row label="Automatic refresh">
          {status.autoSync.enabled ? `Every day at ${status.autoSync.nextAt ? autoTime(status.autoSync.nextAt) : `${status.autoSync.hour}:00`} (${status.autoSync.timezone})` : "Off (ADS_AUTO_SYNC=false)"}
        </Row>
        <Row label="Accounts">
          {status.accounts.google ? `${status.accounts.google} from Google` : "None synced yet"}
          {status.accounts.sheet > 0 && ` · ${status.accounts.sheet} added by hand / from the sheet`}
          {status.accounts.demo > 0 && ` · ${status.accounts.demo} sample`}
        </Row>
        <Row label="Reports">
          <Link href="/ads" className="text-primary hover:underline">
            Modules → Ads
          </Link>
        </Row>
      </dl>
      {c?.status === "error" && <p className="rounded-md bg-destructive-subtle px-3 py-2 text-sm text-text-destructive">{c.error}</p>}
      {!c && keys.length > 0 && (
        <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
          Add <Keys keys={keys} /> to the API&apos;s environment variables and redeploy it. The OAuth client must list{" "}
          <code className="rounded bg-card px-1 py-0.5 text-[11px]">{status.redirectUri}</code> as a redirect URI, and the Google Ads API must be enabled in its Google Cloud project.
        </p>
      )}
      {status.canManage ? (
        <div className="flex flex-wrap gap-2">
          {!c && (
            <Button size="sm" onClick={startConnect} loading={connect.isPending} disabled={keys.length > 0}>
              <Link2 className="size-4" />
              Connect Google Ads
            </Button>
          )}
          {c?.status === "error" && (
            <Button size="sm" onClick={startConnect} loading={connect.isPending}>
              <RotateCcw className="size-4" />
              Reconnect
            </Button>
          )}
          {c?.status === "connected" && <RefreshButtons running={status.running} />}
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
          {status.accounts.demo > 0 && (
            <Button size="sm" variant="ghost" loading={sample.remove.isPending} onClick={() => sample.remove.mutate(undefined, { onSuccess: (r) => toast({ variant: "success", title: `Removed ${r.removed} sample accounts` }) })}>
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
                <TableHead align="right">Accounts</TableHead>
                <TableHead align="right">Campaign-days</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.data!.slice(0, 5).map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap">{formatDateTime(r.startedAt)}</TableCell>
                  <TableCell>{TRIGGER[r.trigger]}</TableCell>
                  <TableCell>
                    <Badge tone={RUN_TONE[r.status]}>{RUN_LABEL[r.status]}</Badge>
                    {r.error && <div className="mt-1 max-w-sm text-xs text-muted-foreground">{r.error}</div>}
                  </TableCell>
                  <TableCell align="right">
                    {r.accounts}
                    {r.accountsFailed ? ` (${r.accountsFailed} failed)` : ""}
                    {r.newAccounts ? ` · ${r.newAccounts} new` : ""}
                  </TableCell>
                  <TableCell align="right">{r.metricRows.toLocaleString()}</TableCell>
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
        title="Disconnect Google Ads?"
        description="The daily refresh stops and the stored Google access is revoked. Reports keep the data already synced. Connect again any time."
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
                    toast({ variant: "success", title: "Google Ads disconnected" });
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
        description="Google's sign-in opens; choose a user with access to the manager account. The new account replaces the current one."
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
