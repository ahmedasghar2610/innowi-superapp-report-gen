"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, GraduationCap, Plus, Search, ShieldAlert, Users, UserPlus, X } from "lucide-react";
import { Button, Card, EmptyState, ErrorState, Select, SectionHead, Skeleton, StatTile } from "@/components/ui";
import { useAuth } from "@/features/auth/auth-context";
import { useCan } from "@/features/auth/use-can";
import { MerchantPagination } from "@/features/merchants/components/merchant-pagination";
import { ORG_KIND_LABEL, PARTNER_STAGE_LABEL } from "../labels";
import { useOrganizationDetail, useOrganizationList } from "../queries";
import { ALL_PARTNER_STAGES, type PartnerStage } from "../types";
import { AddAgentsDialog } from "./add-agents-dialog";
import { AssignDialog, type AssignScope } from "./assign-dialog";
import { OrgBody, OrganizationDrawer } from "./organization-drawer";
import { OrgTable, type OrgSort } from "./org-table";
import { useSalesPeople } from "./partner-ui";

const INPUT =
  "h-7 rounded-sm border border-border bg-background px-2 text-xs font-medium leading-4 text-foreground placeholder:font-normal placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent";

/**
 * One organization on its own page (route: /organizations/:id). For an ISO this
 * is where its agents live: each agent's stage, Innowi University, certification,
 * whether it is selling, and who looks after it — with bulk assignment.
 */
