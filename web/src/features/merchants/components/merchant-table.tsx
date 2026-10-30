"use client";

import { MERCHANT_STATUS_LABEL, MERCHANT_STATUS_TONE } from "@/features/churn/labels";

import { useRouter } from "next/navigation";
import {
  Badge,
  BadgeLink,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  type SortDirection,
} from "@/components/ui";
import { formatDate, displayUrl } from "@/lib/format";
import { accountHealth as healthLabels } from "@/lib/enums";
import { PackageBadge } from "./package-badge";
import { sourceLabel, sourceText } from "@/features/sources/labels";
import type { Merchant, MerchantSortBy, SortOrder } from "@/features/merchants/types";

interface MerchantTableProps {
  merchants: Merchant[];
  sortBy: MerchantSortBy;
  order: SortOrder;
  onSort: (column: MerchantSortBy) => void;
  /** Dim the table while a background refetch is in flight. */
  busy?: boolean;
}

function MerchantHealthBadge({ value }: { value: Merchant["accountHealth"] }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  const meta = healthLabels[value];
  return (
    <Badge tone={meta?.tone ?? "neutral"}>
      {meta?.label ?? value}
    </Badge>
  );
}

/**
 * The cached PROF-02 percent (`profileCompletionPct`, a write-behind of the
 * completeness service) as a compact bar. Null = never scored — rendered as
 * "—", never as 0%, per GLB-01.
 */
function CompletenessCell({ value }: { value: number | null }) {
  if (value === null) return <span className="text-muted-foreground">—</span>;
  const tone = value >= 80 ? "bg-success" : value >= 50 ? "bg-warning" : "bg-destructive";
  return (
    <div className="flex items-center gap-2" title={`${value}% complete`}>
      <div className="h-1 w-16 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${value}%` }} />
      </div>
      <span className="tabular-nums text-table font-medium text-foreground">{value}%</span>
    </div>
  );
}

export function MerchantTable({ merchants, sortBy, order, onSort, busy }: MerchantTableProps) {
  const router = useRouter();
  const dir = (col: MerchantSortBy): SortDirection => (sortBy === col ? order : false);

  return (
    <div className={busy ? "opacity-60 transition-opacity" : "transition-opacity"} aria-busy={busy}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead sortable sortDirection={dir("restaurantName")} onSort={() => onSort("restaurantName")}>
              Merchant
            </TableHead>
            <TableHead sortable sortDirection={dir("profileCompletionPct")} onSort={() => onSort("profileCompletionPct")}>
              Completeness
            </TableHead>
            <TableHead>Health</TableHead>
            <TableHead>Package</TableHead>
            <TableHead>Owner</TableHead>
            <TableHead>Website</TableHead>
            <TableHead>Onboarded</TableHead>
            <TableHead sortable sortDirection={dir("createdAt")} onSort={() => onSort("createdAt")}>
              Added
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {merchants.map((m) => (
            <TableRow key={m.id} interactive onClick={() => router.push(`/merchants/${m.id}/overview`, { scroll: false })}>
              <TableCell>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-foreground">{m.restaurantName}</span>
                  {m.status && m.status !== "ACTIVE" && (
                    <Badge tone={MERCHANT_STATUS_TONE[m.status]} icon={false}>
                      {MERCHANT_STATUS_LABEL[m.status]}
                    </Badge>
                  )}
                  {m.merchantCode && (
                    <span className="font-mono text-xs text-muted-foreground" title="Workbook Merchant ID">
                      {m.merchantCode}
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  {m.cuisineCategory ?? "—"}
                  <span aria-hidden> · </span>
                  <span title={`Added via: ${sourceText(m.source, m.sourceDetail)}`}>{sourceLabel(m.source)}</span>
                </div>
              </TableCell>
              <TableCell>
                <CompletenessCell value={m.profileCompletionPct} />
              </TableCell>
              <TableCell>
                <MerchantHealthBadge value={m.accountHealth} />
              </TableCell>
              <TableCell>
                <PackageBadge subscription={m.subscription} />
              </TableCell>
              <TableCell className="text-foreground">
                {m.accountManager ? m.accountManager.name : <span className="text-muted-foreground">Unassigned</span>}
              </TableCell>
              <TableCell>
                {m.websiteUrl ? (
                  <BadgeLink
                    href={m.websiteUrl}
                    title={displayUrl(m.websiteUrl)}
                    aria-label={`Open ${displayUrl(m.websiteUrl)}`}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell className="text-foreground">{formatDate(m.onboardingDate)}</TableCell>
              <TableCell className="text-foreground">{formatDate(m.createdAt)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
