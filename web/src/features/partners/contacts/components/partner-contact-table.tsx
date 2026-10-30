"use client";

import { BookUser, Handshake } from "lucide-react";
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
import { formatDate } from "@/lib/format";
import type { ApiError } from "@/lib/api/client";
import { CONTACT_STATUS_LABEL, CONTACT_STATUS_TONE, contactSourceLabel } from "../labels";
import Link from "next/link";
import { useOrganizationLinks } from "@/features/deals/queries";
import type { PartnerContact, PartnerContactSort } from "../types";

const COLS = 6;

export function PartnerContactTable({
  contacts,
  isPending,
  isError,
  error,
  onRetry,
  onSelect,
  busy,
  filtered,
  sort,
  onSort,
}: {
  contacts: PartnerContact[];
  isPending: boolean;
  isError: boolean;
  error?: ApiError | null;
  onRetry?: () => void;
  onSelect: (contact: PartnerContact) => void;
  busy?: boolean;
  filtered?: boolean;
  sort?: { by: PartnerContactSort; order: "asc" | "desc" };
  onSort?: (by: PartnerContactSort) => void;
}) {
  const links = useOrganizationLinks([], contacts.map((c) => c.id));
  const dir = (by: PartnerContactSort) => (sort?.by === by ? sort.order : false);
  const head = (by: PartnerContactSort, label: string) =>
    onSort ? (
      <TableHead sortable sortDirection={dir(by)} onSort={() => onSort(by)}>
        {label}
      </TableHead>
    ) : (
      <TableHead>{label}</TableHead>
    );
  if (isError) {
    return (
      <Table>
        <TableBody>
          <TableMessageRow colSpan={COLS}>
            <ErrorState title="Couldn't load the network" error={error} onRetry={onRetry} />
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
            {head("createdAt", "Added")}
            {head("name", "Contact")}
            {head("company", "Company · Type")}
            {head("metOn", "Met at")}
            <TableHead>Organization</TableHead>
            {head("status", "Status")}
          </TableRow>
        </TableHeader>
        <TableBody>
          {isPending ? (
            Array.from({ length: 6 }).map((_, i) => (
              <TableRow key={i}>
                {Array.from({ length: COLS }).map((__, j) => (
                  <TableCell key={j}>
                    <Skeleton className="h-3.5 w-24" />
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : contacts.length === 0 ? (
            <TableMessageRow colSpan={COLS}>
              <EmptyState
                icon={BookUser}
                title={filtered ? "No contacts match these filters" : "No contacts yet"}
                description={
                  filtered
                    ? "Try clearing a filter."
                    : "Business cards scanned with the card agent, imports and contacts added by hand will appear here."
                }
              />
            </TableMessageRow>
          ) : (
            contacts.map((c) => (
              <TableRow key={c.id} interactive onClick={() => onSelect(c)}>
                <TableCell className="whitespace-nowrap text-foreground">{formatDate(c.createdAt)}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5 font-medium text-foreground">
                    {c.fullName}
                    {c.promotedLeadId ? (
                      <Handshake className="size-3.5 text-primary" aria-label="Promoted to a partner lead" />
                    ) : null}
                  </div>
                  <div className="text-xs text-muted-foreground">{c.title || c.email || c.phone || "—"}</div>
                </TableCell>
                <TableCell>
                  <div className="text-foreground">{c.company || "—"}</div>
                  <div className="max-w-[220px] truncate text-xs text-muted-foreground" title={c.partnerType ?? undefined}>
                    {c.partnerType || "—"}
                  </div>
                </TableCell>
                <TableCell className="text-foreground">{c.metAt || "—"}</TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  {links.data?.cards[c.id] ? (
                    <Link href={`/organizations/${links.data.cards[c.id].id}`} className="font-medium text-foreground underline underline-offset-4">
                      {links.data.cards[c.id].name}
                    </Link>
                  ) : (
                    <span className="text-xs text-muted-foreground">{contactSourceLabel(c.source)}</span>
                  )}
                </TableCell>
                <TableCell>
                  <Badge tone={CONTACT_STATUS_TONE[c.status]} icon={false}>
                    {CONTACT_STATUS_LABEL[c.status] ?? c.status}
                  </Badge>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
