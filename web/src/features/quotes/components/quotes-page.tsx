"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CircleCheck, FileText, Inbox, Link2, Plus, Search, ShieldAlert } from "lucide-react";
import {
  Badge,
  Card,
  EmptyState,
  StatTile,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableMessageRow,
  TableRow,
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/ui";
import { useAuth } from "@/features/auth/auth-context";
import { hasCapability } from "@/features/auth/capabilities";
import { MerchantPagination } from "@/features/merchants/components/merchant-pagination";
import { formatDate } from "@/lib/format";
import { MODE_LABEL, REQUEST_STATUS_LABEL, REQUEST_STATUS_TONE, usd } from "../format";
import { useQuoteLinks, useQuoteRequests, useQuoteSummary } from "../queries";
import type { QuoteLink } from "../types";

function linkState(l: QuoteLink): { label: string; tone: "success" | "neutral" | "warning" } {
  if (l.status === "REVOKED") return { label: "Turned off", tone: "neutral" };
  if (l.expired) return { label: "Expired", tone: "warning" };
  return { label: "Active", tone: "success" };
}

/** Route /quotes: everything sent through quote links, and the links themselves. */
export function QuotesPage() {
  const { user } = useAuth();
  const router = useRouter();
  const canView = hasCapability(user?.role, "quotes.view");
  const canEdit = hasCapability(user?.role, "quotes.edit");
  const [tab, setTab] = useState("requests");
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const summary = useQuoteSummary({ enabled: canView });
  const requests = useQuoteRequests({ page, q: q || undefined }, { enabled: canView && tab === "requests" });
  const links = useQuoteLinks({ page, q: q || undefined }, { enabled: canView && tab === "links" });

  if (user === undefined) return null;
  if (!canView) {
    return (
      <Card>
        <EmptyState icon={ShieldAlert} title="No access" description="Quotes are available to the sales team." />
      </Card>
    );
  }
  const s = summary.data;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.011em] text-foreground">Quotes</h1>
          <p className="mt-1 text-table text-muted-foreground">
            Send a restaurant a link to build its own quote. Requests and accepted proposals land here.
          </p>
        </div>
        {canEdit && (
          <Link
            href="/quotes/new"
            className="inline-flex h-9 items-center gap-1 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
          >
            <Plus className="size-4" /> New quote link
          </Link>
        )}
      </div>

      {!summary.isError && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile icon={Link2} label="Active links" value={s?.activeLinks ?? 0} loading={summary.isPending} />
          <StatTile
            icon={Inbox}
            label="Open requests"
            value={s?.requestsOpen ?? 0}
            status={(s?.requestsOpen ?? 0) > 0 ? "waiting on us or the client" : "none open"}
            tone={(s?.requestsOpen ?? 0) > 0 ? "warning" : "ok"}
            loading={summary.isPending}
          />
          <StatTile icon={CircleCheck} label="Accepted (30 days)" value={s?.accepted30d ?? 0} loading={summary.isPending} />
          <StatTile icon={FileText} label="Accepted monthly (30 days)" value={usd(s?.acceptedMonthly30d ?? 0)} loading={summary.isPending} />
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs
          value={tab}
          onValueChange={(v) => {
            setTab(v);
            setPage(1);
          }}
        >
          <TabsList>
            <TabsTrigger value="requests">Requests &amp; proposals</TabsTrigger>
            <TabsTrigger value="links">Links</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative w-full max-w-[280px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            placeholder="Search restaurant, contact or number…"
            aria-label="Search quotes"
            className="h-7 w-full rounded-sm border border-border bg-background pl-8 pr-3 text-xs font-medium leading-4 text-foreground placeholder:font-normal placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent"
          />
        </div>
      </div>

      {tab === "requests" ? (
        <div>
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quote</TableHead>
                  <TableHead>Restaurant</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Prices</TableHead>
                  <TableHead className="text-right">One-time</TableHead>
                  <TableHead className="text-right">Monthly</TableHead>
                  <TableHead>Received</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {requests.isPending ? (
                  <TableMessageRow colSpan={7}>Loading…</TableMessageRow>
                ) : requests.isError ? (
                  <TableMessageRow colSpan={7}>Couldn&apos;t load requests: {requests.error.messages.join(" · ")}</TableMessageRow>
                ) : !requests.data?.data.length ? (
                  <TableMessageRow colSpan={7}>{q ? "Nothing matches." : "No requests yet. Send a quote link to get started."}</TableMessageRow>
                ) : (
                  requests.data.data.map((r) => (
                    <TableRow key={r.id} interactive onClick={() => router.push(`/quotes/requests/${r.id}`)}>
                      <TableCell className="font-medium tabular-nums">{r.number}</TableCell>
                      <TableCell>
                        <div className="font-medium text-foreground">{r.restaurantName}</div>
                        <div className="text-xs text-muted-foreground">{r.contactName}</div>
                      </TableCell>
                      <TableCell>
                        <Badge tone={REQUEST_STATUS_TONE[r.status]}>{REQUEST_STATUS_LABEL[r.status]}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{MODE_LABEL[r.mode]}</TableCell>
                      <TableCell align="right" className="tabular-nums">{usd(r.totals.oneTime)}</TableCell>
                      <TableCell align="right" className="tabular-nums">{usd(r.totals.monthly)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatDate(r.createdAt)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>
          {requests.data?.meta && requests.data.data.length > 0 && <MerchantPagination meta={requests.data.meta} onPageChange={setPage} />}
        </div>
      ) : (
        <div>
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Restaurant</TableHead>
                  <TableHead>Prices</TableHead>
                  <TableHead>Link</TableHead>
                  <TableHead className="text-right">Opened</TableHead>
                  <TableHead className="text-right">Requests</TableHead>
                  <TableHead>Sent by</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {links.isPending ? (
                  <TableMessageRow colSpan={7}>Loading…</TableMessageRow>
                ) : links.isError ? (
                  <TableMessageRow colSpan={7}>Couldn&apos;t load links: {links.error.messages.join(" · ")}</TableMessageRow>
                ) : !links.data?.data.length ? (
                  <TableMessageRow colSpan={7}>{q ? "Nothing matches." : "No links yet."}</TableMessageRow>
                ) : (
                  links.data.data.map((l) => {
                    const st = linkState(l);
                    return (
                      <TableRow key={l.id} interactive onClick={() => router.push(`/quotes/links/${l.id}`)}>
                        <TableCell>
                          <div className="font-medium text-foreground">{l.restaurantName}</div>
                          <div className="text-xs text-muted-foreground">{l.contactName ?? l.contactEmail ?? "—"}</div>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {MODE_LABEL[l.mode]}
                          {(Number(l.discountPercent) > 0 || l.items.some((i) => !i.hidden)) && " · special pricing"}
                        </TableCell>
                        <TableCell>
                          <Badge tone={st.tone}>{st.label}</Badge>
                        </TableCell>
                        <TableCell align="right" className="tabular-nums">{l.openCount}</TableCell>
                        <TableCell align="right" className="tabular-nums">{l.requestCount}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{l.createdByEmail}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{formatDate(l.createdAt)}</TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </Card>
          {links.data?.meta && links.data.data.length > 0 && <MerchantPagination meta={links.data.meta} onPageChange={setPage} />}
        </div>
      )}
    </div>
  );
}
