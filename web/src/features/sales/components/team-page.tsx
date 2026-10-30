"use client";

import { useRouter } from "next/navigation";
import { ShieldAlert, UsersRound } from "lucide-react";
import {
  Badge,
  Card,
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
import { useTeam } from "../queries";
import { SalesPageHeader, useSalesContext } from "./sales-shell";

/** /sales/team — managers: everyone's workload side by side. */
export function TeamPage() {
  const { me, setOwnerId } = useSalesContext();
  const router = useRouter();
  const { data, isPending, isError, error, refetch } = useTeam({ enabled: me.seeAll });

  if (!me.seeAll) {
    return (
      <Card>
        <EmptyState icon={ShieldAlert} title="Managers only" description="The Team view is for Sales Managers and Admins." />
      </Card>
    );
  }

  const rows = data ?? [];
  return (
    <div>
      <SalesPageHeader
        title="Sales team"
        description="Each salesperson and field engineer with records in Salesforce. Click a name to see just their work."
        showOwnerPicker={false}
      />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead align="right">Open deals</TableHead>
            <TableHead align="right">Stale</TableHead>
            <TableHead align="right">New deals (30d)</TableHead>
            <TableHead align="right">Won (all time)</TableHead>
            <TableHead align="right">Visits to do</TableHead>
            <TableHead align="right">Visits done (30d)</TableHead>
            <TableHead align="right">Open cases handled</TableHead>
            <TableHead>Last Salesforce login</TableHead>
            <TableHead>SuperApp login</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isPending &&
            Array.from({ length: 5 }).map((_, i) => (
              <TableRow key={i}>
                <TableCell colSpan={10}>
                  <Skeleton className="h-5 w-full" />
                </TableCell>
              </TableRow>
            ))}
          {isError && (
            <TableMessageRow colSpan={10}>
              <ErrorState error={error} onRetry={() => refetch()} />
            </TableMessageRow>
          )}
          {!isPending && !isError && rows.length === 0 && (
            <TableMessageRow colSpan={10}>
              <EmptyState icon={UsersRound} title="No one yet" description="People appear here after the first sync." />
            </TableMessageRow>
          )}
          {rows.map((t) => (
            <TableRow key={t.sfUserId}>
              <TableCell className="whitespace-nowrap font-medium">
                {/* The "Showing" picker lists deal and visit owners only; someone who only handles cases can't be picked. */}
                {t.openDeals + t.staleDeals + t.wonDeals + t.dealsCreated30d + t.visitsPending + t.visitsCompleted30d > 0 ? (
                  <button
                    type="button"
                    className="hover:underline"
                    onClick={() => {
                      setOwnerId(t.sfUserId);
                      router.push("/sales");
                    }}
                    title="Open My Day showing only their records"
                  >
                    {t.name}
                  </button>
                ) : (
                  t.name
                )}
                {!t.isActive && (
                  <Badge tone="neutral" icon={false} className="ml-2">
                    Inactive
                  </Badge>
                )}
              </TableCell>
              <TableCell align="right">{t.openDeals}</TableCell>
              <TableCell align="right" className={t.staleDeals > 0 ? "text-text-destructive" : undefined}>
                {t.staleDeals}
              </TableCell>
              <TableCell align="right">{t.dealsCreated30d}</TableCell>
              <TableCell align="right">{t.wonDeals}</TableCell>
              <TableCell align="right">{t.visitsPending}</TableCell>
              <TableCell align="right">{t.visitsCompleted30d}</TableCell>
              <TableCell align="right">{t.openCases}</TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(t.lastSalesforceLogin)}</TableCell>
              <TableCell className="max-w-[220px] truncate">
                {t.superappUserEmail ?? <span className="text-muted-foreground">None</span>}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
