"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, ChevronLeft, ChevronRight, RefreshCw, Search, Video } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableMessageRow,
  TableRow,
  useToast,
} from "@/components/ui";
import { MerchantSelect, type MerchantValue } from "@/features/tickets/components/merchant-select";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils/cn";
import { useFathomStatus, useMeetings, useSyncFathom } from "../api";
import type { FathomStatus, MeetingSummary } from "../types";

const PAGE = 20;

export function MeetingsPage() {
  const [search, setSearch] = useState("");
  const [merchant, setMerchant] = useState<MerchantValue | null>(null);
  const [mine, setMine] = useState(false);
  const [openActions, setOpenActions] = useState(false);
  const [page, setPage] = useState(1);
  const query = { search: search.trim() || undefined, merchantId: merchant?.id, mine: mine || undefined, openActions: openActions || undefined, page, limit: PAGE };
  const { data, isPending, error } = useMeetings(query);
  const status = useFathomStatus();
  const sync = useSyncFathom();
  const { toast } = useToast();
  const reset = () => setPage(1);
  const total = data?.meta.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));

  const runSync = () =>
    sync.mutate(undefined, {
      onSuccess: (r) =>
        toast({
          variant: "success",
          title: r.added ? `${r.added} new meeting${r.added === 1 ? "" : "s"} from Fathom` : "Up to date",
          description: `${r.fetched} checked · ${r.updated} updated`,
        }),
      onError: (e) => toast({ variant: "error", title: "Fathom sync failed", description: e.messages?.[0] ?? e.message }),
    });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-[-0.011em] text-foreground">Meetings</h1>
          <p className="mt-1 text-table text-muted-foreground">
            Calls recorded by Fathom, matched to merchants — with the summary, transcript and action items that become tickets.
          </p>
        </div>
        {status.data?.canSync && (
          <Button
            variant="default"
            size="sm"
            loading={sync.isPending}
            disabled={!status.data.apiKeySet}
            title={status.data.apiKeySet ? "Pull new meetings from Fathom now" : "Add FATHOM_API_KEY to the API's environment variables first"}
            onClick={runSync}
          >
            <RefreshCw className="size-4" />
            Sync from Fathom
          </Button>
        )}
      </div>

      {status.data && <FathomStrip s={status.data} />}

      <div className="flex flex-wrap items-center gap-2">
        <label className="relative w-full max-w-xs">
          <span className="sr-only">Search meetings</span>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              reset();
            }}
            placeholder="Search titles and notes"
            className="pl-8"
          />
        </label>
        <div className="w-64">
          <MerchantSelect
            value={merchant}
            placeholder="All merchants — or search…"
            onChange={(m) => {
              setMerchant(m);
              reset();
            }}
          />
        </div>
        <Toggle on={mine} onClick={() => (setMine((v) => !v), reset())}>
          Meetings I was in
        </Toggle>
        <Toggle on={openActions} onClick={() => (setOpenActions((v) => !v), reset())}>
          Open action items
        </Toggle>
      </div>

      {!isPending && total === 0 && !query.search && !merchant && !mine && !openActions ? (
        <Card>
          <EmptyState
            icon={Video}
            title="No meetings yet"
            description={
              status.data?.apiKeySet
                ? "Click “Sync from Fathom” to pull your recent calls."
                : "Add a Fathom API key (FATHOM_API_KEY) to the API's environment variables and redeploy it — or run `python -m scripts.seed_meetings` to try it with sample meetings."
            }
          />
        </Card>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Meeting</TableHead>
              <TableHead>When</TableHead>
              <TableHead>Who</TableHead>
              <TableHead>Notes</TableHead>
              <TableHead>Action items</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isPending ? (
              <TableMessageRow colSpan={5}>
                <Skeleton className="h-6 w-full" />
              </TableMessageRow>
            ) : error ? (
              <TableMessageRow colSpan={5}>{error.messages?.[0] ?? error.message}</TableMessageRow>
            ) : !data?.data.length ? (
              <TableMessageRow colSpan={5}>No meetings match these filters.</TableMessageRow>
            ) : (
              data.data.map((m) => <Row key={m.id} m={m} />)
            )}
          </TableBody>
        </Table>
      )}

      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm text-muted-foreground">
          {total} meetings · page {page} of {pages}
          <Button size="icon-sm" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            <ChevronLeft />
          </Button>
          <Button size="icon-sm" aria-label="Next page" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            <ChevronRight />
          </Button>
        </div>
      )}
    </div>
  );
}

