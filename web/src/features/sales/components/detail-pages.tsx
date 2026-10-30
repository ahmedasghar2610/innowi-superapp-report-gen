"use client";

import Link from "next/link";
import { ArrowLeft, SearchX, Users } from "lucide-react";
import {
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  ErrorState,
  SectionHead,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableMessageRow,
  TableRow,
} from "@/components/ui";
import { isApiError } from "@/lib/api/client";
import { displayUrl, formatDate, formatUsd } from "@/lib/format";
import { formatDay } from "../format";
import { useCustomer, useDeal } from "../queries";
import { DealStageBadge, HealthBadge, SalesforceLink } from "./sales-badges";
import { useSalesContext } from "./sales-shell";
import { CasesTable, DealsTable, VisitsTable } from "./sales-tables";
import type { Contact, CustomerDetail, Touchpoint } from "../types";

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate text-sm text-foreground">{children ?? "—"}</dd>
    </div>
  );
}

function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="size-4" aria-hidden />
      {label}
    </Link>
  );
}

function DetailError({ error, onRetry, what }: { error: unknown; onRetry: () => void; what: string }) {
  if (isApiError(error) && (error.status === 404 || error.status === 403)) {
    return (
      <Card>
        <EmptyState
          icon={SearchX}
          title={`${what} not found`}
          description={`It may have been deleted in Salesforce, or it isn't one of yours.`}
        />
      </Card>
    );
  }
  return (
    <Card>
      <ErrorState error={error} onRetry={onRetry} />
    </Card>
  );
}

function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-8 w-72" />
      <Skeleton className="h-36 w-full" />
      <Skeleton className="h-48 w-full" />
    </div>
  );
}

/* ------------------------------------------------------------------ deal */

/** /sales/deals/[id] — one opportunity and the restaurant it belongs to. */
export function DealDetailPage({ id }: { id: string }) {
  const { me } = useSalesContext();
  const { data: deal, isPending, isError, error, refetch } = useDeal(id);

  if (isPending) return <DetailSkeleton />;
  if (isError) return <DetailError error={error} onRetry={() => refetch()} what="Deal" />;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <BackLink href="/sales/deals" label="Salesforce deals" />
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-[-0.011em] text-foreground">{deal.name}</h1>
            <div className="mt-1.5">
              <DealStageBadge deal={deal} />
            </div>
          </div>
          <SalesforceLink sobject="Opportunity" id={deal.id} />
        </div>
      </div>

      <Card>
        <CardBody>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Fact label="Amount">{formatUsd(deal.amount)}</Fact>
            <Fact label="Close date">{formatDay(deal.closeDate)}</Fact>
            <Fact label="Owner">{deal.ownerName}</Fact>
            <Fact label="Pipeline column">{deal.columnLabel}</Fact>
            <Fact label="Probability">{deal.probability != null ? `${Number(deal.probability)}%` : "—"}</Fact>
            <Fact label="Lead source">{deal.leadSource}</Fact>
            <Fact label="Type">{deal.recordTypeName}</Fact>
            <Fact label="Created">{formatDate(deal.createdAt)}</Fact>
            <Fact label="Last change in Salesforce">
              {formatDate(deal.lastModifiedAt)}
              {deal.daysSinceChange != null ? ` (${deal.daysSinceChange} days ago)` : ""}
            </Fact>
          </dl>
        </CardBody>
      </Card>

      {deal.customer ? (
        <CustomerSections customer={deal.customer} showOwner={me.seeAll} heading />
      ) : (
        <p className="text-sm text-muted-foreground">
          {deal.accountId
            ? `The restaurant${deal.accountName ? ` (${deal.accountName})` : ""} hasn't been copied from Salesforce yet; its details appear after the next sync.`
            : "This deal isn't linked to a restaurant in Salesforce."}
        </p>
      )}
    </div>
  );
}

/* -------------------------------------------------------------- customer */

/** /sales/customers/[id] — one restaurant: contacts, deals, visits, cases and check-ins. */
export function CustomerDetailPage({ id }: { id: string }) {
  const { me } = useSalesContext();
  const { data: customer, isPending, isError, error, refetch } = useCustomer(id);

  if (isPending) return <DetailSkeleton />;
  if (isError) return <DetailError error={error} onRetry={() => refetch()} what="Restaurant" />;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <BackLink href="/sales/customers" label="Salesforce accounts" />
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-[-0.011em] text-foreground">{customer.name}</h1>
            <div className="mt-1.5">
              <HealthBadge health={customer.health} />
            </div>
          </div>
          <SalesforceLink sobject="Account" id={customer.id} />
        </div>
      </div>
      <CustomerSections customer={customer} showOwner={me.seeAll} />
    </div>
  );
}

