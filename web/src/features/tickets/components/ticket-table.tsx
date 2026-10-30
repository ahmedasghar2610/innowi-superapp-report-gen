"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckSquare, MessageSquare, Ticket as TicketIcon } from "lucide-react";
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
import type { ApiError } from "@/lib/api/client";
import type { Ticket } from "../types";
import { DueDate, PersonChip, PriorityBadge, SlaLabel, StatusLabel, TypeLabel } from "./ticket-bits";

interface TicketTableProps {
  tickets: Ticket[];
  isPending: boolean;
  isError: boolean;
  error?: ApiError | null;
  onRetry?: () => void;
  busy?: boolean;
  /** Hide the Merchant column (merchant tab: it's always the same merchant). */
  showMerchant?: boolean;
  /** Hide the Assignee column ("Assigned to me": it's always you). */
  showAssignee?: boolean;
  empty?: { title: string; description?: string; action?: React.ReactNode };
}

/** Tickets as table rows. Clicking a row opens the ticket. */
export function TicketTable({
  tickets,
  isPending,
  isError,
  error,
  onRetry,
  busy,
  showMerchant = true,
  showAssignee = true,
  empty,
}: TicketTableProps) {
  const router = useRouter();
  const colSpan = 7 + (showMerchant ? 1 : 0) + (showAssignee ? 1 : 0);

  if (isError) {
    return (
      <Table>
        <TableBody>
          <TableMessageRow colSpan={colSpan}>
            <ErrorState title="Couldn't load tickets" error={error} onRetry={onRetry} />
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
            <TableHead>ID</TableHead>
            <TableHead>Title</TableHead>
            {showMerchant ? <TableHead>Merchant</TableHead> : null}
            <TableHead>Priority</TableHead>
            <TableHead>Type · category</TableHead>
            <TableHead>Status</TableHead>
            {showAssignee ? <TableHead>Assignee</TableHead> : null}
            <TableHead>Due</TableHead>
            <TableHead>SLA</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isPending ? (
            Array.from({ length: 6 }).map((_, i) => (
              <TableRow key={i}>
                {Array.from({ length: colSpan }).map((__, j) => (
                  <TableCell key={j}>
                    <Skeleton className="h-3.5 w-20" />
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : tickets.length === 0 ? (
            <TableMessageRow colSpan={colSpan}>
              <EmptyState
                icon={TicketIcon}
                title={empty?.title ?? "No tickets"}
                description={empty?.description}
                action={empty?.action}
              />
            </TableMessageRow>
          ) : (
            tickets.map((t) => (
              <TableRow key={t.id} interactive onClick={() => router.push(`/ops/tickets/${t.key}`)}>
                <TableCell className="whitespace-nowrap text-xs font-medium text-muted-foreground tabular">{t.key}</TableCell>
                <TableCell className="max-w-[16rem]">
                  <Link
                    href={`/ops/tickets/${t.key}`}
                    onClick={(e) => e.stopPropagation()}
                    className="block truncate font-medium text-foreground hover:underline"
                    title={t.title}
                  >
                    {t.title}
                  </Link>
                  <span className="mt-0.5 flex gap-3 text-xs text-muted-foreground">
                    <span className="truncate">{t.project.name}</span>
                    {t.subtaskCount > 0 ? (
                      <span className="inline-flex shrink-0 items-center gap-1">
                        <CheckSquare className="size-3" aria-hidden />
                        {t.subtasksDone}/{t.subtaskCount}
                        <span className="sr-only">sub-tasks done</span>
                      </span>
                    ) : null}
                    {t.commentCount > 0 ? (
                      <span className="inline-flex shrink-0 items-center gap-1">
                        <MessageSquare className="size-3" aria-hidden />
                        {t.commentCount}
                        <span className="sr-only">comments</span>
                      </span>
                    ) : null}
                  </span>
                </TableCell>
                {showMerchant ? (
                  <TableCell className="max-w-[9rem] truncate">
                    {t.merchant ? (
                      <Link
                        href={`/merchants/${t.merchant.id}/tickets`}
                        onClick={(e) => e.stopPropagation()}
                        className="text-foreground hover:underline"
                      >
                        {t.merchant.name}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">Internal</span>
                    )}
                  </TableCell>
                ) : null}
                <TableCell>
                  <PriorityBadge priority={t.priority} />
                </TableCell>
                <TableCell className="max-w-[10rem]">
                  <TypeLabel type={t.type} category={t.category} stacked />
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  <StatusLabel status={t.status} />
                </TableCell>
                {showAssignee ? (
                  <TableCell className="max-w-[11rem]">
                    <PersonChip person={t.assignee} />
                  </TableCell>
                ) : null}
                <TableCell>
                  <DueDate dueDate={t.dueDate} overdue={t.isOverdue} />
                </TableCell>
                <TableCell>
                  <SlaLabel sla={t.sla} />
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