function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "h-8 rounded-lg border px-3 text-sm transition-colors",
        on ? "border-primary bg-accent font-medium text-primary-subtle-foreground" : "border-border bg-card text-foreground hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

function Row({ m }: { m: MeetingSummary }) {
  const internal = m.attendees.filter((a) => !a.isExternal);
  const guests = m.attendees.filter((a) => a.isExternal);
  return (
    <TableRow interactive>
      <TableCell>
        <Link href={`/ops/meetings/${m.id}`} className="font-medium text-foreground hover:text-primary hover:underline">
          {m.title}
        </Link>
        {m.source === "DEMO" && (
          <Badge tone="outline" icon={false} className="ml-2 align-middle">
            Sample
          </Badge>
        )}
        <div className="text-xs text-muted-foreground">
          {m.merchant ? m.merchant.name : "Internal"}
          {m.project ? ` · ${m.project.name}` : ""}
        </div>
      </TableCell>
      <TableCell className="whitespace-nowrap">
        <div className="text-sm text-foreground">{m.startedAt ? formatDateTime(m.startedAt) : "—"}</div>
        <div className="text-xs text-muted-foreground">{m.durationMinutes != null ? `${m.durationMinutes} min` : ""}</div>
      </TableCell>
      <TableCell>
        <div className="flex items-center">
          {internal.slice(0, 4).map((a, i) => (
            <span
              key={(a.email ?? a.name) + i}
              title={a.name}
              className="-ml-1 grid size-6 place-items-center rounded-full border-2 border-card bg-primary text-[10px] font-semibold text-primary-foreground first:ml-0"
            >
              {initials(a.name)}
            </span>
          ))}
          {internal.length > 4 && <span className="ml-1 text-xs text-muted-foreground">+{internal.length - 4}</span>}
        </div>
        {guests.length > 0 && (
          <div className="mt-0.5 text-xs text-muted-foreground">
            + {guests.length} guest{guests.length === 1 ? "" : "s"}
          </div>
        )}
      </TableCell>
      <TableCell>
        {m.hasSummary ? <Badge tone="success">Summary ready</Badge> : <Badge tone="neutral">Processing</Badge>}
      </TableCell>
      <TableCell className="whitespace-nowrap">
        {m.actions.open > 0 && <Badge tone="warning">{m.actions.open} to review</Badge>}
        {m.actions.ticket > 0 && (
          <span className="ml-1 text-xs text-muted-foreground">
            {m.actions.ticket} ticket{m.actions.ticket === 1 ? "" : "s"}
          </span>
        )}
        {m.actions.open + m.actions.ticket + m.actions.dismissed === 0 && <span className="text-xs text-muted-foreground">None</span>}
        {m.actions.open === 0 && m.actions.ticket + m.actions.dismissed > 0 && m.actions.ticket === 0 && (
          <span className="text-xs text-muted-foreground">All reviewed</span>
        )}
      </TableCell>
    </TableRow>
  );
}

function FathomStrip({ s }: { s: FathomStatus }) {
  const last = s.lastWebhookAt && (!s.lastSyncAt || s.lastWebhookAt > s.lastSyncAt) ? s.lastWebhookAt : s.lastSyncAt;
  return (
    <Card className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-sm">
      <span className="font-medium text-foreground">Fathom</span>
      <Badge tone={s.apiKeySet ? "success" : "warning"}>{s.apiKeySet ? "API key set" : "No API key"}</Badge>
      <Badge tone={s.webhookSecretSet ? "success" : "neutral"} icon={false}>
        {s.webhookSecretSet ? "Webhook on" : "Webhook off"}
      </Badge>
      <span className="text-muted-foreground">{last ? `Last data ${formatDateTime(last)}` : "Nothing received yet"}</span>
      {s.openActions > 0 && <span className="text-muted-foreground">· {s.openActions} action items to review</span>}
      {s.lastError && (
        <span className="flex items-center gap-1 text-text-destructive">
          <AlertTriangle className="size-4" aria-hidden />
          {s.lastError}
        </span>
      )}
      <Link href="/settings/integrations" className="ml-auto text-xs font-medium text-primary hover:underline">
        Set up
      </Link>
    </Card>
  );
}