function CustomerSections({ customer: c, showOwner, heading }: { customer: CustomerDetail; showOwner: boolean; heading?: boolean }) {
  const address = [c.street, [c.city, c.state].filter(Boolean).join(", "), c.postalCode].filter(Boolean).join(" · ");
  return (
    <>
      <Card>
        {heading && (
          <CardHeader>
            <CardTitle className="text-base">
              <Link href={`/sales/customers/${c.id}`} className="hover:underline">
                {c.name}
              </Link>
            </CardTitle>
            <HealthBadge health={c.health} />
          </CardHeader>
        )}
        <CardBody>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Fact label="Address">{address || "—"}</Fact>
            <Fact label="Phone">{c.phone ? <a href={`tel:${c.phone}`} className="hover:underline">{c.phone}</a> : "—"}</Fact>
            <Fact label="Website">
              {c.website ? (
                <a
                  href={/^https?:\/\//i.test(c.website) ? c.website : `https://${c.website}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:underline"
                >
                  {displayUrl(c.website)}
                </a>
              ) : (
                "—"
              )}
            </Fact>
            <Fact label="Account owner">{c.ownerName}</Fact>
            <Fact label="Open deals">{c.openDeals}</Fact>
            <Fact label="Won deals">{c.wonDeals}</Fact>
            <Fact label="Open cases">{c.openCases}</Fact>
            <Fact label="Last check-in">{formatDay(c.lastTouchpointDate)}</Fact>
          </dl>
        </CardBody>
      </Card>

      <section className="flex flex-col gap-3">
        <SectionHead title="Contacts" as="h2" />
        <ContactsTable contacts={c.contacts} />
      </section>

      {!heading && (
        <section className="flex flex-col gap-3">
          <SectionHead title="Deals" as="h2" />
          <DealsTable deals={c.deals} showOwner={showOwner} emptyTitle="No deals you can see for this restaurant" />
        </section>
      )}

      <section className="flex flex-col gap-3">
        <SectionHead title="Visits" as="h2" />
        <VisitsTable visits={c.visits} showOwner={showOwner} emptyTitle="No visits for this restaurant" />
      </section>

      <section className="flex flex-col gap-3">
        <SectionHead title="Support cases" as="h2" />
        <CasesTable cases={c.cases} emptyTitle="No support cases for this restaurant" />
      </section>

      <section className="flex flex-col gap-3">
        <SectionHead title="Check-ins (Touchpoints)" as="h2" />
        <TouchpointsTable touchpoints={c.touchpoints} />
      </section>
    </>
  );
}

function ContactsTable({ contacts }: { contacts: Contact[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Title</TableHead>
          <TableHead>Email</TableHead>
          <TableHead>Phone</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {contacts.length === 0 && (
          <TableMessageRow colSpan={4}>
            <EmptyState icon={Users} title="No contacts in Salesforce" />
          </TableMessageRow>
        )}
        {contacts.map((p) => {
          const phone = p.phone ?? p.mobilePhone;
          return (
            <TableRow key={p.id}>
              <TableCell className="font-medium">{p.name}</TableCell>
              <TableCell>{p.title ?? "—"}</TableCell>
              <TableCell className="max-w-[240px] truncate">
                {p.email ? (
                  <a href={`mailto:${p.email}`} className="hover:underline">
                    {p.email}
                  </a>
                ) : (
                  "—"
                )}
              </TableCell>
              <TableCell className="whitespace-nowrap">
                {phone ? (
                  <a href={`tel:${phone}`} className="hover:underline">
                    {phone}
                  </a>
                ) : (
                  "—"
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function TouchpointsTable({ touchpoints }: { touchpoints: Touchpoint[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Date</TableHead>
          <TableHead>Health</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>By</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {touchpoints.length === 0 && (
          <TableMessageRow colSpan={4}>
            <EmptyState title="No check-ins recorded" />
          </TableMessageRow>
        )}
        {touchpoints.map((t) => (
          <TableRow key={t.id}>
            <TableCell className="whitespace-nowrap">{formatDay(t.latestTouchpointDate)}</TableCell>
            <TableCell>
              <HealthBadge health={t.healthStatus} />
            </TableCell>
            <TableCell className="max-w-[360px] truncate" title={t.latestStatus ?? undefined}>
              {t.latestStatus ?? "—"}
            </TableCell>
            <TableCell className="whitespace-nowrap">{t.ownerName ?? "—"}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
