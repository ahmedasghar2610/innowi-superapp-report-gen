"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button, Select } from "@/components/ui";
import { useCan } from "@/features/auth/use-can";
import { useMerchant } from "@/features/merchants/api";
import { MerchantPagination } from "@/features/merchants/components/merchant-pagination";
import { useTickets } from "../api";
import type { TicketView } from "../types";
import { TicketFormDialog } from "./ticket-form-dialog";
import { TicketTable } from "./ticket-table";

/** /merchants/[id]/tickets — this merchant's tickets, with a shortcut to create one. */
export function MerchantTicketsPanel({ merchantId }: { merchantId: string }) {
  const can = useCan();
  const { data: merchant } = useMerchant(merchantId);
  const [view, setView] = useState<TicketView>("open");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const list = useTickets({ merchantId, view, sort: view === "done" ? "updated" : "priority", page, limit: 25 });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-foreground">Tickets</h2>
        <div className="flex items-center gap-2">
          <Select
            aria-label="Show"
            className="w-auto"
            value={view}
            onChange={(e) => {
              setView(e.target.value as TicketView);
              setPage(1);
            }}
          >
            <option value="open">Open</option>
            <option value="done">Done</option>
            <option value="all">All</option>
          </Select>
          {can("ticket.manage") ? (
            <Button variant="default" size="sm" onClick={() => setCreating(true)} disabled={!merchant}>
              <Plus className="size-4" />
              New ticket for this merchant
            </Button>
          ) : null}
        </div>
      </div>
      <TicketTable
        tickets={list.data?.data ?? []}
        isPending={list.isPending}
        isError={list.isError}
        error={list.error}
        onRetry={() => list.refetch()}
        busy={list.isFetching && list.isPlaceholderData}
        showMerchant={false}
        empty={{ title: view === "open" ? "No open tickets for this merchant" : "No tickets" }}
      />
      {list.data?.meta && list.data.meta.pageCount > 1 ? <MerchantPagination meta={list.data.meta} onPageChange={setPage} /> : null}
      <TicketFormDialog
        open={creating}
        onClose={() => setCreating(false)}
        defaultMerchant={merchant ? { id: merchant.id, name: merchant.restaurantName } : null}
      />
    </div>
  );
}
