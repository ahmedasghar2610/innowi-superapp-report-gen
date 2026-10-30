"use client";

import { UserMinus } from "lucide-react";
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
import { WINBACK_LABEL, WINBACK_TONE, formatDay, money } from "../labels";
import type { ChurnQuery, ChurnRow } from "../types";

const COLS = 8;
type SortKey = NonNullable<ChurnQuery["sortBy"]>;

export function ChurnTable({
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
  rows: ChurnRow[];
  isPending: boolean;
  isError: boolean;
  error?: ApiError | null;
  onRetry?: () => void;
  onSelect: (row: ChurnRow) => void;
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
            <ErrorState title="Couldn't load churned accounts" error={error} onRetry={onRetry} />
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
            <TableHead sortable sortDirection={dir("restaurantName")} onSort={() => onSort("restaurantName")}>
              Account
            </TableHead>
            <TableHead>Region · Solution</TableHead>
            <TableHead sortable sortDirection={dir("churnedOn")} onSort={() => onSort("churnedOn")}>
              Churned
            </TableHead>
            <TableHead>Why</TableHead>
            <TableHead align="right" sortable sortDirection={dir("mrrAtChurn")} onSort={() => onSort("mrrAtChurn")}>
              MRR
            </TableHead>
            <TableHead>Owner (restaurant)</TableHead>
            <TableHead>Win-back</TableHead>
            <TableHead sortable sortDirection={dir("nextFollowUpOn")} onSort={() => onSort("nextFollowUpOn")}>
              Follow-up
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
                icon={UserMinus}
                title={filtered ? "No churned accounts match" : "No churned accounts yet"}
                description={
                  filtered
                    ? "Try clearing a filter."
                    : "Import the CSM churn workbook, or mark a merchant as churned from its page."
                }
              />
            </TableMessageRow>
          ) : (
            rows.map((r) => (
              <TableRow key={r.churnId} interactive onClick={() => onSelect(r)} data-testid="churn-row">
                <TableCell>
                  <div className="font-medium text-foreground">{r.restaurantName}</div>
                  {r.location?.city ? (
                    <div className="text-xs text-muted-foreground">
                      {r.location.city}
                      {r.location.state ? `, ${r.location.state}` : ""}
                    </div>
                  ) : null}
                </TableCell>
                <TableCell>
                  <div className="text-foreground">{r.region ?? "—"}</div>
                  <div className="text-xs text-muted-foreground">{r.innowiSolution ?? ""}</div>
                </TableCell>
                <TableCell className="whitespace-nowrap tabular">{r.churnedOn ? formatDay(r.churnedOn) : "—"}</TableCell>
                <TableCell>
                  {r.categories.length ? (
                    <div className="flex flex-wrap gap-1">
                      {r.categories.slice(0, 3).map((c) => (
                        <Badge key={c} tone="neutral" icon={false}>
                          {c}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">{r.reason ?? "—"}</span>
                  )}
                </TableCell>
                <TableCell align="right" className="whitespace-nowrap tabular">
                  {money(r.mrrAtChurn)}
                </TableCell>
                <TableCell>
                  <div className="text-foreground">{r.contact?.name ?? "—"}</div>
                  <div className="text-xs text-muted-foreground">{r.contact?.phone ?? r.contact?.email ?? ""}</div>
                </TableCell>
                <TableCell>
                  <Badge tone={WINBACK_TONE[r.winbackStatus]} icon={false}>
                    {WINBACK_LABEL[r.winbackStatus]}
                  </Badge>
                  {r.winbackOwner ? <div className="mt-0.5 text-xs text-muted-foreground">{r.winbackOwner.name}</div> : null}
                </TableCell>
                <TableCell className="whitespace-nowrap tabular">{r.nextFollowUpOn ? formatDay(r.nextFollowUpOn) : "—"}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
