"use client";

import { Award, Building2, GraduationCap } from "lucide-react";
import {
  Badge,
  EmptyState,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableMessageRow,
  TableRow,
} from "@/components/ui";
import { sourceLabel, sourceText } from "@/features/sources/labels";
import { ORG_KIND_LABEL, ORG_KIND_TONE, cameFromLabel, formatDay } from "../labels";
import type { Organization, OrgSortBy } from "../types";
import { SellingBadge, StageBadge } from "./partner-ui";

export interface OrgSort {
  by: OrgSortBy;
  order: "asc" | "desc";
}

/** Click a header: sort by it (A–Z / oldest first), click again to flip. */
export function nextSort(current: OrgSort, by: OrgSortBy): OrgSort {
  if (current.by === by) return { by, order: current.order === "asc" ? "desc" : "asc" };
  // Dates and counts read best newest / biggest first.
  return { by, order: by === "createdAt" || by === "updatedAt" || by === "deals" || by === "agents" ? "desc" : "asc" };
}

/**
 * The organizations list, and an ISO's agents. Every column header sorts (with
 * up/down arrows); with `selected` the rows get checkboxes for bulk assignment.
 */
export function OrgTable({
  rows,
  loading,
  variant = "partners",
  sort,
  onSort,
  selected,
  onSelect,
  onOpen,
  empty,
}: {
  rows: Organization[];
  loading?: boolean;
  variant?: "partners" | "agents";
  sort: OrgSort;
  onSort: (s: OrgSort) => void;
  selected?: Set<string>;
  onSelect?: (next: Set<string>) => void;
  onOpen: (o: Organization) => void;
  empty: { title: string; description: string };
}) {
  const dir = (by: OrgSortBy) => (sort.by === by ? sort.order : false);
  const head = (by: OrgSortBy, label: string, align?: "right") => (
    <TableHead sortable sortDirection={dir(by)} onSort={() => onSort(nextSort(sort, by))} align={align}>
      {label}
    </TableHead>
  );
  const selectable = !!selected && !!onSelect;
  const allOn = selectable && rows.length > 0 && rows.every((r) => selected!.has(r.id));
  const cols = (variant === "agents" ? 7 : 7) + (selectable ? 1 : 0);

  return (
    <Table>
      <TableHeader>
        <TableRow>
          {selectable ? (
            <TableHead className="w-8">
              <input
                type="checkbox"
                className="size-4"
                aria-label="Select all on this page"
                checked={allOn}
                onChange={(e) => {
                  const next = new Set(selected);
                  rows.forEach((r) => (e.target.checked ? next.add(r.id) : next.delete(r.id)));
                  onSelect!(next);
                }}
              />
            </TableHead>
          ) : null}
          {head("name", variant === "agents" ? "Agent" : "Organization")}
          {head("stage", "Stage")}
          {variant === "agents" ? <TableHead>IU · Certified</TableHead> : head("cameFrom", "Came from")}
          {head("owner", "Owner")}
          {variant === "partners" ? head("agents", "Agents", "right") : head("updatedAt", "Updated")}
          {head("deals", "Deals", "right")}
          {head("nextStepDue", "Next step")}
        </TableRow>
      </TableHeader>
      <TableBody>
        {loading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <TableRow key={i}>
              {Array.from({ length: cols }).map((__, j) => (
                <TableCell key={j}>
                  <Skeleton className="h-3.5 w-20" />
                </TableCell>
              ))}
            </TableRow>
          ))
        ) : rows.length === 0 ? (
          <TableMessageRow colSpan={cols}>
            <EmptyState icon={Building2} title={empty.title} description={empty.description} />
          </TableMessageRow>
        ) : (
          rows.map((o) => (
            <TableRow key={o.id} interactive onClick={() => onOpen(o)} data-testid="organization-row">
              {selectable ? (
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    className="size-4"
                    aria-label={`Select ${o.name}`}
                    checked={selected!.has(o.id)}
                    onChange={(e) => {
                      const next = new Set(selected);
                      if (e.target.checked) next.add(o.id);
                      else next.delete(o.id);
                      onSelect!(next);
                    }}
                  />
                </TableCell>
              ) : null}
              <TableCell>
                <div className="flex flex-wrap items-center gap-1.5 font-medium text-foreground">
                  {o.name}
                  {variant === "partners" && o.kind !== "PARTNER_ISO" ? (
                    <Badge tone={ORG_KIND_TONE[o.kind]} icon={false}>
                      {ORG_KIND_LABEL[o.kind]}
                    </Badge>
                  ) : null}
                  {o.needsReview ? (
                    <Badge tone="warning" icon={false} title="Stage and came-from were filled in from a spreadsheet; confirm them">
                      Check
                    </Badge>
                  ) : null}
                </div>
                <div className="text-xs text-muted-foreground">
                  {[o.city, o.state].filter(Boolean).join(", ")}
                  {o.city || o.state ? <span aria-hidden> · </span> : null}
                  {o.parent && variant === "partners" ? <span>Agent of {o.parent.name} · </span> : null}
                  {variant === "agents" ? (
                    // Under an ISO the useful line is where the agent came from (e.g. "BMO · Wayne Herr's team");
                    // how the record was added stays in the tooltip.
                    <span title={`Added via: ${sourceText(o.source, o.sourceDetail)}`} data-testid="agent-came-from">
                      {[o.cameFrom ? cameFromLabel(o.cameFrom) : null, o.cameFromDetail].filter(Boolean).join(" · ") || sourceLabel(o.source)}
                    </span>
                  ) : (
                    <span title={`Added via: ${sourceText(o.source, o.sourceDetail)}`}>{sourceLabel(o.source)}</span>
                  )}
                </div>
              </TableCell>
              <TableCell>
                <StageBadge stage={o.stage} />
              </TableCell>
              {variant === "agents" ? (
                <TableCell>
                  <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                    <span className={o.iuEnrolledAt ? "text-foreground" : ""} title={o.iuEnrolledAt ? `IU since ${formatDay(o.iuEnrolledAt)}` : "Not enrolled in Innowi University"}>
                      <GraduationCap className="mr-0.5 inline size-3.5" aria-hidden />
                      {o.iuEnrolledAt ? "IU" : "—"}
                    </span>
                    <span className={o.certified ? "text-foreground" : ""} title={o.certified ? "Innowi Certified" : "Not certified"}>
                      <Award className="mr-0.5 inline size-3.5" aria-hidden />
                      {o.certified ? "Certified" : "—"}
                    </span>
                  </span>
                </TableCell>
              ) : (
                <TableCell>
                  <div className="text-foreground">{o.cameFrom ? cameFromLabel(o.cameFrom) : <span className="text-muted-foreground">—</span>}</div>
                  {o.cameFromDetail ? <div className="max-w-[180px] truncate text-xs text-muted-foreground">{o.cameFromDetail}</div> : null}
                </TableCell>
              )}
              <TableCell>{o.owner ? o.owner.name : <span className="text-muted-foreground">Unassigned</span>}</TableCell>
              {variant === "partners" ? (
                <TableCell align="right" className="tabular">
                  {o.agentCount ? (
                    <span title={`${o.agentsIuEnrolled} in IU · ${o.agentsCertified} certified · ${o.agentsSelling} selling`}>
                      {o.agentCount}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
              ) : (
                <TableCell className="text-xs text-muted-foreground">{formatDay(o.updatedAt)}</TableCell>
              )}
              <TableCell align="right">
                <span className="inline-flex items-center justify-end gap-1.5">
                  <SellingBadge selling={o.selling} deals={o.dealsLast30} />
                  <span className="tabular">{o.dealCount}</span>
                </span>
              </TableCell>
              <TableCell>
                {o.nextStep ? (
                  <div className="max-w-[200px]">
                    <div className="truncate text-foreground" title={o.nextStep}>
                      {o.nextStep}
                    </div>
                    {o.nextStepDue ? <div className="text-xs text-muted-foreground">by {formatDay(o.nextStepDue)}</div> : null}
                  </div>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}
