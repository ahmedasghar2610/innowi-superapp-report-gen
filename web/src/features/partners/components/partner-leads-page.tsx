"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarClock, Handshake, Inbox, Search, ShieldAlert, Trophy, X } from "lucide-react";
import { Button, Card, EmptyState, Select, StatTile } from "@/components/ui";
import { useAuth } from "@/features/auth/auth-context";
import { hasCapability } from "@/features/auth/capabilities";
import { MerchantPagination } from "@/features/merchants/components/merchant-pagination";
import { STATUS_LABEL, ctaLabel } from "../labels";
import { usePartnerLeadSummary, usePartnerLeads, usePartnerTeam } from "../queries";
import { PARTNER_LEAD_STATUSES, type PartnerLeadQuery, type PartnerLeadSort, type PartnerLeadStatus } from "../types";
import { PartnerLeadDrawer } from "./partner-lead-drawer";
import { PartnerLeadTable } from "./partner-lead-table";

interface Filters {
  q: string;
  status: PartnerLeadStatus | "";
  assignedTo: string;
  source: string;
}
const EMPTY: Filters = { q: "", status: "", assignedTo: "", source: "" };

/** Read ?lead=<id> so links from e-mails / Teams cards can open a lead directly. */
function useLeadParam(): [string | null, (id: string | null) => void] {
  const [leadId, setLeadId] = useState<string | null>(null);
  useEffect(() => {
    setLeadId(new URLSearchParams(window.location.search).get("lead"));
  }, []);
  const set = (id: string | null) => {
    setLeadId(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("lead", id);
    else url.searchParams.delete("lead");
    window.history.replaceState(null, "", url.toString());
  };
  return [leadId, set];
}

/**
 * Partner leads (route: /partners) — applications from partners.innowi.com.
 * Same data as the partner portal's own dashboard: an owner or status set here
 * shows up there, in the lead e-mails' history and vice versa.
 */
export function PartnerLeadsPage() {
  const { user } = useAuth();
  const canView = hasCapability(user?.role, "partners.view");
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [term, setTerm] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [leadId, setLeadId] = useLeadParam();
  const [sort, setSort] = useState<{ by: PartnerLeadSort; order: "asc" | "desc" }>({ by: "createdAt", order: "desc" });

  const query: PartnerLeadQuery = {
    page,
    sortBy: sort.by,
    order: sort.order,
    q: filters.q || undefined,
    status: filters.status || undefined,
    assignedTo: filters.assignedTo || undefined,
    source: filters.source || undefined,
  };
  const { data, isPending, isError, error, isFetching, isPlaceholderData, refetch } = usePartnerLeads(query, {
    enabled: canView,
  });
  const summary = usePartnerLeadSummary({ enabled: canView });
  const { data: team } = usePartnerTeam({ enabled: canView });

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  if (user === undefined) return null;
  if (!canView) {
    return (
      <Card>
        <EmptyState icon={ShieldAlert} title="No access" description="Partner leads are available to Innowi staff roles." />
      </Card>
    );
  }

  const patch = (p: Partial<Filters>) => {
    setFilters((f) => ({ ...f, ...p }));
    setPage(1);
  };
  const onSearch = (value: string) => {
    setTerm(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => patch({ q: value.trim() }), 300);
  };
  const hasActive = Boolean(filters.q || filters.status || filters.assignedTo || filters.source);
  const s = summary.data;
  const won = s?.byStatus.find((b) => b.key === "won")?.count ?? 0;
  const rows = data?.data ?? [];

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-[-0.011em] text-foreground">Partner leads</h1>
        <p className="mt-1 text-table text-muted-foreground">
          ISOs, agents and resellers who applied on{" "}
          <a href="https://partners.innowi.com" target="_blank" rel="noopener noreferrer" className="font-medium text-foreground underline underline-offset-4">
            partners.innowi.com
          </a>
          . New applications are also posted to the Partnership Updates chat in Teams.
        </p>
      </div>

      {!summary.isError && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile icon={Handshake} label="Leads" value={s?.total ?? 0} status="excluding spam" loading={summary.isPending} />
          <StatTile
            icon={Inbox}
            label="Waiting for an owner"
            value={s?.unassigned ?? 0}
            status={(s?.unassigned ?? 0) > 0 ? "new and unassigned" : "all picked up"}
            tone={(s?.unassigned ?? 0) > 0 ? "warning" : "ok"}
            loading={summary.isPending}
          />
          <StatTile icon={CalendarClock} label="Last 7 days" value={s?.last7Days ?? 0} status="new applications" loading={summary.isPending} />
          <StatTile icon={Trophy} label="Won" value={won} status={won > 0 ? "signed partners" : "none yet"} tone={won > 0 ? "ok" : "neutral"} loading={summary.isPending} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-[280px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={term}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search name, company or email…"
            aria-label="Search partner leads"
            className="h-7 w-full rounded-sm border border-border bg-background pl-8 pr-3 text-xs font-medium leading-4 text-foreground placeholder:font-normal placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent"
          />
        </div>
        <Select
          value={filters.status}
          onChange={(e) => patch({ status: e.target.value as PartnerLeadStatus | "" })}
          aria-label="Filter by status"
          className="w-[150px]"
        >
          <option value="">All statuses</option>
          {PARTNER_LEAD_STATUSES.map((st) => (
            <option key={st} value={st}>
              {STATUS_LABEL[st]}
            </option>
          ))}
        </Select>
        <Select
          value={filters.assignedTo}
          onChange={(e) => patch({ assignedTo: e.target.value })}
          aria-label="Filter by owner"
          className="w-[170px]"
        >
          <option value="">Any owner</option>
          <option value="unassigned">Unassigned</option>
          {(team ?? []).map((m) => (
            <option key={m.email} value={m.email}>
              {m.name || m.email}
            </option>
          ))}
        </Select>
        <Select
          value={filters.source}
          onChange={(e) => patch({ source: e.target.value })}
          aria-label="Filter by the button they clicked"
          className="w-[200px]"
        >
          <option value="">Button clicked: any</option>
          {(s?.bySource ?? [])
            .filter((b) => b.key !== "unknown")
            .map((b) => (
              <option key={b.key} value={b.key}>
                {ctaLabel(b.key)} ({b.count})
              </option>
            ))}
        </Select>
        {hasActive && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setTerm("");
              patch(EMPTY);
            }}
          >
            <X className="size-4" />
            Clear
          </Button>
        )}
      </div>

      <div>
        <Card>
          <PartnerLeadTable
            leads={rows}
            team={team}
            isPending={isPending}
            isError={isError}
            error={error}
            onRetry={() => refetch()}
            onSelect={(lead) => setLeadId(lead.id)}
            sort={sort}
            onSort={(by) => {
              setSort((cur) => (cur.by === by ? { by, order: cur.order === "asc" ? "desc" : "asc" } : { by, order: by === "createdAt" ? "desc" : "asc" }));
              setPage(1);
            }}
            busy={isFetching && isPlaceholderData}
            filtered={hasActive}
          />
        </Card>
        {data?.meta && rows.length > 0 && <MerchantPagination meta={data.meta} onPageChange={setPage} />}
      </div>

      <PartnerLeadDrawer leadId={leadId} team={team} onClose={() => setLeadId(null)} />
    </div>
  );
}
