"use client";

import { useState } from "react";
import { Card } from "@/components/ui";
import { useMerchantHistory } from "@/features/audit/queries";
import { MerchantPagination } from "@/features/merchants/components/merchant-pagination";
import { AuditLogTable } from "./audit-log-table";
import { AuditLogDrawer } from "./audit-log-drawer";
import type { AuditLog } from "@/features/audit/types";

/**
 * Profiling sub-tab (route: /merchants/[merchantId]/history) — one
 * restaurant's own change history (PRD §22, "Profile tab › History"):
 * GET /merchants/:id/history, every write to the Merchant record and its
 * owned entities (contacts, locations, services, documents, connections,
 * profile fields), newest first.
 */
export function HistoryPanel({ merchantId }: { merchantId: string }) {
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<AuditLog | null>(null);

  const { data, isPending, isError, error, isFetching, isPlaceholderData, refetch } = useMerchantHistory(
    merchantId,
    { page },
  );

  const rows = data?.data ?? [];
  const meta = data?.meta;

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-base font-semibold text-foreground">History</h2>
        <p className="mt-0.5 text-table text-muted-foreground">
          Every change made to this restaurant&apos;s profile, contacts, locations, services, documents and
          connections — newest first.
        </p>
      </div>

      <Card>
        <AuditLogTable
          logs={rows}
          isPending={isPending}
          isError={isError}
          error={error}
          onRetry={() => refetch()}
          onSelect={setSelected}
          showMerchant={false}
          busy={isFetching && isPlaceholderData}
        />
      </Card>

      {meta && rows.length > 0 && <MerchantPagination meta={meta} onPageChange={setPage} />}

      <AuditLogDrawer log={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
