"use client";

import { useState } from "react";
import { Copy, KeyRound, Link2, RefreshCw, ShieldAlert, Unlink, UsersRound } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
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
  useToast,
} from "@/components/ui";
import { useCan } from "@/features/auth/use-can";
import { ROLE_LABELS } from "@/features/auth/types";
import { formatDate, formatDateTime } from "@/lib/format";
import { useCreateLogin, useLinkLogin, usePeople, useRunSync, useSyncStatus, useUnlinkLogin } from "../queries";
import { formatAgo } from "../format";
import { SalesPageHeader } from "./sales-shell";
import type { CreatedLogin, Person, SalesRole, SyncRun } from "../types";

/**
 * /sales/admin — Admins only (sales.manage). Two jobs:
 *   Logins — give a Salesforce user a SuperApp login, or link/unlink an existing one.
 *   Sync   — see what was copied from Salesforce and when, and run a sync now.
 */
export function SalesAdminPage() {
  const can = useCan();
  const [tab, setTab] = useState("logins");

  if (!can("sales.manage")) {
    return (
      <Card>
        <EmptyState icon={ShieldAlert} title="Admins only" description="Salesforce sync is restricted to Admin and Super Admin." />
      </Card>
    );
  }

  return (
    <div>
      <SalesPageHeader
        title="Salesforce sync"
        description="Give the sales team logins and keep the Salesforce copy up to date. Nothing here changes Salesforce."
        showOwnerPicker={false}
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="logins">Logins</TabsTrigger>
          <TabsTrigger value="sync">Sync</TabsTrigger>
        </TabsList>
        <TabsContent value="logins" className="pt-4">
          <LoginsTab />
        </TabsContent>
        <TabsContent value="sync" className="pt-4">
          <SyncTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ----------------------------------------------------------------- logins */

function LoginsTab() {
  const { toast } = useToast();
  const people = usePeople();
  const link = useLinkLogin();
  const unlink = useUnlinkLogin();
  const [creating, setCreating] = useState<Person | null>(null);
  const [unlinking, setUnlinking] = useState<Person | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  const rows = (people.data ?? []).filter((p) => showInactive || p.isActive || p.linkedUser);

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-table text-muted-foreground">
          Salesforce users (internal and partner-portal) copied by the sync. A login sees only the records its
          Salesforce user owns, unless it is a Sales Manager.
        </p>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            className="size-4 cursor-pointer rounded border-border accent-primary"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          Show inactive Salesforce users
        </label>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Salesforce user</TableHead>
            <TableHead>Profile</TableHead>
            <TableHead align="right">Deals</TableHead>
            <TableHead align="right">Visits</TableHead>
            <TableHead>Last Salesforce login</TableHead>
            <TableHead>SuperApp login</TableHead>
            <TableHead align="right">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {people.isPending &&
            Array.from({ length: 6 }).map((_, i) => (
              <TableRow key={i}>
                <TableCell colSpan={7}>
                  <Skeleton className="h-5 w-full" />
                </TableCell>
              </TableRow>
            ))}
          {people.isError && (
            <TableMessageRow colSpan={7}>
              <ErrorState error={people.error} onRetry={() => people.refetch()} />
            </TableMessageRow>
          )}
          {!people.isPending && !people.isError && rows.length === 0 && (
            <TableMessageRow colSpan={7}>
              <EmptyState icon={UsersRound} title="No Salesforce users yet" description="They appear after the first sync." />
            </TableMessageRow>
          )}
          {rows.map((p) => (
            <TableRow key={p.sfUserId}>
              <TableCell className="max-w-[240px]">
                <span className="block truncate font-medium">{p.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{p.email ?? "no email"}</span>
              </TableCell>
              <TableCell className="whitespace-nowrap">
                {p.profileName ?? "—"}
                {!p.isActive && (
                  <Badge tone="neutral" icon={false} className="ml-2">
                    Inactive
                  </Badge>
                )}
              </TableCell>
              <TableCell align="right">{p.ownsDeals}</TableCell>
              <TableCell align="right">{p.ownsVisits}</TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(p.lastSalesforceLogin)}</TableCell>
              <TableCell className="max-w-[240px]">
                {p.linkedUser ? (
                  <>
                    <span className="block truncate">{p.linkedUser.email}</span>
                    <span className="block text-xs text-muted-foreground">
                      {ROLE_LABELS[p.linkedUser.role]}
                      {p.linkedUser.status !== "ACTIVE" ? ` · ${p.linkedUser.status.toLowerCase()}` : ""}
                    </span>
                  </>
                ) : p.suggestedUser ? (
                  <span className="text-xs text-muted-foreground">
                    Existing login with the same email: {p.suggestedUser.email}
                  </span>
                ) : (
                  <span className="text-muted-foreground">None</span>
                )}
              </TableCell>
              <TableCell align="right" className="whitespace-nowrap">
                {p.linkedUser ? (
                  <Button size="sm" variant="ghost" onClick={() => setUnlinking(p)}>
                    <Unlink />
                    Unlink
                  </Button>
                ) : p.suggestedUser ? (
                  <Button
                    size="sm"
                    variant="outline"
                    loading={link.isPending && link.variables?.sfUserId === p.sfUserId}
                    onClick={() =>
                      link.mutate(
                        { sfUserId: p.sfUserId, userId: p.suggestedUser!.id },
                        {
                          onSuccess: () => toast({ variant: "success", title: "Linked", description: `${p.suggestedUser!.email} now sees ${p.name}'s records.` }),
                          onError: (err) => toast({ variant: "error", title: "Couldn't link", description: err.messages.join(" · ") }),
                        },
                      )
                    }
                  >
                    <Link2 />
                    Link
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" disabled={!p.isActive} title={p.isActive ? undefined : "Inactive in Salesforce"} onClick={() => setCreating(p)}>
                    <KeyRound />
                    Create login
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <CreateLoginDialog key={creating?.sfUserId ?? "none"} person={creating} onClose={() => setCreating(null)} />

      <Dialog
        open={!!unlinking}
        onClose={() => setUnlinking(null)}
        tone="warning"
        icon={<Unlink />}
        title="Unlink this login?"
        description={
          unlinking?.linkedUser
            ? `${unlinking.linkedUser.email} will stop seeing ${unlinking.name}'s Salesforce records. The login itself is not deleted.`
            : undefined
        }
        footer={
          <>
            <Button variant="outline" onClick={() => setUnlinking(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              loading={unlink.isPending}
              onClick={() =>
                unlinking &&
                unlink.mutate(
                  { sfUserId: unlinking.sfUserId },
                  {
                    onSuccess: () => {
                      toast({ variant: "success", title: "Unlinked" });
                      setUnlinking(null);
                    },
                    onError: (err) => toast({ variant: "error", title: "Couldn't unlink", description: err.messages.join(" · ") }),
                  },
                )
              }
            >
              Unlink
            </Button>
          </>
        }
      />
    </>
  );
}

function CreateLoginDialog({ person, onClose }: { person: Person | null; onClose: () => void }) {
  const create = useCreateLogin();
  // The parent keys this dialog by person, so state starts fresh for each one.
  const [role, setRole] = useState<SalesRole>("SALES_EXECUTIVE");
  const [email, setEmail] = useState(person?.email ?? "");
  const [created, setCreated] = useState<CreatedLogin | null>(null);
  const [copied, setCopied] = useState(false);

  const close = () => {
    // Drop the temporary password from memory as soon as the dialog closes.
    setCreated(null);
    onClose();
  };

  const copy = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.temporaryPassword);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  if (created) {
    return (
      <Dialog
        open={!!person}
        onClose={close}
        dismissible={false}
        tone="success"
        icon={<KeyRound />}
        title="Login created"
        description="This password is shown once. Send it privately (not in a group chat). There's no reset screen yet, so if it's lost an admin has to create the login again."
        footer={<Button variant="default" onClick={close}>Done</Button>}
      >
        <dl className="flex flex-col gap-3 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">Email</dt>
            <dd className="font-medium">{created.person.linkedUser?.email ?? email}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Temporary password</dt>
            <dd className="mt-1 flex items-center gap-2">
              <code className="rounded-md bg-muted px-2 py-1 font-mono text-sm">{created.temporaryPassword}</code>
              <Button size="sm" variant="outline" onClick={copy}>
                <Copy />
                {copied ? "Copied" : "Copy"}
              </Button>
            </dd>
          </div>
        </dl>
      </Dialog>
    );
  }

  return (
    <Dialog
      open={!!person}
      onClose={close}
      icon={<KeyRound />}
      tone="primary"
      title={person ? `Create a login for ${person.name}` : "Create login"}
      description="They will see the Sales screens with their own Salesforce records."
      footer={
        <>
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button
            variant="default"
            loading={create.isPending}
            disabled={!email.trim()}
            onClick={() =>
              person &&
              create.mutate(
                { sfUserId: person.sfUserId, role, email: email.trim() },
                { onSuccess: (res) => setCreated(res) },
              )
            }
          >
            Create login
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Email they sign in with" htmlFor="sales-login-email" required hint="Defaults to their Salesforce email.">
          <Input id="sales-login-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={255} />
        </Field>
        <Field label="Role" htmlFor="sales-login-role" hint="Sales Managers see everyone's records and the Team screen.">
          <Select id="sales-login-role" value={role} onChange={(e) => setRole(e.target.value as SalesRole)}>
            <option value="SALES_EXECUTIVE">Sales Executive — own records only</option>
            <option value="SALES_MANAGER">Sales Manager — everyone&apos;s records</option>
          </Select>
        </Field>
        {create.isError && <p className="text-sm text-text-destructive">{create.error.messages.join(" · ")}</p>}
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------- sync */

const RUN_TONE: Record<string, "success" | "warning" | "danger" | "neutral" | "accent"> = {
  success: "success",
  partial: "warning",
  error: "danger",
  skipped: "neutral",
  running: "accent",
};

function SyncTab() {
  const { toast } = useToast();
  const status = useSyncStatus();
  const run = useRunSync();
  const [confirmFull, setConfirmFull] = useState(false);

  const start = (full: boolean) =>
    run.mutate(
      { full },
      {
        onSuccess: (r: SyncRun) =>
          toast({
            variant: r.status === "success" ? "success" : r.status === "error" ? "error" : "warning",
            title: `Sync ${r.status}`,
            description: `${r.upserted} records updated · ${r.deleted} removed · ${r.apiCalls} Salesforce API calls${r.error ? ` · ${r.error}` : ""}`,
          }),
        onError: (err) => toast({ variant: "error", title: "Sync failed to start", description: err.messages.join(" · ") }),
        onSettled: () => setConfirmFull(false),
      },
    );

  if (status.isError) {
    return (
      <Card>
        <ErrorState error={status.error} onRetry={() => status.refetch()} />
      </Card>
    );
  }
  const s = status.data;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile
          label="Salesforce connection"
          value={s ? (s.configured ? "Set up" : "Not set up") : "—"}
          tone={s ? (s.configured ? "ok" : "warning") : "neutral"}
          status={s && !s.configured ? "API credentials missing on the server" : undefined}
          loading={status.isPending}
        />
        <StatTile
          label="Last good sync"
          value={s ? formatAgo(s.lastSuccessAt) : "—"}
          hint={s?.lastSuccessAt ? formatDateTime(s.lastSuccessAt) : undefined}
          loading={status.isPending}
        />
        <StatTile
          label="Salesforce API calls, last 24h"
          value={s?.apiCallsLast24h ?? 0}
          hint="Counted by the sync itself. Salesforce allows far more per day; this is here so usage stays visible."
          loading={status.isPending}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="default" loading={run.isPending && !confirmFull} disabled={!s?.configured || run.isPending} onClick={() => start(false)}>
          <RefreshCw />
          Sync now
        </Button>
        <Button variant="outline" disabled={!s?.configured || run.isPending} onClick={() => setConfirmFull(true)}>
          Full re-copy
        </Button>
        <span className="text-xs text-muted-foreground">
          A sync copies what changed since the last one and may take up to a minute.
        </span>
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">What&apos;s copied</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Salesforce object</TableHead>
              <TableHead align="right">Records</TableHead>
              <TableHead>Last copied</TableHead>
              <TableHead>Changes up to</TableHead>
              <TableHead>Last error</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {status.isPending && (
              <TableRow>
                <TableCell colSpan={5}>
                  <Skeleton className="h-5 w-full" />
                </TableCell>
              </TableRow>
            )}
            {s && s.objects.length === 0 && (
              <TableMessageRow colSpan={5}>
                <EmptyState title="Nothing copied yet" description="Run the first sync once the connection is set up." />
              </TableMessageRow>
            )}
            {s?.objects.map((o) => (
              <TableRow key={o.objectName}>
                <TableCell className="font-medium">{o.objectName}</TableCell>
                <TableCell align="right">{o.recordCount.toLocaleString("en-US")}</TableCell>
                <TableCell className="whitespace-nowrap">{formatDateTime(o.lastSuccessAt)}</TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">{formatDateTime(o.lastModstamp)}</TableCell>
                <TableCell className="max-w-[320px] truncate text-text-destructive" title={o.lastError ?? undefined}>
                  {o.lastError ?? ""}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Recent runs</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Started</TableHead>
              <TableHead>Trigger</TableHead>
              <TableHead>Result</TableHead>
              <TableHead align="right">Updated</TableHead>
              <TableHead align="right">Removed</TableHead>
              <TableHead align="right">API calls</TableHead>
              <TableHead>Took</TableHead>
              <TableHead>Error</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {s && s.runs.length === 0 && (
              <TableMessageRow colSpan={8}>
                <EmptyState title="No runs yet" />
              </TableMessageRow>
            )}
            {s?.runs.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="whitespace-nowrap">{formatDateTime(r.startedAt)}</TableCell>
                <TableCell>{r.trigger}</TableCell>
                <TableCell>
                  <Badge tone={RUN_TONE[r.status] ?? "neutral"} icon={r.status === "running" || r.status === "skipped" ? false : undefined}>
                    {r.status}
                  </Badge>
                </TableCell>
                <TableCell align="right">{r.upserted.toLocaleString("en-US")}</TableCell>
                <TableCell align="right">{r.deleted.toLocaleString("en-US")}</TableCell>
                <TableCell align="right">{r.apiCalls}</TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">{duration(r.startedAt, r.finishedAt)}</TableCell>
                <TableCell className="max-w-[280px] truncate text-text-destructive" title={r.error ?? undefined}>
                  {r.error ?? ""}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>

      <Dialog
        open={confirmFull}
        onClose={() => !run.isPending && setConfirmFull(false)}
        tone="warning"
        icon={<RefreshCw />}
        title="Re-copy everything?"
        description="Fetches every record again and checks each object against Salesforce for anything deleted. It uses more Salesforce API calls; if one run runs out of time it shows as partial and the next syncs carry on from there. Use it only if the copy looks wrong."
        footer={
          <>
            <Button variant="outline" disabled={run.isPending} onClick={() => setConfirmFull(false)}>
              Cancel
            </Button>
            <Button variant="default" loading={run.isPending} onClick={() => start(true)}>
              Re-copy
            </Button>
          </>
        }
      />
    </div>
  );
}

function duration(start: string, end: string | null): string {
  if (!end) return "—";
  const s = Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}
