"use client";

import { EyeOff } from "lucide-react";
import { Input } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import { SECTION_LABEL, usd } from "../format";
import type { LinkItem, PriceItem } from "../types";

export type PricingDraft = Record<string, LinkItem>;

const priceFields = (it: PriceItem) =>
  [
    it.purchasePrice != null && { key: "purchasePrice" as const, label: it.kind === "SERVICE" ? "One-time" : "Buy", list: it.purchasePrice },
    it.leasePrice != null && { key: "leasePrice" as const, label: "Lease /mo", list: it.leasePrice },
    it.monthlyPrice != null && { key: "monthlyPrice" as const, label: it.kind === "DEVICE" ? "Software /mo" : "/mo", list: it.monthlyPrice },
  ].filter(Boolean) as { key: "purchasePrice" | "leasePrice" | "monthlyPrice"; label: string; list: string }[];

/** Drop rows with nothing special, so only real overrides are sent. */
export function draftToItems(draft: PricingDraft): LinkItem[] {
  return Object.values(draft)
    .map((d) => ({
      itemId: d.itemId,
      percentOff: d.percentOff || null,
      monthlyPrice: d.monthlyPrice || null,
      purchasePrice: d.purchasePrice || null,
      leasePrice: d.leasePrice || null,
      hidden: !!d.hidden,
    }))
    .filter((d) => d.hidden || d.percentOff || d.monthlyPrice || d.purchasePrice || d.leasePrice);
}

export function itemsToDraft(items: LinkItem[]): PricingDraft {
  return Object.fromEntries(items.map((i) => [i.itemId, { ...i }]));
}

/**
 * Per-item special pricing for one link: a custom price per field, or % off,
 * and "hide" to leave an item off this client's page. Empty = list price.
 * Without `canDiscount` only the hide column is editable.
 */
export function PricingEditor({
  items,
  draft,
  onChange,
  canDiscount,
  readOnly = false,
}: {
  items: PriceItem[];
  draft: PricingDraft;
  onChange: (next: PricingDraft) => void;
  canDiscount: boolean;
  /** Show only: no field can change. */
  readOnly?: boolean;
}) {
  const priceLocked = readOnly || !canDiscount;
  const set = (id: string, patch: Partial<LinkItem>) => onChange({ ...draft, [id]: { ...(draft[id] ?? { itemId: id }), ...patch } });
  const sections = Array.from(new Set(items.map((i) => i.section)));
  const money = "h-7 w-24 text-right text-xs tabular-nums";

  return (
    <div className="flex flex-col gap-4">
      {sections.map((sec) => (
        <div key={sec}>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-primary">{SECTION_LABEL[sec] ?? sec}</div>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[640px] text-table">
              <thead className="bg-muted/60 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-1.5 font-semibold">Item</th>
                  <th className="px-3 py-1.5 font-semibold">List price → special price</th>
                  <th className="w-24 px-3 py-1.5 text-right font-semibold">% off</th>
                  <th className="w-16 px-3 py-1.5 text-center font-semibold">Hide</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {items
                  .filter((i) => i.section === sec)
                  .map((it) => {
                    const d = draft[it.id];
                    return (
                      <tr key={it.id} className={cn(d?.hidden && "opacity-50")}>
                        <td className="px-3 py-2 align-top">
                          <div className="font-medium text-foreground">{it.name}</div>
                          {!it.selectable && <div className="text-[11px] text-muted-foreground">Pricing rule (applied automatically)</div>}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                            {priceFields(it).map((f) => (
                              <label key={f.key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                <span className="w-24 whitespace-nowrap">{f.label}</span>
                                <span className="w-16 text-right tabular-nums">{usd(f.list)}</span>
                                <span aria-hidden>→</span>
                                <Input
                                  className={money}
                                  inputMode="decimal"
                                  placeholder="list"
                                  aria-label={`${it.name} special ${f.label} price`}
                                  disabled={priceLocked}
                                  value={d?.[f.key] ?? ""}
                                  onChange={(e) => set(it.id, { [f.key]: e.target.value.replace(/[^\d.]/g, "") })}
                                />
                              </label>
                            ))}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Input
                            className="ml-auto h-7 w-16 text-right text-xs"
                            inputMode="decimal"
                            placeholder="0"
                            aria-label={`${it.name} percent off`}
                            disabled={priceLocked}
                            value={d?.percentOff ?? ""}
                            onChange={(e) => set(it.id, { percentOff: e.target.value.replace(/[^\d.]/g, "") })}
                          />
                        </td>
                        <td className="px-3 py-2 text-center">
                          {it.selectable ? (
                            <label className="inline-flex cursor-pointer items-center" title="Leave off this client's page">
                              <input
                                type="checkbox"
                                className="size-4"
                                checked={!!d?.hidden}
                                disabled={readOnly}
                                aria-label={`Hide ${it.name}`}
                                onChange={(e) => set(it.id, { hidden: e.target.checked })}
                              />
                              <EyeOff className="ml-1 size-3.5 text-muted-foreground" aria-hidden />
                            </label>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
