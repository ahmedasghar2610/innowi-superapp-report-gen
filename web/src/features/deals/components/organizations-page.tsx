"use client";

import { useEffect, useRef, useState } from "react";
import { Award, Building2, Plus, Search, ShieldAlert, TrendingUp, UserPlus, UserX, X } from "lucide-react";
import { ORGANIZATION_SOURCES, SOURCE_LABEL, SOURCE_NOT_RECORDED } from "@/features/sources/labels";
import { Button, Card, EmptyState, ErrorState, Select, StatTile } from "@/components/ui";
import { useAuth } from "@/features/auth/auth-context";
import { useCan } from "@/features/auth/use-can";
import { MerchantPagination } from "@/features/merchants/components/merchant-pagination";
import { CAME_FROM_LABEL, ORG_KIND_LABEL, PARTNER_STAGE_LABEL } from "../labels";
import { useOrganizationList } from "../queries";
import { ALL_PARTNER_STAGES, CAME_FROM, ORGANIZATION_KINDS, type CameFrom, type OrganizationKind, type PartnerStage } from "../types";
import { AssignDialog } from "./assign-dialog";
import { NewOrganizationDialog } from "./new-organization-dialog";
import { OrganizationDrawer } from "./organization-drawer";
import { OrgTable, type OrgSort } from "./org-table";
import { useSalesPeople } from "./partner-ui";

const INPUT =
  "h-7 rounded-sm border border-border bg-background px-2 text-xs font-medium leading-4 text-foreground placeholder:font-normal placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent";

function useParam(name: string): [string | null, (v: string | null) => void] {
  const [v, setV] = useState<string | null>(null);
  useEffect(() => {
    setV(new URLSearchParams(window.location.search).get(name));
  }, [name]);
  const set = (next: string | null) => {
    setV(next);
    const url = new URL(window.location.href);
    if (next) url.searchParams.set(name, next);
    else url.searchParams.delete(name);
    window.history.replaceState(null, "", url.toString());
  };
  return [v, set];
}

/**
 * Organizations (route: /organizations): the partners who bring us restaurants
 * (ISOs, resellers, agents) and the contractors who install. Agents that work
 * under an ISO are listed on the ISO's own page, not here.
 */
