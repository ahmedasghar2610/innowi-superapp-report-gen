"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import { Button, Card, EmptyState, ErrorState, Input, Skeleton, useToast } from "@/components/ui";
import { useAuth } from "@/features/auth/auth-context";
import { hasCapability } from "@/features/auth/capabilities";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils/cn";
import { SECTION_LABEL } from "../format";
import { usePriceList, useUpdatePriceItem } from "../queries";
import type { PriceItem, PriceItemUpdate } from "../types";

type Field = "purchasePrice" | "leasePrice" | "monthlyPrice";
const FIELDS: { key: Field; label: string }[] = [
  { key: "purchasePrice", label: "Buy / one-time" },
  { key: "leasePrice", label: "Lease /mo" },
  { key: "monthlyPrice", label: "Monthly" },
];

const norm = (v?: string | null) => (v == null || v === "" ? "" : Number(v).toFixed(2));

function Row({ item }: { item: PriceItem }) {
  const { toast } = useToast();
  const update = useUpdatePriceItem();
  const [draft, setDraft] = useState<Record<Field, string>>({
    purchasePrice: norm(item.purchasePrice),
    leasePrice: norm(item.leasePrice),
    monthlyPrice: norm(item.monthlyPrice),
  });
  const dirty = FIELDS.some((f) => norm(draft[f.key]) !== norm(item[f.key]));

  const save = () => {
    const input: PriceItemUpdate = { clear: [] };
    for (const f of FIELDS) {
      if (norm(draft[f.key]) === norm(item[f.key])) continue;
      if (draft[f.key] === "") input.clear!.push(f.key);
      else input[f.key] = draft[f.key];
    }
    update.mutate(
      { id: item.id, input },
      {
        onSuccess: () => toast({ variant: "success", title: `${item.name} updated`, description: "New quotes use it; sent proposals keep their prices." }),
        onError: (e) => toast({ variant: "error", title: "Couldn't save", description: e.messages.join(" · ") }),
      },
    );
  };

  return (
    <tr className={cn(!item.active && "opacity-50")}>
      <td className="px-3 py-2 align-top">
        <div className="font-medium text-foreground">{item.name}</div>
        <div className="text-[11px] text-muted-foreground">
          {item.sku}
          {item.description ? ` · ${item.description}` : ""}
          {!item.selectable ? " · pricing rule" : ""}
        </div>
      </td>
      {FIELDS.map((f) => (
        <td key={f.key} className="px-2 py-2 text-right">
          <Input
            className="ml-auto h-7 w-24 text-right text-xs tabular-nums"
            inputMode="decimal"
            placeholder="—"
            aria-label={`${item.name} ${f.label}`}
            value={draft[f.key]}
            onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value.replace(/[^\d.]/g, "") })}
          />
        </td>
      ))}
      <td className="px-2 py-2 text-center">
        <input
          type="checkbox"
          className="size-4"
          aria-label={`${item.name} offered`}
          checked={item.active}
          disabled={update.isPending || !item.selectable}
          title={item.selectable ? undefined : "A pricing rule is always on. Change its price instead."}
          onChange={(e) => update.mutate({ id: item.id, input: { active: e.target.checked } })}
        />
      </td>
      <td className="px-2 py-2 text-right">
        <Button size="sm" variant={dirty ? "default" : "ghost"} disabled={!dirty} loading={update.isPending} onClick={save}>
          Save
        </Button>
      </td>
    </tr>
  );
}

/** Route /quotes/price-list: the prices every quote starts from (admins). */
export function PriceListPage() {
  const { user } = useAuth();
  const canEdit = hasCapability(user?.role, "quotes.pricing");
  const list = usePriceList({ enabled: canEdit });

  if (user === undefined) return null;
  if (!canEdit) {
    return (
      <Card>
        <EmptyState icon={ShieldAlert} title="No access" description="Only admins can change the price list." />
      </Card>
    );
  }
  if (list.isPending) return <Skeleton className="h-96" />;
  if (list.isError) return <ErrorState error={list.error} onRetry={() => list.refetch()} />;
  const sections = Array.from(new Set(list.data.map((i) => i.section)));
  const last = list.data.reduce((a, i) => (i.updatedAt > a ? i.updatedAt : a), "");

  return (
    <div className="flex max-w-5xl flex-col gap-5">
      <div>
        <Link href="/quotes" className="inline-flex items-center gap-1 text-table text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Quotes
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-[-0.011em] text-foreground">Price list</h1>
        <p className="mt-1 text-table text-muted-foreground">
          List prices per location, from Innowi&apos;s price sheet. Every quote starts here; special pricing is set per link. Changes apply to new
          quotes only. Last change {formatDate(last)}. Untick an item to stop offering it.
        </p>
      </div>
      {sections.map((sec) => (
        <Card key={sec} className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-table">
            <thead className="bg-muted/60 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-semibold">{SECTION_LABEL[sec] ?? sec}</th>
                {FIELDS.map((f) => (
                  <th key={f.key} className="w-28 px-2 py-2 text-right font-semibold">
                    {f.label}
                  </th>
                ))}
                <th className="w-20 px-2 py-2 text-center font-semibold">Offered</th>
                <th className="w-20 px-2 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {list.data
                .filter((i) => i.section === sec)
                .map((i) => (
                  <Row key={`${i.id}-${i.updatedAt}`} item={i} />
                ))}
            </tbody>
          </table>
        </Card>
      ))}
    </div>
  );
}
