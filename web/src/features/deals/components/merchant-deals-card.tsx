"use client";

import { useState } from "react";
import Link from "next/link";
import { KanbanSquare, Plus } from "lucide-react";
import { Badge, Button, Card, SectionHead } from "@/components/ui";
import { useCan } from "@/features/auth/use-can";
import { STAGE_LABEL, STAGE_TONE, formatDay, money } from "../labels";
import { useDealBoard, useDealList } from "../queries";
import { NewDealDialog } from "./new-deal-dialog";

/** On a merchant's Overview: this restaurant's deals, newest first, and a way to start one. */
export function MerchantDealsCard({ merchantId, restaurantName }: { merchantId: string; restaurantName: string }) {
  const can = useCan();
  const canView = can("deals.view");
  const canManage = can("deals.manage");
  const list = useDealList({ merchantId, limit: 20, sortBy: "createdAt", order: "desc" }, { enabled: canView });
  const board = useDealBoard({ limit: 1 }, { enabled: canView && canManage });
  const [open, setOpen] = useState(false);
  if (!canView) return null;
  const rows = list.data?.data ?? [];
  const openCount = rows.filter((d) => d.stage !== "LIVE" && d.stage !== "LOST").length;
  return (
    <section className="flex flex-col gap-3" data-testid="merchant-deals-card">
      <SectionHead
        title="Deals"
        description={
          list.isPending
            ? "Loading…"
            : rows.length === 0
              ? "No deal has been opened for this restaurant."
              : `${openCount} open · ${rows.length} in total. The deal's stage drives this merchant's status.`
        }
      />
      <Card>
        <div className="flex flex-col gap-2">
          {list.isPending ? (
            <p className="text-table text-muted-foreground">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-table text-muted-foreground">Nothing yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {rows.map((d) => (
                <li key={d.id}>
                  <Link href={`/deals?deal=${d.id}`} className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2 hover:border-primary" data-testid="merchant-deal">
                    <span className="text-xs text-muted-foreground tabular">{d.key}</span>
                    <Badge tone={STAGE_TONE[d.stage]} icon={false}>
                      {STAGE_LABEL[d.stage]}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{d.owner?.name ?? "Unassigned"}</span>
                    {d.organization ? <span className="text-xs text-muted-foreground">via {d.organization.name}</span> : null}
                    <span className="ml-auto text-xs text-muted-foreground tabular">
                      {d.amountMonthly ? `${money(d.amountMonthly)}/mo · ` : ""}
                      {formatDay(d.stageChangedAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {canManage ? (
            <div className="flex flex-wrap gap-2">
              <Button variant={rows.length === 0 ? "default" : "outline"} size="sm" onClick={() => setOpen(true)} data-testid="merchant-new-deal">
                <Plus className="size-4" /> New deal
              </Button>
              {rows.length > 0 ? (
                <Link href={`/deals?view=list`} className="inline-flex h-7 items-center gap-1 px-2 text-xs font-medium text-foreground underline underline-offset-4">
                  <KanbanSquare className="size-3.5" /> All deals
                </Link>
              ) : null}
            </div>
          ) : null}
        </div>
      </Card>
      <NewDealDialog open={open} onClose={() => setOpen(false)} merchantId={merchantId} merchantName={restaurantName} organizations={board.data?.organizations ?? []} owners={board.data?.owners ?? []} />
    </section>
  );
}
