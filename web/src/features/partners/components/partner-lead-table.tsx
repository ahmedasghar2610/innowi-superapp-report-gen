"use client";

import { Handshake, PhoneCall } from "lucide-react";
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
import Link from "next/link";
import { useOrganizationLinks } from "@/features/deals/queries";
import { STATUS_LABEL, STATUS_TONE, memberName } from "../labels";
import type { PartnerLead, PartnerLeadSort, PartnerTeamMember } from "../types";

const COLS = 6;

export function PartnerLeadTable({
  leads,
  team,
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
  leads: PartnerLead[];
  team: PartnerTeamMember[] | undefined;
  isPending: boolean;
  isError: boolean;
  error?: ApiError | null;
  onRetry?: () => void;
  onSelect: (lead: PartnerLead) => void;
  busy?: boolean;
  filtered?: boolean;
  sort?: { by: PartnerLeadSort; order: "asc" | "desc" };
  onSort?: (by: PartnerLeadSort) => void;
}) {
  // Which leads already have their organization (Partners → Organizations).
  const links = useOrganizationLinks(leads.map((l) => l.id), []);
  const dir = (by: PartnerLeadSort) => (sort?.by === by ? sort.order : false);
  const head = (by: PartnerLeadSort, label: string) =>
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
            <ErrorState title="Couldn't load partner leads" error={error} onRetry={onRetry} />
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
            {head("createdAt", "Applied")}
            {head("name", "Partner")}
            <TableHead>Type · Territory</TableHead>
            <TableHead>Organization</TableHead>
            {head("owner", "Owner")}
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
          ) : leads.length === 0 ? (
            <TableMessageRow colSpan={COLS}>
              <EmptyState
                icon={Handshake}
                title={filtered ? "No leads match these filters" : "No partner leads yet"}
                description={
                  filtered
                    ? "Try clearing a filter."
                    : "Applications from partners.innowi.com will appear here as soon as they're submitted."
                }
              />
            </TableMessageRow>
          ) : (
            leads.map((lead) => (
              <TableRow key={lead.id} interactive onClick={() => onSelect(lead)}>
                <TableCell className="whitespace-nowrap text-foreground">{formatDate(lead.createdAt)}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5 font-medium text-foreground">
                    {lead.fullName}
                    {lead.wantsCall ? (
                      <PhoneCall className="size-3.5 text-primary" aria-label="Asked for a discovery call" />
                    ) : null}
                  </div>
                  <div className="text-xs text-muted-foreground">{lead.company || lead.email}</div>
                </TableCell>
                <TableCell>
                  <div className="text-foreground">{lead.partnerType || "—"}</div>
                  <div className="max-w-[220px] truncate text-xs text-muted-foreground" title={lead.region ?? undefined}>
                    {lead.region || "—"}
                  </div>
                </TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  {links.data?.leads[lead.id] ? (
                    <Link href={`/organizations/${links.data.leads[lead.id].id}`} className="font-medium text-foreground underline underline-offset-4">
                      {links.data.leads[lead.id].name}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className={lead.assignedTo ? "text-foreground" : "text-muted-foreground"}>
                  {memberName(lead.assignedTo, team)}
                </TableCell>
                <TableCell>
                  <Badge tone={STATUS_TONE[lead.status]} icon={false}>
                    {STATUS_LABEL[lead.status] ?? lead.status}
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
