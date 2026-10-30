"use client";

import Link from "next/link";
import { useState } from "react";
import { StatTile } from "@/components/ui";
import { useAuth } from "@/features/auth/auth-context";
import { MerchantPagination } from "@/features/merchants/components/merchant-pagination";
import { useTickets } from "../api";
import { TicketFilters, type TicketFilterState } from "./ticket-filters";
import { TicketTable } from "./ticket-table";

/**
 * /ops/my-work — "Assigned to me": the Tickets list with Assignee = the
 * signed-in user, highest priority first.
 */
export function MyWorkPage() {
  const { user } = useAuth();
  const [filters, setFilters] = useState<TicketFilterState>({ view: "open" });
  const [page, setPage] = useState(1);
  const list = useTickets({ ...filters, assigneeId: "me", page, limit: 50, sort: "priority" });
  // Headline counts (independent of the filters below).
  const open = useTickets({ assigneeId: "me", view: "open", limit: 1 });
  const urgent = useTickets({ assigneeId: "me", view: "open", priority: "URGENT,HIGH", limit: 1 });
  const overdue = useTickets({ assigneeId: "me", view: "open", overdue: true, limit: 1 });

  const first = user?.firstName ?? user?.email?.split("@")[0] ?? "you";

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-[-0.011em] text-foreground">Assigned to {first}</h1>
        <p className="mt-1 text-table text-muted-foreground">
          Your open tickets, most urgent first. The full list is on{" "}
          <Link href="/ops/tickets" className="text-primary hover:underline">
            Tickets
          </Link>
          .
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label="Open" value={open.data?.meta.total ?? "—"} />
        <StatTile label="Urgent or high" value={urgent.data?.meta.total ?? "—"} />
        <StatTile label="Overdue" value={overdue.data?.meta.total ?? "—"} />
      </div>

      <TicketFilters
        value={filters}
        onChange={(p) => {
          setFilters((f) => ({ ...f, ...p }));
          setPage(1);
        }}
        hide={["assignee"]}
      />

      <div>
        <TicketTable
          tickets={list.data?.data ?? []}
          isPending={list.isPending}
          isError={list.isError}
          error={list.error}
          onRetry={() => list.refetch()}
          busy={list.isFetching && list.isPlaceholderData}
          showAssignee={false}
          empty={{ title: "Nothing assigned to you", description: "Tickets assigned to you will appear here." }}
        />
        {list.data?.meta && list.data.meta.pageCount > 1 ? (
          <MerchantPagination meta={list.data.meta} onPageChange={setPage} />
        ) : null}
      </div>
    </div>
  );
}
