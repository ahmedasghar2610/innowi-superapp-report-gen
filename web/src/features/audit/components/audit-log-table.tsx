"use client";

import { History } from "lucide-react";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableMessageRow,
  EmptyState,
  ErrorState,
  Skeleton,
} from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { AuditActionBadge, AuditOutcomeBadge } from "./audit-badges";
import type { ApiError } from "@/lib/api/client";
import type { AuditLog } from "@/features/audit/types";

interface AuditLogTableProps {
  logs: AuditLog[];
  isPending: boolean;
  isError: boolean;
  error?: ApiError | null;
  onRetry?: () => void;
  onSelect: (log: AuditLog) => void;
  /** Hide the Merchant column when already scoped to one merchant. */
  showMerchant?: boolean;
  busy?: boolean;
}

/**
 * Shared audit-log table for both the platform-wide log (GET /audit-logs)
 * and a merchant's own history tab (GET /merchants/:id/history) — same row
 * shape either way (AUDIT_LOG.md §2), so one component covers both.
 */
export function AuditLogTable({
  logs,
  isPending,
  isError,
  error,
  onRetry,
  onSelect,
  showMerchant = true,
  busy,
}: AuditLogTableProps) {
  const colSpan = showMerchant ? 6 : 5;

  if (isError) {
    return (
      <Table>
        <TableBody>
          <TableMessageRow colSpan={colSpan}>
            <ErrorState title="Couldn't load history" error={error} onRetry={onRetry} />
          </TableMessageRow>
        </TableBody>
      </Table>
    );
  }

  return (
    <div className={busy ? "opacity-60 transition-opacity" : "transition-opacity"} aria-busy={busy}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>When</TableHead>
            <TableHead>Actor</TableHead>
            <TableHead>Action</TableHead>
            <TableHead>Entity</TableHead>
            {showMerchant ? <TableHead>Merchant</TableHead> : null}
            <TableHead>Outcome</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isPending ? (
            Array.from({ length: 6 }).map((_, i) => (
              <TableRow key={i}>
                {Array.from({ length: colSpan }).map((__, j) => (
                  <TableCell key={j}>
                    <Skeleton className="h-3.5 w-24" />
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : logs.length === 0 ? (
            <TableMessageRow colSpan={colSpan}>
              <EmptyState icon={History} title="No history yet" description="Changes made through the API will appear here." />
            </TableMessageRow>
          ) : (
            logs.map((log) => (
              <TableRow key={log.id} interactive onClick={() => onSelect(log)}>
                <TableCell className="whitespace-nowrap text-foreground">{formatDateTime(log.createdAt)}</TableCell>
                <TableCell>
                  <div className="font-medium text-foreground">{log.actorEmail ?? "System"}</div>
                  {log.actorRole ? <div className="text-xs text-muted-foreground">{log.actorRole}</div> : null}
                </TableCell>
                <TableCell>
                  <AuditActionBadge action={log.action} />
                </TableCell>
                <TableCell>
                  <div className="font-medium text-foreground">{log.entityType}</div>
                  {log.entityId ? (
                    <div className="truncate text-xs text-muted-foreground" title={log.entityId}>
                      {log.entityId}
                    </div>
                  ) : null}
                </TableCell>
                {showMerchant ? (
                  <TableCell className="text-xs text-muted-foreground">{log.merchantId ?? "—"}</TableCell>
                ) : null}
                <TableCell>
                  <AuditOutcomeBadge outcome={log.outcome} />
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
