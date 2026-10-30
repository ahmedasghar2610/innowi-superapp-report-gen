"use client";

import { Swords, Plus, Pencil, Trash2 } from "lucide-react";
import { Badge, Button, Card, EmptyState, ErrorState, Skeleton } from "@/components/ui";
import { useCompetitors } from "@/features/merchants/api";
import { useCrudManager } from "@/features/merchants/hooks/use-crud-manager";
import type { Competitor } from "@/features/merchants/types";
import { CompetitorFormDrawer } from "./competitor-form-drawer";
import { DeleteCompetitorDialog } from "./delete-competitor-dialog";

/**
 * Competitors tab (route: /merchants/[merchantId]/competitors). Lists the
 * merchant's named local competitors with create / edit / delete, live against
 * the competitors API.
 *
 * Rendered as a card list (one row per competitor). The API returns ranked
 * rows first (1 = primary), then unranked in insertion order.
 */
export function CompetitorsPanel({ merchantId }: { merchantId: string }) {
  const { data: rows, isPending, isError, error, refetch } = useCompetitors(merchantId);

  const { formOpen, editing, deleting, openCreate, openEdit, closeForm, requestDelete, cancelDelete } =
    useCrudManager<Competitor>();

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold leading-6 text-foreground">Competitors</h2>
          <p className="mt-0.5 text-xs leading-4 text-muted-foreground">
            Named local competitors — the workbook&apos;s Competitor 1–3, plus any added here.
          </p>
        </div>
        <Button variant="default" size="sm" onClick={openCreate}>
          <Plus className="size-4" />
          New competitor
        </Button>
      </div>

      {isError ? (
        <Card>
          <ErrorState title="Couldn't load competitors" error={error} onRetry={() => refetch()} />
        </Card>
      ) : isPending ? (
        <CompetitorsSkeleton />
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={Swords}
            title="No competitors yet"
            description="Add the local businesses this merchant competes with, ranked by how closely they overlap."
            action={
              <Button variant="default" size="sm" onClick={openCreate}>
                <Plus className="size-4" />
                New competitor
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
                  <Swords className="size-5" />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">{c.name}</span>
                    {c.rank !== null && <Badge tone="accent">#{c.rank}</Badge>}
                  </div>
                  <div className="mt-1 text-table text-muted-foreground">
                    {c.rank === null ? "Unranked" : c.rank === 1 ? "Primary competitor" : `Rank ${c.rank}`}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <Button variant="ghost" size="icon-sm" aria-label={`Edit ${c.name}`} onClick={() => openEdit(c)}>
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Delete ${c.name}`}
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

      <CompetitorFormDrawer merchantId={merchantId} open={formOpen} onClose={closeForm} competitor={editing} />
      <DeleteCompetitorDialog merchantId={merchantId} competitor={deleting} onClose={cancelDelete} />
    </div>
  );
}

function CompetitorsSkeleton() {
  return (
    <Card>
      <div className="divide-y divide-border">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 p-4">
            <Skeleton className="size-10 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1">
              <Skeleton className="h-3.5 w-40" />
              <Skeleton className="mt-2 h-3 w-24" />
            </div>
            <Skeleton className="h-7 w-16 shrink-0" />
          </div>
        ))}
      </div>
    </Card>
  );
}
