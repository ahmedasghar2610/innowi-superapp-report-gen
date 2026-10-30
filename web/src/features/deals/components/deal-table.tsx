"use client";

import { KanbanSquare } from "lucide-react";
import {
  Badge,
  EmptyState,
  ErrorState,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableMessageRow,
  TableRow,
} from "@/components/ui";
import type { ApiError } from "@/lib/api/client";
import { MERCHANT_STATUS_LABEL, MERCHANT_STATUS_TONE, STAGE_LABEL, STAGE_TONE, formatDay, money } from "../labels";
import type { DealQuery, DealRow } from "../types";

const COLS = 7;
type SortKey = NonNullable<DealQuery["sortBy"]>;

export function DealTable({
  rows,
  isPending,
  isError,
  error,
  onRetry,
  onSelect,
  busy,
  filtered,
  sortBy,
  order,
  onSort,
}: {
  rows: DealRow[];
  isPending: boolean;
  isError: boolean;
  error?: ApiError | null;
  onRetry?: () => void;
  onSelect: (row: DealRow) => void;
  busy?: boolean;
  filtered?: boolean;
  sortBy: SortKey;
  order: "asc" | "desc";
  onSort: (key: SortKey) => void;
}) {
  if (isError) {
    return (
      <Table>
        <TableBody>
          <TableMessageRow colSpan={COLS}>
            <ErrorState title="Couldn't load deals" error={error} onRetry={onRetry} />
          </TableMessageRow>
        </TableBody>
      </Table>
    );
  }
  const dir = (key: SortKey) => (sortBy === key ? order : false);

  return (
    <div className={busy ? "opacity-60 transition-opacity" : "transition-opacity"} aria-busy={busy}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead sortable sortDirection={dir("number")} onSort={() => onSort("number")}>
              Deal
            </TableHead>
            <TableHead sortable sortDirection={dir("restaurantName")} onSort={() => onSort("restaurantName")}>
              Restaurant
            </TableHead>
            <TableHead sortable sortDirection={dir("stageChangedAt")} onSort={() => onSort("stageChangedAt")}>
              Stage
            </TableHead>
            <TableHead>Owner</TableHead>
            <TableHead>Organization</TableHead>
            <TableHead align="right" sortable sortDirection={dir("amountMonthly")} onSort={() => onSort("amountMonthly")}>
              Monthly
            </TableHead>
            <TableHead sortable sortDirection={dir("updatedAt")} onSort={() => onSort("updatedAt")}>
              Updated
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isPending ? (
            Array.from({ length: 8 }).map((_, i) => (
              <TableRow key={i}>
                {Array.from({ length: COLS }).map((__, j) => (
                  <TableCell key={j}>
                    <Skeleton className="h-3.5 w-24" />
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : rows.length === 0 ? (
            <TableMessageRow colSpan={COLS}>
              <EmptyState
                icon={KanbanSquare}
                title={filtered ? "No deals match" : "No deals yet"}
                description={filtered ? "Try clearing a filter." : "Start one with “New deal”."}
              />
            </TableMessageRow>
          ) : (
            rows.map((r) => (
              <TableRow key={r.id} interactive onClick={() => onSelect(r)} data-testid="deal-row">
                <TableCell className="whitespace-nowrap tabular">{r.key}</TableCell>
                <TableCell>
                  <div className="font-medium text-foreground">{r.restaurantName}</div>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Badge tone={MERCHANT_STATUS_TONE[r.merchantStatus]} icon={false}>
                      {MERCHANT_STATUS_LABEL[r.merchantStatus]}
                    </Badge>
                    {r.region ?? ""}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge tone={STAGE_TONE[r.stage]} icon={false}>
                    {STAGE_LABEL[r.stage]}
                  </Badge>
                  <div className="mt-0.5 text-xs text-muted-foreground tabular">since {formatDay(r.stageChangedAt)}</div>
                </TableCell>
                <TableCell>{r.owner?.name ?? <span className="text-xs text-muted-foreground">Unassigned</span>}</TableCell>
                <TableCell>{r.organization?.name ?? "—"}</TableCell>
                <TableCell align="right" className="whitespace-nowrap tabular">
                  {money(r.amountMonthly)}
                </TableCell>
                <TableCell className="whitespace-nowrap tabular">{formatDay(r.updatedAt)}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
