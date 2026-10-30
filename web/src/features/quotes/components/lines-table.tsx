import { cn } from "@/lib/utils/cn";
import { isDiscounted, usd } from "../format";
import type { Line, Totals } from "../types";

const GROUPS: { key: string; title: string; pick: (l: Line) => boolean; totalKey?: keyof Totals }[] = [
  { key: "one-time", title: "One-time", pick: (l) => l.billing === "ONE_TIME", totalKey: "oneTime" },
  { key: "software", title: "Monthly software", pick: (l) => l.billing === "MONTHLY" && l.category === "software", totalKey: "monthlySoftware" },
  { key: "lease", title: "Hardware lease", pick: (l) => l.billing === "MONTHLY" && l.category === "lease", totalKey: "monthlyLease" },
];

/**
 * Priced (or quantities-only) proposal lines, grouped one-time / monthly
 * software / lease. Without `totals` (hidden-price quotes) prices are not shown.
 */
export function LinesTable({ lines, totals, leaseMonths = 36 }: { lines: Line[]; totals?: Totals | null; leaseMonths?: number }) {
  const priced = !!totals;
  return (
    <div className="flex flex-col gap-5">
      {GROUPS.map((g) => {
        const rows = lines.filter(g.pick);
        if (!rows.length) return null;
        return (
          <section key={g.key}>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-primary">
              {g.key === "lease" ? `${g.title} (${leaseMonths} months)` : g.title}
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-sm">
                <thead>
                  <tr className="border-b border-foreground/80 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="py-1.5 pr-2 font-semibold">Item</th>
                    <th className="w-14 py-1.5 pr-4 text-right font-semibold">Qty</th>
                    {priced && <th className="w-36 py-1.5 pr-4 text-right font-semibold">Price</th>}
                    {priced && <th className="w-24 py-1.5 text-right font-semibold">Total</th>}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((l, i) => (
                    <tr key={`${l.sku}-${i}`} className="border-b border-border align-top">
                      <td className="py-2 pr-2">
                        <div className="font-medium text-foreground">{l.name}</div>
                        {l.detail && <div className="text-xs text-muted-foreground">{l.detail}</div>}
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums">{l.qty}</td>
                      {priced && (
                        <td className="whitespace-nowrap py-2 pr-4 text-right tabular-nums">
                          {usd(l.unitPrice)}
                          {l.unitLabel && <span className="ml-1 text-xs text-muted-foreground">{l.unitLabel}</span>}
                          {isDiscounted(l.unitList, l.unitPrice) && (
                            <div className="text-xs text-muted-foreground">
                              <span className="sr-only">List price </span>
                              <span className="line-through">{usd(l.unitList)}</span>
                            </div>
                          )}
                        </td>
                      )}
                      {priced && <td className="whitespace-nowrap py-2 text-right font-semibold tabular-nums">{usd(l.total)}</td>}
                    </tr>
                  ))}
                </tbody>
                {priced && g.totalKey && (
                  <tfoot>
                    <tr>
                      <td className="pt-2 font-semibold" colSpan={3}>
                        {g.key === "one-time" ? "One-time total" : g.key === "software" ? "Monthly software" : "Monthly lease"}
                      </td>
                      <td className={cn("pt-2 text-right font-semibold tabular-nums")}>{usd(totals?.[g.totalKey])}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}