export function OrganizationPage({ id }: { id: string }) {
  const { user } = useAuth();
  const can = useCan();
  const { data, isPending, isError, error, refetch } = useOrganizationDetail(id);

  if (user === undefined) return null;
  if (!can("organizations.view")) {
    return (
      <Card>
        <EmptyState icon={ShieldAlert} title="No access" description="Organizations are available to Innowi staff roles." />
      </Card>
    );
  }
  if (isError) return <ErrorState title="Couldn't load this organization" error={error} onRetry={() => refetch()} />;
  if (isPending || !data) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const isIso = !data.parent && (data.kind === "PARTNER_ISO" || data.agentCount > 0);
  return (
    <div className="flex flex-col gap-6" data-testid="organization-page">
      <div>
        <Link
          href={data.parent ? `/organizations/${data.parent.id}` : "/organizations"}
          className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" aria-hidden /> {data.parent ? data.parent.name : "Organizations"}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-[-0.011em] text-foreground">{data.name}</h1>
        <p className="mt-1 text-table text-muted-foreground">
          {[ORG_KIND_LABEL[data.kind], [data.city, data.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ")}
        </p>
      </div>

      {isIso ? <Agents iso={{ id: data.id, name: data.name }} counts={data} /> : null}

      <Card className="p-5">
        <OrgBody org={data} />
      </Card>
    </div>
  );
}

function Agents({
  iso,
  counts,
}: {
  iso: { id: string; name: string };
  counts: { agentCount: number; agentsIuEnrolled: number; agentsCertified: number; agentsSelling: number };
}) {
  const can = useCan();
  const canManage = can("organizations.manage");
  const canAssign = can("organizations.assign");
  const { sales, others } = useSalesPeople();
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const [term, setTerm] = useState("");
  const [search, setSearch] = useState("");
  const [stage, setStage] = useState<PartnerStage | "">("");
  const [owner, setOwner] = useState("");
  const [more, setMore] = useState<"" | "selling" | "notSelling">("");
  const [sort, setSort] = useState<OrgSort>({ by: "name", order: "asc" });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assign, setAssign] = useState<AssignScope | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const list = useOrganizationList({
    parentId: iso.id,
    page,
    limit,
    search: search || undefined,
    stage: stage || undefined,
    ownerId: owner || undefined,
    selling: more === "selling" ? true : more === "notSelling" ? false : undefined,
    sortBy: sort.by,
    order: sort.order,
  });
  const unassigned = useOrganizationList({ parentId: iso.id, ownerId: "none", limit: 1 });
  const rows = list.data?.data ?? [];
  const hasActive = search || stage || owner || more;
  const reset = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(1);
    setSelected(new Set());
  };
  const unassignedCount = unassigned.data?.meta.total ?? 0;

  return (
    <section className="flex flex-col gap-3" aria-label="Agents" data-testid="iso-agents">
      <SectionHead
        title={`Agents (${counts.agentCount})`}
        description="Everyone selling Innowi under this ISO: their stage, Innowi University, certification, and who looks after them."
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile icon={Users} label="Agents" value={counts.agentCount} status={`${unassignedCount} without an owner`} />
        <StatTile icon={GraduationCap} label="In Innowi University" value={counts.agentsIuEnrolled} status="enrolled or further" />
        <StatTile icon={GraduationCap} label="Certified" value={counts.agentsCertified} status="Innowi Certified" tone={counts.agentsCertified ? "ok" : "neutral"} />
        <StatTile icon={Users} label="Selling" value={counts.agentsSelling} status="a deal in the last 30 days" tone={counts.agentsSelling ? "ok" : "neutral"} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-[220px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={term}
            onChange={(e) => {
              const v = e.target.value;
              setTerm(v);
              if (timer.current) clearTimeout(timer.current);
              timer.current = setTimeout(() => {
                setSearch(v.trim());
                setPage(1);
              }, 300);
            }}
            placeholder="Search agents…"
            aria-label="Search agents"
            className={`${INPUT} w-full pl-8 pr-3`}
          />
        </div>
        <Select value={stage} onChange={(e) => reset(setStage)(e.target.value as PartnerStage | "")} aria-label="Filter agents by stage" className="w-[150px]">
          <option value="">Any stage</option>
          {ALL_PARTNER_STAGES.map((s) => (
            <option key={s} value={s}>
              {PARTNER_STAGE_LABEL[s]}
            </option>
          ))}
        </Select>
        <Select value={owner} onChange={(e) => reset(setOwner)(e.target.value)} aria-label="Filter agents by owner" className="w-[160px]">
          <option value="">Any owner</option>
          <option value="me">Mine</option>
          <option value="none">Unassigned</option>
          {[...sales, ...others].map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        <Select value={more} onChange={(e) => reset(setMore)(e.target.value as "" | "selling" | "notSelling")} aria-label="Filter agents by selling" className="w-[150px]">
          <option value="">Selling or not</option>
          <option value="selling">Selling</option>
          <option value="notSelling">Not selling</option>
        </Select>
        {hasActive ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setTerm("");
              setSearch("");
              setStage("");
              setOwner("");
              setMore("");
              setPage(1);
            }}
          >
            <X className="size-4" /> Clear
          </Button>
        ) : null}
        <span className="ml-auto flex flex-wrap gap-2">
          {canManage ? (
            <Button variant="outline" size="sm" onClick={() => setAddOpen(true)} data-testid="add-agents">
              <Plus className="size-4" /> Add agents
            </Button>
          ) : null}
          {canAssign && counts.agentCount > 0 ? (
            <Button variant="default" size="sm" onClick={() => setAssign({ parentId: iso.id, label: `${iso.name}'s agents` })} data-testid="assign-agents">
              <UserPlus className="size-4" /> Assign agents…
            </Button>
          ) : null}
        </span>
      </div>

      {canAssign && selected.size > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary bg-accent px-3 py-2 text-table" data-testid="selection-bar">
          <span className="font-medium text-foreground">{selected.size} selected</span>
          <Button
            variant="default"
            size="sm"
            onClick={() => setAssign({ organizationIds: [...selected], label: `${selected.size} agent${selected.size === 1 ? "" : "s"}` })}
            data-testid="assign-selected"
          >
            <UserPlus className="size-4" /> Assign selected…
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
            Clear selection
          </Button>
        </div>
      ) : null}

      <div>
        <Card>
          {list.isError ? (
            <ErrorState title="Couldn't load agents" error={list.error} onRetry={() => list.refetch()} />
          ) : (
            <div className={list.isFetching && list.isPlaceholderData ? "opacity-60 transition-opacity" : ""}>
              <OrgTable
                rows={rows}
                loading={list.isPending}
                variant="agents"
                sort={sort}
                onSort={(s) => {
                  setSort(s);
                  setPage(1);
                }}
                selected={canAssign ? selected : undefined}
                onSelect={canAssign ? setSelected : undefined}
                onOpen={(o) => setOpenId(o.id)}
                empty={
                  hasActive
                    ? { title: "No agents match", description: "Try clearing a filter." }
                    : { title: "No agents yet", description: canManage ? "Paste their agent list with “Add agents”." : "Agents appear here once added." }
                }
              />
            </div>
          )}
        </Card>
        {list.data?.meta && rows.length > 0 && (
          <MerchantPagination meta={list.data.meta} onPageChange={setPage} onPageSizeChange={(n) => { setLimit(n); setPage(1); }} />
        )}
      </div>

      <OrganizationDrawer orgId={openId} onClose={() => setOpenId(null)} />
      {canManage ? <AddAgentsDialog open={addOpen} onClose={() => setAddOpen(false)} isoId={iso.id} isoName={iso.name} /> : null}
      {canAssign && assign ? (
        <AssignDialog
          open={!!assign}
          onClose={() => {
            setAssign(null);
            setSelected(new Set());
          }}
          scope={assign}
        />
      ) : null}
    </section>
  );
}
