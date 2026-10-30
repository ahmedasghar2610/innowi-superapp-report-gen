"use client";

import { Plug, Plus, Pencil, Trash2, TriangleAlert, UserRound, CalendarClock } from "lucide-react";
import { Button, Card, EmptyState, ErrorState, Skeleton } from "@/components/ui";
import { useConnections } from "@/features/merchants/api";
import { useCrudManager } from "@/features/merchants/hooks/use-crud-manager";
import { formatDate } from "@/lib/format";
import type { Connection } from "@/features/merchants/types";
import { CriticalityBadge, StatusBadge, FlagBadge } from "./connection-badges";
import { ConnectionFormDrawer } from "./connection-form-drawer";
import { DeleteConnectionDialog } from "./delete-connection-dialog";

/**
 * Connections tab (route: /merchants/[merchantId]/connections). Lists the access
 * items (most-critical first, as the API returns them), with create / edit /
 * delete. Backs the onboarding "blockers" view, so blockers are surfaced in the
 * header count.
 *
 * Rendered as a card list — each access item is a row with its criticality,
 * status and flag badges together, and a meta line for owner/date, rather
 * than a data table.
 */
export function ConnectionsPanel({ merchantId }: { merchantId: string }) {
  const { data: rows, isPending, isError, error, refetch } = useConnections(merchantId);

  const { formOpen, editing, deleting, openCreate, openEdit, closeForm, requestDelete, cancelDelete } =
    useCrudManager<Connection>();

  const blockers = rows?.filter((c) => c.flag === "BLOCKER").length ?? 0;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold leading-6 text-foreground">Access</h2>
          <p className="mt-0.5 text-xs leading-4 text-muted-foreground">
            Logins and access the team needs from the restaurant (Google Business Profile, website admin, domain, POS…) and where each request stands. Linked SEO sites and Ads accounts are under Overview → Connected modules.
            {blockers > 0 && (
              <span className="ml-1.5 inline-flex items-center gap-1 font-medium text-text-destructive">
                <TriangleAlert className="size-4" />
                {blockers} blocker{blockers === 1 ? "" : "s"}
              </span>
            )}
          </p>
        </div>
        <Button variant="default" size="sm" onClick={openCreate}>
          <Plus className="size-4" />
          New access item
        </Button>
      </div>

      {isError ? (
        <Card>
          <ErrorState title="Couldn't load access items" error={error} onRetry={() => refetch()} />
        </Card>
      ) : isPending ? (
        <ConnectionsSkeleton />
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={Plug}
            title="No access items yet"
            description="Add the third-party access items this merchant needs — Google Business Profile, Meta, POS back office, and so on."
            action={
              <Button variant="default" size="sm" onClick={openCreate}>
                <Plus className="size-4" />
                New access item
              </Button>
            }
          />
        </Card>
      ) : (
        <Card>
          <div className="divide-y divide-border">
            {rows.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center gap-4 p-4">
                <div className="grid size-10 shrink-0 place-items-center rounded-full bg-accent text-primary-hover">
                  <Plug className="size-5" />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">{c.accessItem}</span>
                    <CriticalityBadge value={c.criticality} />
                    <StatusBadge value={c.status} />
                    <FlagBadge value={c.flag} />
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-table text-muted-foreground">
                    {c.owner && (
                      <span className="inline-flex items-center gap-1.5">
                        <UserRound className="size-4" /> {c.owner}
                      </span>
                    )}
                    {c.dateRequested && (
                      <span className="inline-flex items-center gap-1.5">
                        <CalendarClock className="size-4" /> Requested {formatDate(c.dateRequested)}
                      </span>
                    )}
                    {c.notes && <span className="line-clamp-1 max-w-sm">{c.notes}</span>}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <Button variant="ghost" size="icon-sm" aria-label={`Edit ${c.accessItem}`} onClick={() => openEdit(c)}>
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Delete ${c.accessItem}`}
                    className="text-muted-foreground hover:text-text-destructive"
                    onClick={() => requestDelete(c)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <ConnectionFormDrawer merchantId={merchantId} open={formOpen} onClose={closeForm} connection={editing} />
      <DeleteConnectionDialog merchantId={merchantId} connection={deleting} onClose={cancelDelete} />
    </div>
  );
}

function ConnectionsSkeleton() {
  return (
    <Card>
      <div className="divide-y divide-border">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 p-4">
            <Skeleton className="size-10 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1">
              <Skeleton className="h-3.5 w-44" />
              <Skeleton className="mt-2 h-3 w-56" />
            </div>
            <Skeleton className="h-7 w-16 shrink-0" />
          </div>
        ))}
      </div>
    </Card>
  );
}
