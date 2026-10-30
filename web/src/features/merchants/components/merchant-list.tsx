"use client";

import { useRefetchOnFocus } from "@/hooks/use-refetch-on-focus";
import { queryKeys } from "@/lib/query/query-keys";
import Link from "next/link";
import { useState } from "react";
import { FileSpreadsheet, Link2, Plus, Users, Utensils } from "lucide-react";
import { Button, Card, EmptyState, ErrorState, SectionHead, Skeleton, Table, TableHeader, TableBody, TableRow, TableHead, TableCell, useToast } from "@/components/ui";
import { describeConnect, useConnectMerchants, useMerchants } from "@/features/merchants/api";
import { useMerchantQueryParams } from "@/features/merchants/hooks/use-merchant-query-params";
import { useCan } from "@/features/auth/use-can";
import type { MerchantSortBy } from "@/features/merchants/types";
import { MerchantFilters } from "./merchant-filters";
import { MerchantPortfolioStats } from "./merchant-portfolio-stats";
import { MerchantTable } from "./merchant-table";
import { MerchantPagination } from "./merchant-pagination";
import { MerchantImportDialog } from "./import/merchant-import-dialog";
import { MenuBulkDialog } from "./import/menu-bulk-panel";

/**
 * Merchants directory (route: /merchants). URL-driven search / filter / sort /
 * pagination, live against `GET /merchants` (PORT-01/02). Renders loading,
 * error and empty states.
 */
