"use client";

import { createContext, useContext, useMemo, useState } from "react";
import Link from "next/link";
import { CloudOff, Lock, ShieldAlert, UserX } from "lucide-react";
import { Card, EmptyState, ErrorState, Select, Skeleton } from "@/components/ui";
import { useAuth } from "@/features/auth/auth-context";
import { useCan } from "@/features/auth/use-can";
import { formatDateTime } from "@/lib/format";
import { useOwners, useSalesMe } from "../queries";
import { formatAgo } from "../format";
import type { OwnerQuery, SalesMe } from "../types";

interface SalesContextValue {
  me: SalesMe;
  /** Managers only: the salesperson picked in the header ("" = everyone). */
  ownerId: string;
  setOwnerId: (id: string) => void;
  /** The owner filter to spread into list queries. Empty for reps — the API pins them to themselves. */
  ownerQuery: OwnerQuery;
}

const SalesContext = createContext<SalesContextValue | null>(null);

export function useSalesContext(): SalesContextValue {
  const ctx = useContext(SalesContext);
  if (!ctx) throw new Error("useSalesContext must be used inside <SalesShell>");
  return ctx;
}

/**
 * Wraps every /sales route (app/(app)/sales/layout.tsx). It loads /sales/me once,
 * shows the right message when the person can't use the module yet, and keeps
 * the manager's "whose records" choice while they move between Sales screens.
 *
 * Every check here is a convenience. The API decides what each person sees:
 * reps only ever get their own records, whatever the browser asks for.
 */
export function SalesShell({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const can = useCan();
  const allowed = can("sales.view");
  const meQuery = useSalesMe({ enabled: allowed });
  const [ownerId, setOwnerId] = useState("");

  const me = meQuery.data;
  const value = useMemo<SalesContextValue | null>(() => {
    if (!me) return null;
    const effectiveOwner = me.seeAll ? ownerId : "";
    return { me, ownerId: effectiveOwner, setOwnerId, ownerQuery: effectiveOwner ? { ownerId: effectiveOwner } : {} };
  }, [me, ownerId]);

  if (user === undefined) return <ShellSkeleton />;

  if (!allowed) {
    return (
      <Card>
        <EmptyState
          icon={ShieldAlert}
          title="No access to Sales"
          description="The Sales screens are for Innowi's sales team. Ask an admin to give your login the Sales Executive or Sales Manager role."
        />
      </Card>
    );
  }

  if (meQuery.isPending) return <ShellSkeleton />;
  if (meQuery.isError || !value) {
    return (
      <Card>
        <ErrorState title="Couldn't load Sales" error={meQuery.error} onRetry={() => meQuery.refetch()} />
      </Card>
    );
  }

  if (!value.me.linked && !value.me.seeAll) {
    return (
      <Card>
        <EmptyState
          icon={UserX}
          title="Your login isn't linked to Salesforce yet"
          description="An admin needs to connect this login to your Salesforce user. Until then there is nothing to show you."
        />
      </Card>
    );
  }

  return (
    <SalesContext.Provider value={value}>
      <ReadOnlyNotice />
      {!value.me.configured && (
        <div className="mb-4 flex items-start gap-3 rounded-[var(--radius-card)] border border-border bg-warning-soft px-4 py-3 text-sm text-warning-text">
          <CloudOff className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>
            {value.me.lastSyncAt
              ? `Salesforce isn't connected to the SuperApp right now, so this copy isn't being refreshed. It was last updated ${formatAgo(value.me.lastSyncAt)}.`
              : "Salesforce isn't connected to the SuperApp yet, so nothing has been copied over. The screens below will fill in after the first sync."}
          </p>
        </div>
      )}
      {children}
    </SalesContext.Provider>
  );
}

/**
 * Shown on every Salesforce screen so nobody mistakes this copy for the Super
 * App's own records (2026-10-27: "make this super clean and not confuse people").
 */
function ReadOnlyNotice() {
  return (
    <div
      className="mb-4 flex items-start gap-3 rounded-[var(--radius-card)] border border-border bg-muted px-4 py-2.5 text-sm text-muted-foreground"
      data-testid="salesforce-readonly-notice"
    >
      <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p>
        <span className="font-medium text-foreground">Read-only copy of Salesforce.</span> Nothing here is a Super App
        record or can be edited here. The Super App&apos;s own restaurants, partners and deals are in{" "}
        <Link href="/merchants" className="font-medium text-foreground underline underline-offset-4">
          Merchants
        </Link>
        ,{" "}
        <Link href="/organizations" className="font-medium text-foreground underline underline-offset-4">
          Organizations
        </Link>{" "}
        and{" "}
        <Link href="/deals" className="font-medium text-foreground underline underline-offset-4">
          Deals
        </Link>
        .
      </p>
    </div>
  );
}

function ShellSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

/**
 * Page title row for every Sales screen: title, one-line description, the
 * last-synced time and — for managers — a "whose records" picker.
 */
export function SalesPageHeader({
  title,
  description,
  showOwnerPicker = true,
  actions,
}: {
  title: string;
  description?: string;
  showOwnerPicker?: boolean;
  actions?: React.ReactNode;
}) {
  const { me, ownerId, setOwnerId } = useSalesContext();
  const pick = showOwnerPicker && me.seeAll;
  const owners = useOwners({ enabled: pick });

  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-[-0.011em] text-foreground">{title}</h1>
        {description && <p className="mt-1 text-table text-muted-foreground">{description}</p>}
        <p className="mt-1 text-xs text-muted-foreground" title={me.lastSyncAt ? formatDateTime(me.lastSyncAt) : undefined}>
          {me.linked && me.sfUserName ? `Signed in as ${me.sfUserName} in Salesforce · ` : ""}
          Salesforce data copied {formatAgo(me.lastSyncAt)}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {actions}
        {pick && (
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            Showing
            <Select
              aria-label="Whose records"
              value={ownerId}
              onChange={(e) => setOwnerId(e.target.value)}
              className="w-56"
              disabled={owners.isPending}
            >
              <option value="">Everyone</option>
              {(owners.data ?? []).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </label>
        )}
      </div>
    </div>
  );
}
