"use client";

import { Tag, Plus, Pencil, Trash2, Calendar, Ticket } from "lucide-react";
import { Badge, Button, Card, EmptyState, ErrorState, Skeleton } from "@/components/ui";
import type { BadgeTone } from "@/components/ui";
import { usePromotions } from "@/features/merchants/api";
import { useCrudManager } from "@/features/merchants/hooks/use-crud-manager";
import { formatDate, humanize } from "@/lib/format";
import type { Promotion, PromotionStatus } from "@/features/merchants/types";
import { PromotionFormDrawer } from "./promotion-form-drawer";
import { DeletePromotionDialog } from "./delete-promotion-dialog";

const STATUS_TONE: Record<PromotionStatus, BadgeTone> = {
  ACTIVE: "success",
  SCHEDULED: "accent",
  DRAFT: "neutral",
  ENDED: "neutral",
  EXPIRED: "warning",
  NO_PROMOTION: "neutral",
};

/**
 * Promotions tab (route: /merchants/[merchantId]/promotions). Profiling's
 * master list of a merchant's promotions/offers (PRD Appendix C-7 / PROF-01
 * §6.2.4) — GBP, Google Ads and Email/SMS are expected to reference these
 * read-only and track their own channel-specific status separately.
 */
export function PromotionsPanel({ merchantId }: { merchantId: string }) {
  const { data: rows, isPending, isError, error, refetch } = usePromotions(merchantId);

  const { formOpen, editing, deleting, openCreate, openEdit, closeForm, requestDelete, cancelDelete } =
    useCrudManager<Promotion>();

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold leading-6 text-foreground">Promotions</h2>
          <p className="mt-0.5 text-xs leading-4 text-muted-foreground">
            The master list of this merchant&rsquo;s promotions and offers.
          </p>
        </div>
        <Button variant="default" size="sm" onClick={openCreate}>
          <Plus className="size-4" />
          New promotion
        </Button>
      </div>

      {isError ? (
        <Card>
          <ErrorState title="Couldn't load promotions" error={error} onRetry={() => refetch()} />
        </Card>
      ) : isPending ? (
        <PromotionsSkeleton />
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={Tag}
            title="No promotions yet"
            description="Add a promotion or offer to track it here."
            action={
              <Button variant="default" size="sm" onClick={openCreate}>
                <Plus className="size-4" />
                New promotion
              </Button>
            }
          />
        </Card>
      ) : (
        <Card>
          <div className="divide-y divide-border">
            {rows.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center gap-4 p-4">
                <div className="grid size-10 shrink-0 place-items-center rounded-full bg-accent text-primary-hover">
                  <Tag className="size-5" />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">{p.promoName || "Untitled promotion"}</span>
                    <Badge tone={STATUS_TONE[p.status]}>{humanize(p.status)}</Badge>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-table text-muted-foreground">
                    {p.offerValue && <span>{p.offerValue}</span>}
                    {p.channels && <span className="text-muted-foreground">{p.channels}</span>}
                    {p.promoCode && (
                      <span className="inline-flex items-center gap-1.5">
                        <Ticket className="size-4" /> {p.promoCode}
                      </span>
                    )}
                    {(p.startDate || p.endDate) && (
                      <span className="inline-flex items-center gap-1.5">
                        <Calendar className="size-4" />
                        {formatDate(p.startDate)} – {formatDate(p.endDate)}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Edit ${p.promoName || "promotion"}`}
                    onClick={() => openEdit(p)}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Delete ${p.promoName || "promotion"}`}
                    className="text-muted-foreground hover:text-text-destructive"
                    onClick={() => requestDelete(p)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <PromotionFormDrawer merchantId={merchantId} open={formOpen} onClose={closeForm} promotion={editing} />
      <DeletePromotionDialog merchantId={merchantId} promotion={deleting} onClose={cancelDelete} />
    </div>
  );
}

function PromotionsSkeleton() {
  return (
    <Card>
      <div className="divide-y divide-border">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 p-4">
            <Skeleton className="size-10 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1">
              <Skeleton className="h-3.5 w-48" />
              <Skeleton className="mt-2 h-3 w-56" />
            </div>
            <Skeleton className="h-7 w-16 shrink-0" />
          </div>
        ))}
      </div>
    </Card>
  );
}
