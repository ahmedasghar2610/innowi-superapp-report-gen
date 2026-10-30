"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronUp, Lightbulb, MessageSquare, Plus, Search } from "lucide-react";
import { Badge, Button, Card, EmptyState, ErrorState, Select, Skeleton } from "@/components/ui";
import { useCan } from "@/features/auth/use-can";
import { cn } from "@/lib/utils/cn";
import { AREAS, AREA_LABEL, STATUS_LABEL, STATUS_TONE, TYPES, TYPE_LABEL, URGENCY_SHORT, ago } from "../labels";
import { useRequestList, useVote } from "../queries";
import type { RequestArea, RequestCounts, RequestRow, RequestType, SortKey, StatusFilter } from "../types";
import { RequestFormDialog } from "./request-form-dialog";

const TABS: { key: StatusFilter; label: string; count: (c: RequestCounts) => number }[] = [
  { key: "open", label: "Open", count: (c) => c.open },
  { key: "NEW", label: "New", count: (c) => c.new },
  { key: "NEEDS_INFO", label: "Needs info", count: (c) => c.needsInfo },
  { key: "approved", label: "On the roadmap", count: (c) => c.approved },
  { key: "SHIPPED", label: "Shipped", count: (c) => c.shipped },
  { key: "closed", label: "Closed", count: (c) => c.closed },
];

export function VoteButton({ row, size = "md" }: { row: Pick<RequestRow, "ref" | "votes" | "votedByMe" | "title">; size?: "md" | "lg" }) {
  const vote = useVote();
  return (
    <button
      type="button"
      aria-pressed={row.votedByMe}
      aria-label={`${row.votedByMe ? "Remove your upvote from" : "Upvote"} ${row.title} (${row.votes} ${row.votes === 1 ? "vote" : "votes"})`}
      title={row.votedByMe ? "You upvoted this — click to take it back" : "I need this too"}
      disabled={vote.isPending}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        vote.mutate({ ref: row.ref, on: !row.votedByMe });
      }}
      className={cn(
        "flex shrink-0 flex-col items-center justify-center rounded-lg border tabular-nums transition-colors",
        "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent",
        size === "lg" ? "h-14 w-14" : "h-12 w-11",
        row.votedByMe
          ? "border-primary bg-accent text-primary-subtle-foreground"
          : "border-border bg-card text-foreground hover:bg-secondary",
      )}
    >
      <ChevronUp className="size-4" aria-hidden />
      <span className="text-sm font-semibold leading-none">{row.votes}</span>
    </button>
  );
}

