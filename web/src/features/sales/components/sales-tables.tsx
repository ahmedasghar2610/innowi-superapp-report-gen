"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Handshake, CalendarCheck, LifeBuoy, Building2 } from "lucide-react";
import {
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
import { formatDate, formatUsd } from "@/lib/format";
import { formatDay } from "../format";
import { CaseStatusBadge, DealStageBadge, HealthBadge, VisitStatusBadge } from "./sales-badges";
import type { Customer, Deal, SupportCase, Visit } from "../types";

interface TableState {
  isPending?: boolean;
  isError?: boolean;
  error?: unknown;
  onRetry?: () => void;
  /** Dim rows while a new page loads over the old one. */
  busy?: boolean;
  /** Show the owner column (managers looking at everyone). */
  showOwner?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
}

function StateRows({ cols, state, rows, icon }: { cols: number; state: TableState; rows: number; icon: typeof Handshake }) {
  if (state.isPending) {
    return (
      <>
        {Array.from({ length: 5 }).map((_, i) => (
          <TableRow key={i}>
            <TableCell colSpan={cols}>
              <Skeleton className="h-5 w-full" />
            </TableCell>
          </TableRow>
        ))}
      </>
    );
  }
  if (state.isError) {
    return (
      <TableMessageRow colSpan={cols}>
        <ErrorState error={state.error} onRetry={state.onRetry} />
      </TableMessageRow>
    );
  }
  if (rows === 0) {
    return (
      <TableMessageRow colSpan={cols}>
        <EmptyState icon={icon} title={state.emptyTitle ?? "Nothing here"} description={state.emptyDescription} />
      </TableMessageRow>
    );
  }
  return null;
}

/** Stops a row click from firing when the click was on a link inside the row. */
function rowNav(router: ReturnType<typeof useRouter>, href: string) {
  return (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("a,button")) return;
    router.push(href);
  };
}

export function DealsTable({ deals, ...state }: { deals: Deal[] } & TableState) {
  const router = useRouter();
  const cols = state.showOwner ? 7 : 6;
  return (
    <Table className={state.busy ? "opacity-60 transition-opacity" : undefined}>
      <TableHeader>
        <TableRow>
          <TableHead>Deal</TableHead>
          <TableHead>Restaurant</TableHead>
          {state.showOwner && <TableHead>Owner</TableHead>}
          <TableHead>Stage</TableHead>
          <TableHead align="right">Amount</TableHead>
          <TableHead>Close date</TableHead>
          <TableHead>Last change</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <StateRows cols={cols} state={state} rows={deals.length} icon={Handshake} />
        {!state.isPending &&
          !state.isError &&
          deals.map((d) => (
            <TableRow key={d.id} interactive onClick={rowNav(router, `/sales/deals/${d.id}`)}>
              <TableCell className="max-w-[260px] truncate font-medium">
                <Link href={`/sales/deals/${d.id}`} className="hover:underline">
                  {d.name}
                </Link>
              </TableCell>
              <TableCell className="max-w-[220px] truncate">
                {d.accountId ? (
                  <Link href={`/sales/customers/${d.accountId}`} className="hover:underline">
                    {d.accountName ?? "—"}
                  </Link>
                ) : (
                  "—"
                )}
              </TableCell>
              {state.showOwner && <TableCell className="whitespace-nowrap">{d.ownerName ?? "—"}</TableCell>}
              <TableCell>
                <DealStageBadge deal={d} />
              </TableCell>
              <TableCell align="right">{formatUsd(d.amount)}</TableCell>
              <TableCell className="whitespace-nowrap">{formatDay(d.closeDate)}</TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(d.lastModifiedAt)}</TableCell>
            </TableRow>
          ))}
      </TableBody>
    </Table>
  );
}

