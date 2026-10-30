"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CircleAlert, CircleCheck, CircleDashed, Link2, Link2Off, RefreshCw, RotateCcw } from "lucide-react";
import { Badge, Button, Dialog, Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, useToast } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { useConnectGbp, useDisconnectGbp, useGbpStatus, useSampleData, useStartSync, useSyncRuns } from "../api";
import { autoTime, fmtAgo, fmtDay } from "../lib";
import type { SyncRun } from "../types";

const RUN_TONE: Record<SyncRun["status"], "success" | "warning" | "danger" | "accent"> = {
  success: "success",
  partial: "warning",
  failed: "danger",
  running: "accent",
};
const RUN_LABEL: Record<SyncRun["status"], string> = { success: "Done", partial: "Done with errors", failed: "Failed", running: "Running" };
const TRIGGER: Record<SyncRun["trigger"], string> = { manual: "Refresh data", schedule: "Daily, automatic", connect: "After connecting" };

/**
 * Settings → Integrations → Google Business Profile: the one place to change
 * the connected Google account, reconnect after access stops working,
 * disconnect, see refresh history and remove sample data. (The first-time
 * Connect is also offered on the GBP page itself.)
 */
export function GbpConnectionSettings() {
  const { data: status, isPending } = useGbpStatus();
  const connect = useConnectGbp("settings");
  const disconnect = useDisconnectGbp();
  const startSync = useStartSync();
  const sample = useSampleData();
  const runs = useSyncRuns(true);
  const { toast } = useToast();
  const [confirm, setConfirm] = useState<null | "disconnect" | "change">(null);
  useGbpOAuthReturnToast();

  if (isPending || !status) return <Skeleton className="h-48 w-full" />;
  const c = status.connection;
  const keysMissing = status.missingEnv.filter((k) => k !== "CREDENTIAL_ENCRYPTION_KEY");
  const manage = status.canManage;
  const startConnect = () =>
    connect.mutate(undefined, { onError: (e) => toast({ variant: "error", title: "Can't connect yet", description: e.messages?.[0] ?? e.message }) });

  const state = !c
    ? { label: keysMissing.length ? "Waiting for keys" : "Not connected", tone: "warning" as const, icon: CircleDashed }
    : c.status === "error"
      ? { label: "Needs reconnect", tone: "danger" as const, icon: CircleAlert }
      : { label: "Connected", tone: "success" as const, icon: CircleCheck };

  return (
    <div id="gbp" className="flex scroll-mt-24 flex-col gap-4 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-foreground">Google Business Profile</div>
          <div className="text-xs text-muted-foreground">Performance, reviews and posts for every listing the connected Google account manages. Read-only.</div>
        </div>
        <Badge tone={state.tone} icon={state.icon}>
          {state.label}
        </Badge>
      </div>

      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <Row label="Google account">{c?.email ?? "—"}</Row>
        <Row label="Connected">{c ? `${formatDateTime(c.connectedAt)}${c.connectedBy ? ` by ${c.connectedBy}` : ""}` : "—"}</Row>
        <Row label="Last refresh">{c?.lastSyncAt ? `${fmtAgo(c.lastSyncAt)} · Google data through ${fmtDay(status.dataThrough)}` : "—"}</Row>
        <Row label="Automatic refresh">
          {status.autoSync.enabled ? `Every day at ${status.autoSync.nextAt ? autoTime(status.autoSync.nextAt) : `${status.autoSync.hour}:00`} (${status.autoSync.timezone})` : "Off (GBP_AUTO_SYNC=false)"}
        </Row>
        <Row label="Listings">
          {status.locations.google ? `${status.locations.google} from Google` : "None synced yet"}
          {status.locations.demo > 0 && ` · ${status.locations.demo} sample`}
        </Row>
        <Row label="Reports">
          <Link href="/web/gbp" className="text-primary hover:underline">
            Web & Search → GBP
          </Link>
        </Row>
      </dl>

      {c?.status === "error" && <p className="rounded-md bg-destructive-subtle px-3 py-2 text-sm text-text-destructive">{c.error}</p>}
      {!c && keysMissing.length > 0 && (
        <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
          Waiting for Google to approve Business Profile API access. Add{" "}
          {keysMissing.map((k, i) => (
            <span key={k}>
              {i > 0 && ", "}
              <code className="rounded bg-card px-1 py-0.5 text-[11px]">{k}</code>
            </span>
          ))}{" "}
          to the API&apos;s environment variables and redeploy it. The OAuth client must list <code className="rounded bg-card px-1 py-0.5 text-[11px]">{status.redirectUri}</code> as a redirect URI.
        </p>
      )}

      {manage ? (
        <div className="flex flex-wrap gap-2">
          {!c && (
            <Button size="sm" onClick={startConnect} loading={connect.isPending} disabled={keysMissing.length > 0}>
              <Link2 className="size-4" />
              Connect Google Business Profile
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
                  onSuccess: () => toast({ variant: "success", title: "Refreshing from Google" }),
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
          {status.locations.demo > 0 && (
            <Button
              size="sm"
              variant="ghost"
              loading={sample.remove.isPending}
              onClick={() => sample.remove.mutate(undefined, { onSuccess: (r) => toast({ variant: "success", title: `Removed ${r.removed} sample listings` }) })}
            >
              Remove sample data
            </Button>
          )}
          {!c && status.locations.google === 0 && status.locations.demo === 0 && (
            <Button
              size="sm"
              variant="ghost"
              loading={sample.load.isPending}
              onClick={() =>
                sample.load.mutate(undefined, {
                  onSuccess: (r) => toast({ variant: "success", title: `Loaded ${r.listings} sample listings` }),
                  onError: (e) => toast({ variant: "error", title: "Couldn't load sample data", description: e.messages?.[0] ?? e.message }),
                })
              }
            >
              Load sample data
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
                <TableHead align="right">Listings</TableHead>
                <TableHead align="right">Reviews</TableHead>
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
                    {r.locations}
                    {r.locationsFailed ? ` (${r.locationsFailed} failed)` : ""}
                  </TableCell>
                  <TableCell align="right">{r.reviews.toLocaleString()}</TableCell>
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
        title="Disconnect Google Business Profile?"
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
                    toast({ variant: "success", title: "Google Business Profile disconnected" });
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
        description="Google's sign-in opens; choose the account that manages the restaurant listings. The new account replaces the current one. Listings it doesn't manage keep their history but stop updating."
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button onClick={startConnect} loading={connect.isPending} disabled={keysMissing.length > 0}>
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

/** After Google sends the browser back (?gbp=connected | error&reason=…),
 *  show the outcome once and clean the URL. Used on the GBP page and here. */
export function useGbpOAuthReturnToast() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { toast } = useToast();
  const result = params.get("gbp");
  useEffect(() => {
    if (!result) return;
    if (result === "connected") {
      toast({ variant: "success", title: "Google Business Profile connected", description: "The first refresh is running — about 5 minutes for 150 listings." });
    } else {
      toast({ variant: "error", title: "Couldn't connect Google", description: params.get("reason") ?? "Try again." });
    }
    const p = new URLSearchParams(params.toString());
    p.delete("gbp");
    p.delete("reason");
    router.replace(p.toString() ? `${pathname}?${p}` : pathname, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);
}