function Row({ r }: { r: RequestRow }) {
  return (
    <li className="flex items-start gap-3 px-4 py-3 hover:bg-muted/60">
      <VoteButton row={r} />
      <Link
        href={`/requests/${r.ref}`}
        className="flex min-w-0 flex-1 items-start gap-3 rounded-md focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-medium text-foreground">{r.title}</span>
            {(r.urgency === "HIGH" || r.urgency === "BLOCKING") && (
              <Badge tone={r.urgency === "BLOCKING" ? "danger" : "warning"}>{URGENCY_SHORT[r.urgency]}</Badge>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span className="font-medium tabular-nums text-foreground/80">{r.ref}</span>
            <span aria-hidden>·</span>
            <span>{TYPE_LABEL[r.type]}</span>
            <span aria-hidden>·</span>
            <span>{AREA_LABEL[r.area]}</span>
            <span aria-hidden>·</span>
            <span>{r.mine ? "You" : r.requester.name}, {ago(r.createdAt)}</span>
            {r.comments > 0 && (
              <span className="inline-flex items-center gap-1" aria-label={`${r.comments} comments`}>
                <MessageSquare className="size-3.5" aria-hidden />{r.comments}
              </span>
            )}
          </div>
        </div>
        <Badge tone={STATUS_TONE[r.status]} icon={false} className="mt-0.5 shrink-0">{STATUS_LABEL[r.status]}</Badge>
      </Link>
    </li>
  );
}

/** Route /requests — everyone's requests, newest asks and most-wanted first. */
export function RequestsPage() {
  const can = useCan();
  const [status, setStatus] = useState<StatusFilter>("open");
  const [type, setType] = useState<RequestType | "">("");
  const [area, setArea] = useState<RequestArea | "">("");
  const [mine, setMine] = useState(false);
  const [sort, setSort] = useState<SortKey>("top");
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 250);
    return () => clearTimeout(t);
  }, [text]);

  const list = useRequestList({ status, type: type || undefined, area: area || undefined, mine: mine || undefined,
    q: q || undefined, sort });

  if (!can("requests.view")) {
    return <Card><EmptyState title="No access" description="Ask an admin for access to Requests." /></Card>;
  }
  const data = list.data;
  const filtered = Boolean(type || area || mine || q);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="max-w-2xl">
          <h1 className="text-2xl font-semibold tracking-[-0.011em] text-foreground">Requests</h1>
          <p className="mt-1 text-table text-muted-foreground">
            Ideas, missing features, bugs and anything in your way. Upvote what you need too — the most-wanted
            asks get looked at first, and approved ones go onto the{" "}
            <Link href="/roadmap" className="text-primary hover:underline">roadmap</Link>.
          </p>
        </div>
        {can("requests.create") && (
          <Button variant="default" onClick={() => setCreating(true)}>
            <Plus className="size-4" /> New request
          </Button>
        )}
      </div>

      {data?.canTriage && data.counts.new > 0 && status !== "NEW" && (
        <button
          type="button"
          onClick={() => setStatus("NEW")}
          className="flex items-center gap-2 self-start rounded-lg border border-accent bg-accent/50 px-3 py-2 text-sm text-foreground hover:bg-accent"
        >
          <Lightbulb className="size-4 text-primary" aria-hidden />
          <span><span className="font-semibold tabular-nums">{data.counts.new}</span> new {data.counts.new === 1 ? "request is" : "requests are"} waiting for triage</span>
        </button>
      )}

      <div role="tablist" aria-label="Status" className="flex flex-wrap gap-1 border-b border-border">
        {TABS.map((t) => {
          const active = status === t.key;
          const n = data ? t.count(data.counts) : undefined;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setStatus(t.key)}
              className={cn(
                "-mb-px border-b-2 px-3 py-2 text-sm",
                active ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
              {n !== undefined && <span className="ml-1.5 tabular-nums text-muted-foreground">{n}</span>}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Search or R-1001…"
            aria-label="Search requests"
            className="h-8 w-full rounded-lg border border-border bg-card pl-8 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent"
          />
        </div>
        <Select aria-label="Type" value={type} onChange={(e) => setType(e.target.value as RequestType | "")} className="w-auto min-w-[140px]">
          <option value="">Any type</option>
          {TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
        </Select>
        <Select aria-label="Area" value={area} onChange={(e) => setArea(e.target.value as RequestArea | "")} className="w-auto min-w-[150px]">
          <option value="">All areas</option>
          {AREAS.map((a) => <option key={a} value={a}>{AREA_LABEL[a]}</option>)}
        </Select>
        <Select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="w-auto min-w-[140px]">
          <option value="top">Most upvoted</option>
          <option value="new">Newest</option>
          <option value="updated">Recently changed</option>
        </Select>
        <label className="ml-1 inline-flex items-center gap-1.5 text-sm text-foreground">
          <input type="checkbox" className="size-4 accent-[var(--color-primary)]" checked={mine} onChange={(e) => setMine(e.target.checked)} />
          Only mine{data ? <span className="tabular-nums text-muted-foreground">({data.counts.mine})</span> : null}
        </label>
        {filtered && (
          <Button variant="ghost" size="sm" onClick={() => { setType(""); setArea(""); setMine(false); setText(""); }}>
            Clear filters
          </Button>
        )}
      </div>

      {list.isPending ? (
        <Skeleton className="h-80" />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : !data?.data.length ? (
        <Card>
          <EmptyState
            title={filtered || status !== "open" ? "Nothing here" : "No requests yet"}
            description={filtered || status !== "open"
              ? "Try another tab or clear the filters."
              : "Have an idea or something in your way? Send the first request."}
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-border" aria-label="Requests">
            {data.data.map((r) => <Row key={r.id} r={r} />)}
          </ul>
        </Card>
      )}

      <RequestFormDialog open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}
