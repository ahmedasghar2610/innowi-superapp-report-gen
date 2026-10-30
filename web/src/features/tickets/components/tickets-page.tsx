"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button, Tabs, TabsList, TabsTrigger } from "@/components/ui";
import { useCan } from "@/features/auth/use-can";
import { MerchantPagination } from "@/features/merchants/components/merchant-pagination";
import { useTicketCounts, useTickets } from "../api";
import { TYPE_LABEL, TYPE_ORDER } from "../labels";
import type { TicketType } from "../types";
import { TicketFilters, TicketViewSwitch, type TicketFilterState } from "./ticket-filters";
import { TicketFormDialog } from "./ticket-form-dialog";
import { TicketTable } from "./ticket-table";
import { CatchUpBanner, HandoverButton } from "./catch-up-banner";
import { SavedViews } from "./saved-views";

/**
 * /ops/tickets — every ticket, organised by team (type), project, priority
 * and assignee. Sorted by priority, then due date. Aima and Maheen (anyone
 * with ticket.manage) get the New ticket button.
 */
export function TicketsPage() {
  const can = useCan();
  const canManage = can("ticket.manage");
  const [type, setType] = useState<TicketType | "ALL">("ALL");
  const [filters, setFilters] = useState<TicketFilterState>({ view: "open" });
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [creating, setCreating] = useState(false);

  const query = { ...filters, type: type === "ALL" ? undefined : type, page, limit, sort: "priority" as const };
  const list = useTickets(query);
  const counts = useTicketCounts(filters);

  const patch = (p: Partial<TicketFilterState>) => {
    setFilters((f) => ({ ...f, ...p }));
    setPage(1);
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-[-0.011em] text-foreground">Tickets</h1>
          <p className="mt-1 text-table text-muted-foreground">
            Every request, with one owner and a due date. Use <span className="font-medium">Assignee: Me</span> for your own
            list.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <TicketViewSwitch />
          <HandoverButton />
          {canManage ? (
            <Button variant="default" size="sm" onClick={() => setCreating(true)}>
              <Plus className="size-4" />
              New ticket
            </Button>
          ) : null}
        </div>
      </div>

      <CatchUpBanner />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs
          value={type}
          onValueChange={(v) => {
            setType(v as TicketType | "ALL");
            setPage(1);
          }}
        >
          <TabsList>
            <TabsTrigger value="ALL" count={counts.data?.total}>
              All teams
            </TabsTrigger>
            {TYPE_ORDER.map((t) => (
              <TabsTrigger key={t} value={t} count={counts.data?.byType[t]}>
                {TYPE_LABEL[t]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="flex flex-wrap items-center gap-2">
          <TicketFilters value={filters} onChange={patch} />
          <SavedViews
            current={{ ...filters, type: type === "ALL" ? undefined : type }}
            onApply={(f) => {
              const { type: t, ...rest } = f;
              setType((t as TicketType) ?? "ALL");
              setFilters({ view: "open", ...(rest as TicketFilterState) });
              setPage(1);
            }}
          />
        </div>
      </div>

      <div>
        <TicketTable
          tickets={list.data?.data ?? []}
          isPending={list.isPending}
          isError={list.isError}
          error={list.error}
          onRetry={() => list.refetch()}
          busy={list.isFetching && list.isPlaceholderData}
          empty={{
            title: "No tickets match",
            description: canManage
              ? "Change the filters, or create a ticket."
              : "Change the filters. New tickets are created by the ticket managers.",
          }}
        />
        {list.data?.meta && list.data.meta.total > 0 ? (
          <MerchantPagination
            meta={list.data.meta}
            onPageChange={setPage}
            onPageSizeChange={(l) => {
              setLimit(l);
              setPage(1);
            }}
          />
        ) : null}
      </div>

      <TicketFormDialog open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}
