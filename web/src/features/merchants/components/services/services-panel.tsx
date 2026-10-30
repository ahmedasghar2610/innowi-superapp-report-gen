"use client";

import { Layers, Plus, Pencil, CircleMinus, CalendarCheck } from "lucide-react";
import { Badge, type BadgeTone, Button, Card, EmptyState, ErrorState, Skeleton } from "@/components/ui";
import { useServices } from "@/features/merchants/api";
import { useCrudManager } from "@/features/merchants/hooks/use-crud-manager";
import { formatDate, humanize } from "@/lib/format";
import type { MerchantService, MerchantServiceStatus } from "@/features/merchants/types";
import { ServiceFormDrawer } from "./service-form-drawer";
import { RemoveServiceDialog } from "./remove-service-dialog";

const STATUS_TONE: Record<MerchantServiceStatus, BadgeTone> = {
  ACTIVE: "success",
  PAUSED: "warning",
  INACTIVE: "neutral",
};

/**
 * Services tab (route: /merchants/[merchantId]/services). Lists the merchant's
 * entitlements (catalogue-joined) and manages them: add (activate a catalogue
 * service), update (status / date / notes) and remove (set inactive or delete).
 *
 * Rendered as a card list — each service is a row with its category/status
 * badges and activation meta, rather than a data table.
 */
export function ServicesPanel({ merchantId }: { merchantId: string }) {
  const { data: rows, isPending, isError, error, refetch } = useServices(merchantId);

  const {
    formOpen,
    editing,
    deleting: removing,
    openCreate: openAdd,
    openEdit,
    closeForm,
    requestDelete,
    cancelDelete,
  } = useCrudManager<MerchantService>();

  const takenServiceIds = rows?.map((r) => r.serviceId) ?? [];
  const activeCount = rows?.filter((r) => r.status === "ACTIVE").length ?? 0;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold leading-6 text-foreground">Services</h2>
          <p className="mt-0.5 text-xs leading-4 text-muted-foreground">
            Catalogue services activated for this merchant{rows && rows.length > 0 ? ` · ${activeCount} active` : ""}.
          </p>
        </div>
        <Button variant="default" size="sm" onClick={openAdd}>
          <Plus className="size-4" />
          Add service
        </Button>
      </div>

      {isError ? (
        <Card>
          <ErrorState title="Couldn't load services" error={error} onRetry={() => refetch()} />
        </Card>
      ) : isPending ? (
        <ServicesSkeleton />
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={Layers}
            title="No services yet"
            description="Activate the catalogue services this merchant is entitled to — SMS/Email, SEO, GMB, and so on."
            action={
              <Button variant="default" size="sm" onClick={openAdd}>
                <Plus className="size-4" />
                Add service
              </Button>
            }
          />
        </Card>
      ) : (
        <Card>
          <div className="divide-y divide-border">
            {rows.map((s) => (
              <div key={s.id} className="flex flex-wrap items-center gap-4 p-4">
                <div className="grid size-10 shrink-0 place-items-center rounded-full bg-accent text-primary-hover">
                  <Layers className="size-5" />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">{s.serviceName}</span>
                    <Badge tone="accent">{humanize(s.serviceCategory)}</Badge>
                    <Badge tone={STATUS_TONE[s.status] ?? "neutral"}>{humanize(s.status)}</Badge>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-table text-muted-foreground">
                    {s.activatedAt && (
                      <span className="inline-flex items-center gap-1.5">
                        <CalendarCheck className="size-4" /> Activated {formatDate(s.activatedAt)}
                      </span>
                    )}
                    {s.notes && <span className="line-clamp-1 max-w-sm">{s.notes}</span>}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <Button variant="ghost" size="icon-sm" aria-label={`Edit ${s.serviceName}`} onClick={() => openEdit(s)}>
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove ${s.serviceName}`}
                    className="text-muted-foreground hover:text-text-destructive"
                    onClick={() => requestDelete(s)}
                  >
                    <CircleMinus className="size-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <ServiceFormDrawer
        merchantId={merchantId}
        open={formOpen}
        onClose={closeForm}
        service={editing}
        takenServiceIds={takenServiceIds}
      />
      <RemoveServiceDialog merchantId={merchantId} service={removing} onClose={cancelDelete} />
    </div>
  );
}

function ServicesSkeleton() {
  return (
    <Card>
      <div className="divide-y divide-border">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 p-4">
            <Skeleton className="size-10 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1">
              <Skeleton className="h-3.5 w-40" />
              <Skeleton className="mt-2 h-3 w-52" />
            </div>
            <Skeleton className="h-7 w-16 shrink-0" />
          </div>
        ))}
      </div>
    </Card>
  );
}
