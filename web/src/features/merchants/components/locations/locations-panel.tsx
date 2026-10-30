"use client";

import { MapPin, Plus, Pencil, Trash2, Star, Clock, Globe } from "lucide-react";
import { Badge, Button, Card, EmptyState, ErrorState, Skeleton } from "@/components/ui";
import { useLocations } from "@/features/merchants/api";
import { useCrudManager } from "@/features/merchants/hooks/use-crud-manager";
import type { Location } from "@/features/merchants/types";
import { LocationFormDrawer } from "./location-form-drawer";
import { DeleteLocationDialog } from "./delete-location-dialog";

/**
 * Locations tab (route: /merchants/[merchantId]/locations). Lists the merchant's
 * locations (primary-first, as the API returns them) with create / edit / delete.
 *
 * Rendered as a card list — each location is a row with a pin icon, address,
 * and a meta line for hours/timezone/NAP, rather than a data table.
 */
export function LocationsPanel({ merchantId }: { merchantId: string }) {
  const { data: rows, isPending, isError, error, refetch } = useLocations(merchantId);

  const { formOpen, editing, deleting, openCreate, openEdit, closeForm, requestDelete, cancelDelete } =
    useCrudManager<Location>();

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold leading-6 text-foreground">Locations</h2>
          <p className="mt-0.5 text-xs leading-4 text-muted-foreground">Addresses, hours and NAP for this merchant.</p>
        </div>
        <Button variant="default" size="sm" onClick={openCreate}>
          <Plus className="size-4" />
          New location
        </Button>
      </div>

      {isError ? (
        <Card>
          <ErrorState title="Couldn't load locations" error={error} onRetry={() => refetch()} />
        </Card>
      ) : isPending ? (
        <LocationsSkeleton />
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={MapPin}
            title="No locations yet"
            description="Add the merchant's address, opening hours and timezone."
            action={
              <Button variant="default" size="sm" onClick={openCreate}>
                <Plus className="size-4" />
                New location
              </Button>
            }
          />
        </Card>
      ) : (
        <Card>
          <div className="divide-y divide-border">
            {rows.map((l) => (
              <div key={l.id} className="flex flex-wrap items-center gap-4 p-4">
                <div className="grid size-10 shrink-0 place-items-center rounded-full bg-accent text-primary-hover">
                  <MapPin className="size-5" />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">
                      {l.address ?? <span className="text-muted-foreground">No address</span>}
                    </span>
                    {l.isPrimary && (
                      <Badge tone="accent" className="gap-1">
                        <Star className="size-4" /> Primary
                      </Badge>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-table text-muted-foreground">
                    {cityLine(l) && <span>{cityLine(l)}</span>}
                    {l.hours && (
                      <span className="inline-flex max-w-xs items-center gap-1.5">
                        <Clock className="size-4 shrink-0" />
                        <span className="line-clamp-1">{l.hours}</span>
                      </span>
                    )}
                    {l.timezone && (
                      <span className="inline-flex items-center gap-1.5">
                        <Globe className="size-4" /> {l.timezone}
                      </span>
                    )}
                    {l.napStatus && <span>NAP: {l.napStatus}</span>}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <Button variant="ghost" size="icon-sm" aria-label={`Edit ${l.address ?? "location"}`} onClick={() => openEdit(l)}>
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Delete ${l.address ?? "location"}`}
                    className="text-muted-foreground hover:text-text-destructive"
                    onClick={() => requestDelete(l)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <LocationFormDrawer merchantId={merchantId} open={formOpen} onClose={closeForm} location={editing} />
      <DeleteLocationDialog merchantId={merchantId} location={deleting} onClose={cancelDelete} />
    </div>
  );
}

/** "City, ST 90210" from the parts that exist. */
function cityLine(l: Location): string {
  const cityState = [l.city, l.state].filter(Boolean).join(", ");
  return [cityState, l.zip].filter(Boolean).join(" ").trim();
}

function LocationsSkeleton() {
  return (
    <Card>
      <div className="divide-y divide-border">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 p-4">
            <Skeleton className="size-10 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1">
              <Skeleton className="h-3.5 w-48" />
              <Skeleton className="mt-2 h-3 w-64" />
            </div>
            <Skeleton className="h-7 w-16 shrink-0" />
          </div>
        ))}
      </div>
    </Card>
  );
}
