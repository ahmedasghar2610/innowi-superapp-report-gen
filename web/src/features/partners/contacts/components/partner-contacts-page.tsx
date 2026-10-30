"use client";

import { useEffect, useRef, useState } from "react";
import { BookUser, CalendarClock, Handshake, Inbox, Search, ShieldAlert, X } from "lucide-react";
import { Button, Card, EmptyState, Select, StatTile } from "@/components/ui";
import { useAuth } from "@/features/auth/auth-context";
import { hasCapability } from "@/features/auth/capabilities";
import { MerchantPagination } from "@/features/merchants/components/merchant-pagination";
import { CONTACT_STATUS_LABEL } from "../labels";
import { usePartnerContactSummary, usePartnerContacts } from "../queries";
import { PARTNER_CONTACT_STATUSES, type PartnerContactQuery, type PartnerContactSort, type PartnerContactStatus } from "../types";
import { PartnerContactDrawer } from "./partner-contact-drawer";
import { PartnerContactTable } from "./partner-contact-table";

interface Filters {
  q: string;
  status: PartnerContactStatus | "";
  event: string;
  promoted: "" | "yes" | "no";
}
const EMPTY: Filters = { q: "", status: "", event: "", promoted: "" };

/** Read ?contact=<id> so links can open a contact directly. */
function useContactParam(): [string | null, (id: string | null) => void] {
  const [contactId, setContactId] = useState<string | null>(null);
  useEffect(() => {
    setContactId(new URLSearchParams(window.location.search).get("contact"));
  }, []);
  const set = (id: string | null) => {
    setContactId(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("contact", id);
    else url.searchParams.delete("contact");
    window.history.replaceState(null, "", url.toString());
  };
  return [contactId, set];
}

/**
 * Partner network (route: /partners/network) — everyone met at conferences,
 * imported or added by hand. Review them here; promote the ones that look like
 * partner prospects, which creates the partner lead.
 */
export function PartnerContactsPage() {
  const { user } = useAuth();
  const canView = hasCapability(user?.role, "partners.view");
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [term, setTerm] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [contactId, setContactId] = useContactParam();
  const [sort, setSort] = useState<{ by: PartnerContactSort; order: "asc" | "desc" }>({ by: "createdAt", order: "desc" });

  const query: PartnerContactQuery = {
    page,
    sortBy: sort.by,
    order: sort.order,
    q: filters.q || undefined,
    status: filters.status || undefined,
    event: filters.event || undefined,
    promoted: filters.promoted ? filters.promoted === "yes" : undefined,
  };
  const { data, isPending, isError, error, isFetching, isPlaceholderData, refetch } = usePartnerContacts(query, {
    enabled: canView,
  });
  const summary = usePartnerContactSummary({ enabled: canView });

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  if (user === undefined) return null;
  if (!canView) {
    return (
      <Card>
        <EmptyState icon={ShieldAlert} title="No access" description="The partner network is available to Innowi staff roles." />
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
  const hasActive = Boolean(filters.q || filters.status || filters.event || filters.promoted);
  const s = summary.data;
  const rows = data?.data ?? [];

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-[-0.011em] text-foreground">Network</h1>
        <p className="mt-1 text-table text-muted-foreground">
          People we&apos;ve met — business cards from conferences, imports and contacts added by hand. Nobody here is a lead
          until someone promotes them.
        </p>
      </div>

      {!summary.isError && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile icon={BookUser} label="Contacts" value={s?.total ?? 0} status="in the network" loading={summary.isPending} />
          <StatTile
            icon={Inbox}
            label="To review"
            value={s?.unreviewed ?? 0}
            status={(s?.unreviewed ?? 0) > 0 ? "nobody has looked yet" : "all reviewed"}
            tone={(s?.unreviewed ?? 0) > 0 ? "warning" : "ok"}
            loading={summary.isPending}
          />
          <StatTile icon={CalendarClock} label="Last 7 days" value={s?.last7Days ?? 0} status="new contacts" loading={summary.isPending} />
          <StatTile
            icon={Handshake}
            label="Promoted"
            value={s?.promoted ?? 0}
            status={(s?.promoted ?? 0) > 0 ? "became partner leads" : "none yet"}
            tone={(s?.promoted ?? 0) > 0 ? "ok" : "neutral"}
            loading={summary.isPending}
          />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-[280px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={term}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search name, company, title or email…"
            aria-label="Search contacts"
            className="h-7 w-full rounded-sm border border-border bg-background pl-8 pr-3 text-xs font-medium leading-4 text-foreground placeholder:font-normal placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent"
          />
        </div>
        <Select
          value={filters.status}
          onChange={(e) => patch({ status: e.target.value as PartnerContactStatus | "" })}
          aria-label="Filter by status"
          className="w-[170px]"
        >
          <option value="">All statuses</option>
          {PARTNER_CONTACT_STATUSES.map((st) => (
            <option key={st} value={st}>
              {CONTACT_STATUS_LABEL[st]}
            </option>
          ))}
        </Select>
        <Select value={filters.event} onChange={(e) => patch({ event: e.target.value })} aria-label="Filter by event" className="w-[190px]">
          <option value="">Any event</option>
          {(s?.byEvent ?? [])
            .filter((b) => b.key !== "unknown")
            .map((b) => (
              <option key={b.key} value={b.key}>
                {b.key} ({b.count})
              </option>
            ))}
        </Select>
        <Select
          value={filters.promoted}
          onChange={(e) => patch({ promoted: e.target.value as Filters["promoted"] })}
          aria-label="Filter by promotion"
          className="w-[170px]"
        >
          <option value="">Promoted or not</option>
          <option value="no">Not promoted</option>
          <option value="yes">Promoted to lead</option>
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
          <PartnerContactTable
            contacts={rows}
            isPending={isPending}
            isError={isError}
            error={error}
            onRetry={() => refetch()}
            onSelect={(c) => setContactId(c.id)}
            busy={isFetching && isPlaceholderData}
            filtered={hasActive}
            sort={sort}
            onSort={(by) => {
              setSort((cur) => (cur.by === by ? { by, order: cur.order === "asc" ? "desc" : "asc" } : { by, order: by === "createdAt" || by === "metOn" ? "desc" : "asc" }));
              setPage(1);
            }}
          />
        </Card>
        {data?.meta && rows.length > 0 && <MerchantPagination meta={data.meta} onPageChange={setPage} />}
      </div>

      <PartnerContactDrawer contactId={contactId} onClose={() => setContactId(null)} />
    </div>
  );
}
