"use client";

import { useEffect, useState } from "react";
import { Archive, ArchiveRestore, EyeOff } from "lucide-react";
import { Button, Card, Field, Input, useToast } from "@/components/ui";
import { useUpdateAccount } from "../api";
import { fmtDay, fmtMoney } from "../lib";
import type { AccountDetail } from "../types";
import { Section } from "./parts";

/** The two inputs behind "Avg ticket" (the sheet's Total Sales and No of
 *  Orders, from Innowi Online Ordering) and the account's state. */
export function AccountSettings({ account: d, canManage }: { account: AccountDetail; canManage: boolean }) {
  const update = useUpdateAccount(d.id);
  const { toast } = useToast();
  const [sales, setSales] = useState(d.ticketInputs.totalSales?.toString() ?? "");
  const [orders, setOrders] = useState(d.ticketInputs.orderCount?.toString() ?? "");
  useEffect(() => {
    setSales(d.ticketInputs.totalSales?.toString() ?? "");
    setOrders(d.ticketInputs.orderCount?.toString() ?? "");
  }, [d.ticketInputs.totalSales, d.ticketInputs.orderCount]);
  const s = Number(sales);
  const o = Number(orders);
  const preview = sales && orders && s > 0 && o > 0 ? s / o : null;
  const dirty = sales !== (d.ticketInputs.totalSales?.toString() ?? "") || orders !== (d.ticketInputs.orderCount?.toString() ?? "");
  const fail = (e: { message: string; messages?: string[] }) => toast({ variant: "error", title: "Couldn't save", description: e.messages?.[0] ?? e.message });

  return (
    <Section title="Average ticket size">
      <Card className="flex flex-col gap-3 p-4">
        <p className="text-xs text-muted-foreground">
          Revenue = orders × average ticket. Average ticket = total online sales ÷ number of orders from Innowi Online Ordering — the same two numbers the old sheet
          held per account.
        </p>
        <form
          className="grid grid-cols-2 gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            update.mutate(
              { ticketTotalSales: sales ? s : null, ticketOrderCount: orders ? Math.round(o) : null },
              { onSuccess: () => toast({ variant: "success", title: "Average ticket updated" }), onError: fail },
            );
          }}
        >
          <Field label="Total sales ($)" htmlFor="ticket-sales">
            <Input id="ticket-sales" type="number" min={0} step="0.01" value={sales} disabled={!canManage} onChange={(e) => setSales(e.target.value)} />
          </Field>
          <Field label="Number of orders" htmlFor="ticket-orders">
            <Input id="ticket-orders" type="number" min={0} step="1" value={orders} disabled={!canManage} onChange={(e) => setOrders(e.target.value)} />
          </Field>
          <div className="col-span-2 flex items-center justify-between gap-2">
            <span className="text-sm">
              Avg ticket: <span className="font-semibold">{preview == null ? "Not set" : fmtMoney(preview)}</span>
              {d.ticketInputs.updatedAt && <span className="ml-1 text-xs text-muted-foreground">· updated {fmtDay(d.ticketInputs.updatedAt.slice(0, 10))}</span>}
            </span>
            {canManage && (
              <Button type="submit" size="sm" disabled={!dirty} loading={update.isPending}>
                Save
              </Button>
            )}
          </div>
        </form>
        {canManage && !d.isDemo && (
          <div className="flex flex-wrap gap-2 border-t border-border pt-3">
            {d.state === "archived" ? (
              <Button size="sm" variant="outline" loading={update.isPending} onClick={() => update.mutate({ state: "active" }, { onError: fail })}>
                <ArchiveRestore className="size-4" />
                Restore to portfolio
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                loading={update.isPending}
                title="Keeps the history; moves the restaurant to the Archived tab"
                onClick={() => update.mutate({ state: "archived" }, { onSuccess: () => toast({ variant: "success", title: "Archived" }), onError: fail })}
              >
                <Archive className="size-4" />
                Archive
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              loading={update.isPending}
              title="Hide this account everywhere and stop syncing it (test accounts, accounts we don't manage)"
              onClick={() => update.mutate({ state: "ignored" }, { onSuccess: () => toast({ variant: "success", title: "Account hidden", description: "Bring it back from Unmapped → Hidden accounts." }), onError: fail })}
            >
              <EyeOff className="size-4" />
              Hide account
            </Button>
          </div>
        )}
        {!canManage && <p className="text-xs text-muted-foreground">Managers can change the ticket inputs and archive accounts.</p>}
      </Card>
    </Section>
  );
}
