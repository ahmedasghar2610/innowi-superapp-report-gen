"use client";

import Link from "next/link";
import { CircleAlert, Link2, Loader2, MapPin, RefreshCw, Settings } from "lucide-react";
import { Badge, Button, useToast } from "@/components/ui";
import { useConnectGbp, useStartSync } from "../api";
import { autoTime, fmtAgo, fmtDay } from "../lib";
import type { GbpStatus } from "../types";
import { useGbpOAuthReturnToast } from "./gbp-connection-settings";

export const GBP_SETTINGS_HREF = "/settings/integrations#gbp";

/** The strip above the GBP reports: where the data comes from, how fresh it
 *  is, "Refresh data", and the first-time "Connect". Changing the account,
 *  reconnecting and disconnecting live in Settings → Integrations
 *  (GbpConnectionSettings). */
export function ConnectionPanel({ status }: { status: GbpStatus }) {
  const { toast } = useToast();
  useGbpOAuthReturnToast();
  const startSync = useStartSync();
  const connect = useConnectGbp("gbp");
  const keysMissing = status.missingEnv.filter((k) => k !== "CREDENTIAL_ENCRYPTION_KEY");
  const c = status.connection;
  const run = status.lastRun;
  const connected = c?.status === "connected";

  const onSync = () =>
    startSync.mutate(undefined, {
      onSuccess: () => toast({ variant: "success", title: "Refreshing from Google", description: "About 2 seconds per listing — the page updates by itself when it's done." }),
      onError: (e) => toast({ variant: "error", title: "Refresh didn't start", description: e.messages?.[0] ?? e.message }),
    });

  let tone: "neutral" | "danger" | "accent" = "neutral";
  let title: string;
  let body: React.ReactNode;
  if (status.running) {
    tone = "accent";
    title = "Refreshing from Google…";
    body = run ? `${run.locations} listings done so far${run.locationsFailed ? `, ${run.locationsFailed} with errors` : ""}.` : "Starting…";
  } else if (c?.status === "error") {
    tone = "danger";
    title = "Google access stopped working";
    body = c.error ?? "Reconnect in Settings → Integrations to resume the daily refresh.";
  } else if (c) {
    title = `Google Business Profile · ${c.email ?? "connected"}`;
    body = (
      <>
        Last refreshed {fmtAgo(c.lastSyncAt)}
        {status.autoSync.enabled && status.autoSync.nextAt && <> · refreshes automatically every day at {autoTime(status.autoSync.nextAt)}</>}
        {run && (run.status === "failed" || run.status === "partial") && (
          <>
            {" "}
            · <span className={run.status === "failed" ? "text-text-destructive" : "text-warning-text"}>{run.status === "failed" ? `last refresh failed: ${run.error}` : `${run.locationsFailed} listings had errors`}</span>
          </>
        )}
        {status.dataThrough && <> · Google data through {fmtDay(status.dataThrough)}</>}
      </>
    );
  } else {
    title = "Google Business Profile isn't connected yet";
    body = !status.canManage
      ? "A manager connects the Google account that manages the listings."
      : keysMissing.length
        ? <>Waiting for Google to approve API access. When the keys arrive, add {keysMissing.map((k, i) => <span key={k}>{i > 0 && ", "}<code className="rounded bg-muted px-1 py-0.5 text-[11px]">{k}</code></span>)} to the API&apos;s environment variables and redeploy it.</>
        : "Sign in with the Google account that manages the restaurant listings. The first refresh starts within the hour, or use Sync now.";
  }

  return (
    <div
      className={
        "flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] border px-4 py-3 " +
        (tone === "danger" ? "border-destructive/40 bg-destructive-subtle" : tone === "accent" ? "border-primary-border bg-accent" : "border-border bg-card")
      }
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
        {status.running ? <Loader2 className="size-4 animate-spin" /> : tone === "danger" ? <CircleAlert className="size-4 text-text-destructive" /> : <MapPin className="size-4" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-foreground">{title}</div>
        <div className="text-xs text-muted-foreground">{body}</div>
      </div>
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        {status.locations.demo > 0 && (
          <Badge tone="dataq" title="Sample data — the first real refresh replaces it. Remove it in Settings → Integrations.">
            Showing {status.locations.demo} sample listings
          </Badge>
        )}
        {status.canManage && c && (
          <Button
            size="sm"
            variant="outline"
            onClick={onSync}
            loading={startSync.isPending}
            disabled={status.running || !connected}
            title={connected ? "Pull the latest data from Google now" : "Connect Google Business Profile first (Settings → Integrations)"}
          >
            <RefreshCw className="size-4" />
            Refresh data
          </Button>
        )}
        {status.canManage && !c && (
          <Button
            size="sm"
            loading={connect.isPending}
            disabled={keysMissing.length > 0}
            title={keysMissing.length ? "Add the Google OAuth keys to the API's environment variables first" : undefined}
            onClick={() =>
              connect.mutate(undefined, {
                onError: (e) => toast({ variant: "error", title: "Can't connect yet", description: e.messages?.[0] ?? e.message }),
              })
            }
          >
            <Link2 className="size-4" />
            Connect Google Business Profile
          </Button>
        )}
        {status.canManage && c && (
          <Link
            href={GBP_SETTINGS_HREF}
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