export function VisitsTable({ visits, ...state }: { visits: Visit[] } & TableState) {
  const cols = state.showOwner ? 6 : 5;
  return (
    <Table className={state.busy ? "opacity-60 transition-opacity" : undefined}>
      <TableHeader>
        <TableRow>
          <TableHead>Due</TableHead>
          <TableHead>Restaurant</TableHead>
          <TableHead>Type</TableHead>
          {state.showOwner && <TableHead>Assigned to</TableHead>}
          <TableHead>Status</TableHead>
          <TableHead>Address</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <StateRows cols={cols} state={state} rows={visits.length} icon={CalendarCheck} />
        {!state.isPending &&
          !state.isError &&
          visits.map((v) => (
            <TableRow key={v.id}>
              <TableCell className="whitespace-nowrap">
                {formatDay(v.dueDateStart)}
                {v.appointmentTime ? <span className="text-muted-foreground"> · {v.appointmentTime}</span> : null}
                {v.completedDate ? (
                  <span className="block text-xs text-muted-foreground">Done {formatDay(v.completedDate)}</span>
                ) : null}
              </TableCell>
              <TableCell className="max-w-[220px] truncate">
                {v.accountId ? (
                  <Link href={`/sales/customers/${v.accountId}`} className="hover:underline">
                    {v.accountName ?? v.name ?? "—"}
                  </Link>
                ) : (
                  v.accountName ?? v.name ?? "—"
                )}
              </TableCell>
              <TableCell className="whitespace-nowrap">{v.visitType ?? "—"}</TableCell>
              {state.showOwner && <TableCell className="whitespace-nowrap">{v.ownerName ?? "—"}</TableCell>}
              <TableCell>
                <VisitStatusBadge visit={v} />
              </TableCell>
              <TableCell className="max-w-[260px] truncate text-muted-foreground" title={v.address ?? undefined}>
                {v.address ?? "—"}
              </TableCell>
            </TableRow>
          ))}
      </TableBody>
    </Table>
  );
}

export function CasesTable({ cases, showIssue, ...state }: { cases: SupportCase[]; showIssue?: boolean } & TableState) {
  return (
    <Table className={state.busy ? "opacity-60 transition-opacity" : undefined}>
      <TableHeader>
        <TableRow>
          <TableHead>Case</TableHead>
          <TableHead>Subject</TableHead>
          <TableHead>Restaurant</TableHead>
          {showIssue && <TableHead>Issue · department</TableHead>}
          <TableHead>Status</TableHead>
          <TableHead>Opened</TableHead>
          <TableHead>Handled by</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <StateRows cols={showIssue ? 7 : 6} state={state} rows={cases.length} icon={LifeBuoy} />
        {!state.isPending &&
          !state.isError &&
          cases.map((c) => (
            <TableRow key={c.id}>
              <TableCell className="whitespace-nowrap tabular">{c.caseNumber ?? "—"}</TableCell>
              <TableCell className="max-w-[320px] truncate" title={c.subject ?? undefined}>
                {c.subject ?? "—"}
              </TableCell>
              <TableCell className="max-w-[220px] truncate">
                {c.accountId ? (
                  <Link href={`/sales/customers/${c.accountId}`} className="hover:underline">
                    {c.accountName ?? "—"}
                  </Link>
                ) : (
                  "—"
                )}
              </TableCell>
              {showIssue && (
                <TableCell className="max-w-[260px]">
                  <div className="truncate text-foreground">{c.issueCategory ?? "No category"}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {c.department ?? "—"}
                    {c.departmentSource === "estimated" ? " · est." : ""}
                  </div>
                </TableCell>
              )}
              <TableCell>
                <CaseStatusBadge c={c} />
              </TableCell>
              <TableCell className="whitespace-nowrap">{formatDate(c.createdAt)}</TableCell>
              <TableCell className="whitespace-nowrap">{c.ownerName ?? "—"}</TableCell>
            </TableRow>
          ))}
      </TableBody>
    </Table>
  );
}

export function CustomersTable({ customers, ...state }: { customers: Customer[] } & TableState) {
  const router = useRouter();
  return (
    <Table className={state.busy ? "opacity-60 transition-opacity" : undefined}>
      <TableHeader>
        <TableRow>
          <TableHead>Restaurant</TableHead>
          <TableHead>City</TableHead>
          <TableHead>Account owner</TableHead>
          <TableHead>Health</TableHead>
          <TableHead align="right">Open deals</TableHead>
          <TableHead align="right">Won deals</TableHead>
          <TableHead align="right">Open cases</TableHead>
          <TableHead>Last check-in</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <StateRows cols={8} state={state} rows={customers.length} icon={Building2} />
        {!state.isPending &&
          !state.isError &&
          customers.map((c) => (
            <TableRow key={c.id} interactive onClick={rowNav(router, `/sales/customers/${c.id}`)}>
              <TableCell className="max-w-[260px] truncate font-medium">
                <Link href={`/sales/customers/${c.id}`} className="hover:underline">
                  {c.name}
                </Link>
              </TableCell>
              <TableCell className="whitespace-nowrap">{[c.city, c.state].filter(Boolean).join(", ") || "—"}</TableCell>
              <TableCell className="whitespace-nowrap">{c.ownerName ?? "—"}</TableCell>
              <TableCell>
                <HealthBadge health={c.health} />
              </TableCell>
              <TableCell align="right">{c.openDeals}</TableCell>
              <TableCell align="right">{c.wonDeals}</TableCell>
              <TableCell align="right">{c.openCases}</TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground">{formatDay(c.lastTouchpointDate)}</TableCell>
            </TableRow>
          ))}
      </TableBody>
    </Table>
  );
}