export function MerchantList() {
  const { params, setParams, apiQuery, hasActiveFilters } = useMerchantQueryParams();
  // A website linked or edited in another tab changes merchants' website URL / hours.
  useRefetchOnFocus([queryKeys.merchants.lists()]);
  const can = useCan();
  const canCreate = can("merchant.create");
  const [importOpen, setImportOpen] = useState(false);
  const [menusOpen, setMenusOpen] = useState(false);
  const { toast } = useToast();
  const connect = useConnectMerchants();
  const connectAll = () =>
    connect.mutate(undefined, {
      onSuccess: (r) =>
        toast({
          variant: r.skipped ? "warning" : "success",
          title: r.skipped ? "Automatic linking is off" : "Merchants connected",
          description: r.skipped
            ? "Turn it on in Settings → Data setup → Connector."
            : `${describeConnect(r.summary)}. Close matches wait for a decision in Settings → Data setup or on each merchant's tabs.`,
        }),
      onError: (e) => toast({ variant: "error", title: "Couldn't connect", description: e.messages?.[0] ?? e.message }),
    });
  const { data, isPending, isError, error, isFetching, isPlaceholderData, refetch } = useMerchants(apiQuery);

  const rows = data?.data ?? [];
  const meta = data?.meta;

  const handleSort = (column: MerchantSortBy) => {
    if (params.sortBy === column) {
      setParams({ order: params.order === "asc" ? "desc" : "asc" });
    } else {
      // Names read A→Z; completeness is most useful worst-first; dates newest-first.
      setParams({
        sortBy: column,
        order: column === "restaurantName" || column === "profileCompletionPct" ? "asc" : "desc",
      });
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-[-0.011em] text-foreground">Merchants</h1>
          <p className="mt-1 text-xs leading-4 text-muted-foreground">
            Your portfolio — search, filter and open a merchant to manage its profile.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {can("profile.edit") && (
            <Button variant="outline" size="sm" onClick={connectAll} loading={connect.isPending}
              title="Link every merchant's SEO site and Google Ads account where they clearly match (same domain or name)">
              {!connect.isPending && <Link2 className="size-4" />}
              Connect all
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => setMenusOpen(true)}>
            <Utensils className="size-4" />
            Menus
          </Button>
          {canCreate && (
            <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
              <FileSpreadsheet className="size-4" />
              Import from XLS
            </Button>
          )}
          {canCreate && (
            <Link href="/merchants/new">
              <Button variant="default" size="sm">
                <Plus className="size-4" />
                New Merchant
              </Button>
            </Link>
          )}
        </div>
        {canCreate && <MerchantImportDialog open={importOpen} onClose={() => setImportOpen(false)} />}
        <MenuBulkDialog open={menusOpen} onClose={() => setMenusOpen(false)} />
      </div>

      <MerchantPortfolioStats />

      <section className="flex flex-col gap-3" aria-label="Directory">
      <SectionHead title="Directory" description="Open a merchant to manage its profile." />
      <MerchantFilters
        search={params.q}
        health={params.health}
        accountManagerId={params.am}
        status={params.status}
        account={params.acct}
        source={params.src}
        hasActiveFilters={hasActiveFilters}
        onSearchChange={(q) => setParams({ q })}
        onHealthChange={(health) => setParams({ health })}
        onAccountManagerChange={(am) => setParams({ am })}
        onStatusChange={(status) => setParams({ status })}
        onAccountChange={(acct) => setParams({ acct })}
        onSourceChange={(src) => setParams({ src })}
        onClear={() => setParams({ q: "", health: "", am: "", status: "", acct: "", src: "" })}
      />

      <div>
      {isError ? (
        <Card>
          <ErrorState
            title="Couldn't load merchants"
            error={error}
            onRetry={() => refetch()}
          />
        </Card>
      ) : isPending ? (
        <MerchantTableSkeleton />
      ) : rows.length === 0 ? (
        <Card>
          {hasActiveFilters ? (
            <EmptyState
              icon={Users}
              title="No merchants match your filters"
              description="Try a different search term or clear the filters."
              action={
                <Button variant="outline" size="sm" onClick={() => setParams({ q: "", health: "", am: "", status: "", acct: "" })}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={Users}
              title="No merchants yet"
              description={
                canCreate
                  ? "Add your first merchant to start building its profile."
                  : "A Marketing Manager or Admin can onboard the first merchant."
              }
              action={
                canCreate ? (
                  <Link href="/merchants/new">
                    <Button variant="default" size="sm">
                      <Plus className="size-4" />
                      New Merchant
                    </Button>
                  </Link>
                ) : undefined
              }
            />
          )}
        </Card>
      ) : (
        <>
          <MerchantTable
            merchants={rows}
            sortBy={params.sortBy}
            order={params.order}
            onSort={handleSort}
            busy={isFetching && isPlaceholderData}
          />
          {meta && (
            <MerchantPagination
              meta={meta}
              onPageChange={(page) => setParams({ page })}
              onPageSizeChange={(limit) => setParams({ limit })}
            />
          )}
        </>
      )}
      </div>
      </section>
    </div>
  );
}

/** Skeleton matching the table layout during the initial load. */
function MerchantTableSkeleton() {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Merchant</TableHead>
          <TableHead>Completeness</TableHead>
          <TableHead>Health</TableHead>
          <TableHead>Package</TableHead>
          <TableHead>Owner</TableHead>
          <TableHead>Website</TableHead>
          <TableHead>Onboarded</TableHead>
          <TableHead>Added</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {Array.from({ length: 6 }).map((_, i) => (
          <TableRow key={i}>
            <TableCell>
              <Skeleton className="h-3.5 w-40" />
              <Skeleton className="mt-1.5 h-3 w-24" />
            </TableCell>
            <TableCell>
              <Skeleton className="h-3.5 w-24" />
            </TableCell>
            <TableCell>
              <Skeleton className="h-5 w-16 rounded-full" />
            </TableCell>
            <TableCell>
              <Skeleton className="h-5 w-14 rounded-full" />
            </TableCell>
            <TableCell>
              <Skeleton className="h-3.5 w-16" />
            </TableCell>
            <TableCell>
              <Skeleton className="h-3.5 w-32" />
            </TableCell>
            <TableCell>
              <Skeleton className="h-3.5 w-20" />
            </TableCell>
            <TableCell>
              <Skeleton className="h-3.5 w-20" />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
