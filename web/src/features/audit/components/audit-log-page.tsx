"use client";

import { useState } from "react";
import { ShieldAlert } from "lucide-react";
import { Card, EmptyState } from "@/components/ui";
import { useAuth } from "@/features/auth/auth-context";
import { hasCapability } from "@/features/auth/capabilities";
import { useAuditLogs } from "@/features/audit/queries";
import { MerchantPagination } from "@/features/merchants/components/merchant-pagination";
import { AuditLogTable } from "./audit-log-table";
import { AuditLogDrawer } from "./audit-log-drawer";
import { AuditLogFilters, toAuditLogQuery, type AuditLogFilterState } from "./audit-log-filters";
import type { AuditLog } from "@/features/audit/types";

const EMPTY_FILTERS: AuditLogFilterState = { entityType: "", action: "", outcome: "", from: "", to: "" };

/**
 * Platform-wide audit log (route: /audit-log). ADMIN/SUPER_ADMIN only —
 * AUDIT_LOG.md §5: "Restricted to ADMIN/SUPER_ADMIN (production-recommended:
 * broad audit visibility is an admin capability, not a general staff one)."
 *
 * This is a client-side convenience gate (skip the fetch, show a clear
 * message) — the real enforcement is the backend's 403 on GET /audit-logs
 * for any other role; a non-admin who somehow reaches this route still can't
 * read anything through it.
 */
export function AuditLogPage() {
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<AuditLogFilterState>(EMPTY_FILTERS);
  const [selected, setSelected] = useState<AuditLog | null>(null);

  const isAdmin = hasCapability(user?.role, "audit.view");

  const { data, isPending, isError, error, isFetching, isPlaceholderData, refetch } = useAuditLogs(
    { page, ...toAuditLogQuery(filters) },
    { enabled: isAdmin },
  );

  if (user === undefined) {
    return null;
  }

  if (!isAdmin) {
    return (
      <Card>
        <EmptyState
          icon={ShieldAlert}
          title="Admins only"
          description="The platform-wide audit log is restricted to Admin and Super Admin. A restaurant's own history is available from its Profiling → History tab."
        />
      </Card>
    );
  }

  const rows = data?.data ?? [];
  const meta = data?.meta;

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-semibold tracking-[-0.011em] text-foreground">Audit Log</h1>
        <p className="mt-1 text-table text-muted-foreground">
          Every mutating write made through the API — merchants, contacts, users, and everything else,
          across the whole platform.
        </p>
      </div>

      <AuditLogFilters
        value={filters}
        onChange={(patch) => {
          setFilters((f) => ({ ...f, ...patch }));
          setPage(1);
        }}
      />

      <Card>
        <AuditLogTable
          logs={rows}
          isPending={isPending}
          isError={isError}
          error={error}
          onRetry={() => refetch()}
          onSelect={setSelected}
          busy={isFetching && isPlaceholderData}
        />
      </Card>

      {meta && rows.length > 0 && <MerchantPagination meta={meta} onPageChange={setPage} />}

      <AuditLogDrawer log={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