export function OrganizationsPage() {
  const { user } = useAuth();
  const can = useCan();
  const canView = can("organizations.view");
  const canManage = can("organizations.manage");
  const canAssign = can("organizations.assign");
  const [orgId, setOrgId] = useParam("org");
  const [ownerParam, setOwnerParam] = useParam("owner");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const [term, setTerm] = useState("");
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<OrganizationKind | "">("");
  const [stage, setStage] = useState<PartnerStage | "">("");
  const [cameFrom, setCameFrom] = useState<CameFrom | "NONE" | "">("");
  const [source, setSource] = useState("");
  const [more, setMore] = useState<"" | "selling" | "review">("");
  const [sort, setSort] = useState<OrgSort>({ by: "name", order: "asc" });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assignOpen, setAssignOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const owner = ownerParam ?? "";
  const { sales, others } = useSalesPeople();

  const list = useOrganizationList(
    {
      page,
      limit,
      search: search || undefined,
      kind: kind || undefined,
      stage: stage || undefined,
      cameFrom: cameFrom || undefined,
      ownerId: owner || undefined,
      source: source || undefined,
      selling: more === "selling" ? true : undefined,
      needsReview: more === "review" ? true : undefined,
      topLevel: true,
      sortBy: sort.by,
      order: sort.order,
    },
    { enabled: canView },
  );
  const all = useOrganizationList({ limit: 200, topLevel: true }, { enabled: canView });
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  if (user === undefined) return null;
  if (!canView) {
    return (
      <Card>
        <EmptyState icon={ShieldAlert} title="No access" description="Organizations are available to Innowi staff roles." />
      </Card>
    );
  }

  const onSearch = (v: string) => {
    setTerm(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setSearch(v.trim());
      setPage(1);
    }, 300);
  };
  const reset = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(1);
    setSelected(new Set());
  };
  const rows = list.data?.data ?? [];
  const everyone = all.data?.data ?? [];
  const partnerRows = everyone.filter((o) => o.kind !== "CONTRACTOR" && o.kind !== "OTHER");
  const sellingCount = partnerRows.filter((o) => o.selling).length;
  const certifiedCount = partnerRows.filter((o) => o.certified).length;
  const unassigned = partnerRows.filter((o) => !o.owner).length;
  const hasActive = search || kind || stage || cameFrom || owner || source || more;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.011em] text-foreground">Organizations</h1>
          <p className="mt-1 text-table text-muted-foreground">
            The partners who bring us restaurants (ISOs, resellers, agents) and the contractors who install. An ISO&apos;s agents are on the ISO&apos;s page.
          </p>
        </div>
        {canManage ? (
          <Button variant="default" size="sm" onClick={() => setNewOpen(true)} data-testid="new-organization">
            <Plus className="size-4" /> New organization
          </Button>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile icon={Building2} label="Partners" value={partnerRows.length} status="ISOs, resellers, agents" loading={all.isPending} />
        <StatTile icon={TrendingUp} label="Selling" value={sellingCount} status="a deal in the last 30 days" tone={sellingCount > 0 ? "ok" : "neutral"} loading={all.isPending} />
        <StatTile icon={Award} label="Certified" value={certifiedCount} status="Innowi Certified Partner" loading={all.isPending} />
        <StatTile icon={UserX} label="Unassigned" value={unassigned} status="no salesperson yet" loading={all.isPending} />
      </div>

      <div className="flex flex-wrap items-center gap-2" data-testid="organization-filters">
        <div className="relative w-full max-w-[240px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input type="search" value={term} onChange={(e) => onSearch(e.target.value)} placeholder="Search name, city, contact…" aria-label="Search organizations" className={`${INPUT} w-full pl-8 pr-3`} />
        </div>
        <Select value={stage} onChange={(e) => reset(setStage)(e.target.value as PartnerStage | "")} aria-label="Filter by stage" className="w-[150px]">
          <option value="">Any stage</option>
          {ALL_PARTNER_STAGES.map((s) => (
            <option key={s} value={s}>
              {PARTNER_STAGE_LABEL[s]}
            </option>
          ))}
        </Select>
        <Select value={cameFrom} onChange={(e) => reset(setCameFrom)(e.target.value as CameFrom | "NONE" | "")} aria-label="Filter by came from" className="w-[160px]">
          <option value="">Came from: any</option>
          {CAME_FROM.map((c) => (
            <option key={c} value={c}>
              {CAME_FROM_LABEL[c]}
            </option>
          ))}
          <option value="NONE">Not set</option>
        </Select>
        <Select value={owner} onChange={(e) => { setOwnerParam(e.target.value || null); setPage(1); setSelected(new Set()); }} aria-label="Filter by owner" className="w-[160px]">
          <option value="">Any owner</option>
          <option value="me">Mine</option>
          <option value="none">Unassigned</option>
          {[...sales, ...others].map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        <Select value={kind} onChange={(e) => reset(setKind)(e.target.value as OrganizationKind | "")} aria-label="Filter by kind" className="w-[130px]">
          <option value="">Any kind</option>
          {ORGANIZATION_KINDS.map((k) => (
            <option key={k} value={k}>
              {ORG_KIND_LABEL[k]}
            </option>
          ))}
        </Select>
        <Select value={source} onChange={(e) => reset(setSource)(e.target.value)} aria-label="Filter by how it was added" className="w-[160px]">
          <option value="">Added via: any</option>
          {ORGANIZATION_SOURCES.map((s) => (
            <option key={s} value={s}>
              {SOURCE_LABEL[s]}
            </option>
          ))}
          <option value={SOURCE_NOT_RECORDED}>Not recorded</option>
        </Select>
        <Select value={more} onChange={(e) => reset(setMore)(e.target.value as "" | "selling" | "review")} aria-label="More filters" className="w-[150px]">
          <option value="">Everything</option>
          <option value="selling">Selling now</option>
          <option value="review">Needs a check</option>
        </Select>
        {hasActive ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setTerm("");
              setSearch("");
              setKind("");
              setStage("");
              setCameFrom("");
              setOwnerParam(null);
              setSource("");
              setMore("");
              setPage(1);
              setSelected(new Set());
            }}
          >
            <X className="size-4" /> Clear
          </Button>
        ) : null}
      </div>

      {canAssign && selected.size > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary bg-accent px-3 py-2 text-table" data-testid="selection-bar">
          <span className="font-medium text-foreground">{selected.size} selected</span>
          <Button variant="default" size="sm" onClick={() => setAssignOpen(true)} data-testid="assign-selected">
            <UserPlus className="size-4" /> Assign…
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
            Clear selection
          </Button>
        </div>
      ) : null}

      <div>
        <Card>
          {list.isError ? (
            <ErrorState title="Couldn't load organizations" error={list.error} onRetry={() => list.refetch()} />
          ) : (
            <div className={list.isFetching && list.isPlaceholderData ? "opacity-60 transition-opacity" : ""}>
              <OrgTable
                rows={rows}
                loading={list.isPending}
                sort={sort}
                onSort={(s) => {
                  setSort(s);
                  setPage(1);
                }}
                selected={canAssign ? selected : undefined}
                onSelect={canAssign ? setSelected : undefined}
                onOpen={(o) => setOrgId(o.id)}
                empty={
                  hasActive
                    ? { title: "No organizations match", description: "Try clearing a filter." }
                    : { title: "No organizations yet", description: "Add the first partner or contractor with “New organization”." }
                }
              />
            </div>
          )}
        </Card>
        {list.data?.meta && rows.length > 0 && (
          <MerchantPagination meta={list.data.meta} onPageChange={setPage} onPageSizeChange={(n) => { setLimit(n); setPage(1); }} />
        )}
      </div>

      <OrganizationDrawer orgId={orgId} onClose={() => setOrgId(null)} />
      <NewOrganizationDialog open={newOpen} onClose={() => setNewOpen(false)} onCreated={(o) => setOrgId(o.id)} />
      {canAssign ? (
        <AssignDialog
          open={assignOpen}
          onClose={() => {
            setAssignOpen(false);
            setSelected(new Set());
          }}
          scope={{ organizationIds: [...selected], label: `${selected.size} partner${selected.size === 1 ? "" : "s"}` }}
        />
      ) : null}
    </div>
  );
}
