"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Info } from "lucide-react";
import { Button, Field, Input, Textarea } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import { QtyStepper } from "../components/qty-stepper";
import { TotalsPanel } from "../components/totals-panel";
import { isDiscounted, usd } from "../format";
import type { HardwarePlan, Priced, PublicItem, PublicOffer, PublicRequest, Selection } from "../types";
import { PublicApiError, publicQuotes } from "./public-api";

function Price({ list, price, suffix }: { list?: string; price?: string; suffix?: string }) {
  if (price == null) return null;
  return (
    <span className="whitespace-nowrap">
      {isDiscounted(list, price) && <span className="mr-1 text-xs text-muted-foreground line-through">{usd(list)}</span>}
      <span className="font-semibold text-foreground">{usd(price)}</span>
      {suffix && <span className="text-xs text-muted-foreground">{suffix}</span>}
    </span>
  );
}

function ItemPrice({ item, plan }: { item: PublicItem; plan: HardwarePlan }) {
  if (item.kind === "SOFTWARE") {
    return <Price list={item.listMonthly} price={item.monthly} suffix={item.unitLabel ? ` /${item.unitLabel}/mo` : "/mo"} />;
  }
  if (item.kind === "SERVICE") return <Price list={item.listPurchase} price={item.purchase} suffix=" one-time" />;
  const lease = plan === "LEASE" && item.lease != null;
  const hw = lease ? (
    <Price list={item.listLease} price={item.lease} suffix="/mo lease" />
  ) : (
    <Price list={item.listPurchase} price={item.purchase} />
  );
  if (item.kind === "HARDWARE") return hw;
  return (
    <span className="flex flex-wrap items-baseline gap-x-1.5">
      {hw}
      <span className="text-xs text-muted-foreground">+</span>
      <Price list={item.listMonthly} price={item.monthly} suffix="/mo software" />
    </span>
  );
}

/**
 * Build-your-own quote: pick quantities, see the price live (price links), then
 * send. On a hidden-price link nothing here shows a price - the API never sends one.
 */
export function Builder({
  token,
  offer,
  initial,
  onSubmitted,
}: {
  token: string;
  offer: PublicOffer;
  initial?: { qty: Record<string, number>; plan: HardwarePlan; counterFor?: string };
  onSubmitted: (r: PublicRequest) => void;
}) {
  const show = offer.showPrices;
  const [qty, setQty] = useState<Record<string, number>>(initial?.qty ?? {});
  const [plan, setPlan] = useState<HardwarePlan>(initial?.plan ?? "BUY");
  const [priced, setPriced] = useState<Priced | null>(null);
  const [pricing, setPricing] = useState(false);
  const [priceError, setPriceError] = useState<string | null>(null);
  const [contact, setContact] = useState({ name: offer.contactName ?? "", email: "", phone: "" });
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const selections: Selection[] = useMemo(
    () => Object.entries(qty).filter(([, n]) => n > 0).map(([itemId, n]) => ({ itemId, qty: n })),
    [qty],
  );
  const count = selections.reduce((s, x) => s + x.qty, 0);

  // Live price (price links only), debounced; the server is the one source of truth.
  useEffect(() => {
    if (!show) return;
    if (!selections.length) {
      setPriced(null);
      setPriceError(null);
      return;
    }
    const n = ++seq.current;
    setPricing(true);
    const t = setTimeout(async () => {
      try {
        const res = await publicQuotes.price(token, selections, plan);
        if (n === seq.current) {
          setPriced(res);
          setPriceError(null);
        }
      } catch (e) {
        if (n === seq.current) setPriceError(e instanceof PublicApiError ? e.message : "Couldn't price that.");
      } finally {
        if (n === seq.current) setPricing(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [show, token, selections, plan]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!selections.length) return setError("Pick at least one item first.");
    if (!contact.name.trim() || !contact.email.trim()) return setError("Please add your name and e-mail.");
    setBusy(true);
    try {
      const r = await publicQuotes.submit(token, {
        items: selections,
        hardwarePlan: plan,
        contact: { name: contact.name.trim(), email: contact.email.trim(), phone: contact.phone.trim() || undefined },
        notes: notes.trim() || undefined,
        requestId: initial?.counterFor,
      });
      onSubmitted(r);
    } catch (err) {
      setError(err instanceof PublicApiError ? err.message : "Couldn't send. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const setItem = (id: string, n: number) => setQty((q) => ({ ...q, [id]: n }));
  const hasLeasable = offer.sections.some((s) => s.items.some((i) => i.kind === "DEVICE" || i.kind === "HARDWARE"));

  // Bundles: an item a selected bundle already includes (email/SMS inside the
  // marketing package) can't be added on top. The server strips it too.
  const allItems = useMemo(() => offer.sections.flatMap((s) => s.items), [offer]);
  const selectedSkus = useMemo(
    () => new Set(allItems.filter((i) => (qty[i.id] ?? 0) > 0).map((i) => i.sku)),
    [allItems, qty],
  );
  const bundledOut = (it: PublicItem) => !!it.bundledInSku && selectedSkus.has(it.bundledInSku);
  useEffect(() => {
    // A bundle was just added while its included item was selected: drop the extra.
    const drop = allItems.filter((i) => (qty[i.id] ?? 0) > 0 && bundledOut(i));
    if (drop.length) setQty((q) => ({ ...q, ...Object.fromEntries(drop.map((i) => [i.id, 0])) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSkus]);

  return (
    <form onSubmit={submit} className={cn("grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]", count > 0 && "pb-20 lg:pb-0")}>
      <div className="flex min-w-0 flex-col gap-5">
        {offer.allowLease && hasLeasable && (
          <div className="rounded-xl border border-border bg-background p-4">
            <div className="text-sm font-semibold text-foreground">How would you like the hardware?</div>
            <div className="mt-2 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Hardware plan">
              {(["BUY", "LEASE"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={plan === p}
                  onClick={() => setPlan(p)}
                  className={cn(
                    "flex flex-col items-start justify-start rounded-lg border px-3 py-2.5 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent",
                    plan === p ? "border-primary bg-primary-subtle text-primary-subtle-foreground" : "border-border hover:bg-secondary",
                  )}
                >
                  <div className="font-semibold">{p === "BUY" ? "Buy outright" : `Lease (${offer.leaseMonths} months)`}</div>
                  <div className="text-xs opacity-80">{p === "BUY" ? "One payment at the start" : "Spread over monthly payments"}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {offer.sections.map((s) => (
          <section key={s.key} className="rounded-xl border border-border bg-background">
            <div className="border-b border-border px-4 py-3">
              <h2 className="text-base font-semibold text-foreground">{s.title}</h2>
              {s.blurb && <p className="text-xs text-muted-foreground">{s.blurb}</p>}
              {s.key === "devices" && show && offer.firstStationMonthly && (
                <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                  <Info className="size-3.5" aria-hidden /> Your first station&apos;s software is {usd(offer.firstStationMonthly)}/mo; each
                  additional station is billed at its own price.
                </p>
              )}
            </div>
            <ul className="divide-y divide-border">
              {s.items.map((it) => (
                <li key={it.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="font-medium text-foreground">{it.name}</div>
                    {it.description && <div className="text-xs text-muted-foreground">{it.description}</div>}
                    {it.note && !bundledOut(it) && <div className="text-xs text-muted-foreground">{it.note}</div>}
                    {bundledOut(it) ? (
                      <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-success-subtle px-2 py-0.5 text-xs font-medium text-success-subtle-foreground">
                        <Check className="size-3" aria-hidden /> Included with the {it.bundledInName ?? "selected bundle"}
                      </div>
                    ) : (
                      show && (
                        <div className="mt-1 text-sm">
                          <ItemPrice item={it} plan={plan} />
                        </div>
                      )
                    )}
                  </div>
                  {!bundledOut(it) && (
                    <QtyStepper value={qty[it.id] ?? 0} max={it.maxQty} onChange={(n) => setItem(it.id, n)} label={it.name} />
                  )}
                </li>
              ))}
            </ul>
            {s.key === "devices" && offer.goldIncluded.length > 0 && (
              <div className="border-t border-border bg-muted/50 px-4 py-3">
                <div className="text-xs font-semibold text-foreground">Included with Gold at no extra cost</div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {offer.goldIncluded.map((g) => (
                    <span key={g} className="inline-flex items-center gap-1 rounded-full bg-foreground px-2.5 py-1 text-xs font-medium text-background">
                      <Check className="size-3" aria-hidden /> {g}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </section>
        ))}
      </div>

      <aside id="qb-summary" className="flex scroll-mt-4 flex-col gap-4 lg:sticky lg:top-6 lg:self-start">
        <div className="rounded-xl border border-border bg-background p-4">
          <div className="text-base font-semibold text-foreground">{show ? "Your quote" : "Your selection"}</div>
          {count === 0 ? (
            <p className="mt-1 text-sm text-muted-foreground">Add items on the left to build your setup.</p>
          ) : show ? (
            <>
              {priceError && <p role="alert" className="mt-2 text-sm text-text-destructive">{priceError}</p>}
              {priced && <TotalsPanel className="mt-3" totals={priced.totals} plan={plan} leaseMonths={offer.leaseMonths} busy={pricing} />}
              {!priced && pricing && <p className="mt-2 text-sm text-muted-foreground">Pricing…</p>}
            </>
          ) : (
            <ul className="mt-2 flex flex-col gap-1 text-sm">
              {offer.sections.flatMap((s) => s.items).filter((i) => (qty[i.id] ?? 0) > 0).map((i) => (
                <li key={i.id} className="flex justify-between gap-2">
                  <span className="text-foreground">{i.name}</span>
                  <span className="tabular-nums text-muted-foreground">× {qty[i.id]}</span>
                </li>
              ))}
            </ul>
          )}
          {!show && count > 0 && (
            <p className="mt-3 text-xs text-muted-foreground">Your Innowi contact will send you pricing for this selection.</p>
          )}
        </div>

        <div className="rounded-xl border border-border bg-background p-4">
          <div className="mb-3 text-base font-semibold text-foreground">Your details</div>
          <div className="flex flex-col gap-3">
            <Field label="Your name" htmlFor="qb-name" required>
              <Input id="qb-name" autoComplete="name" value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} required />
            </Field>
            <Field label="E-mail" htmlFor="qb-email" required>
              <Input id="qb-email" type="email" autoComplete="email" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} required />
            </Field>
            <Field label="Phone" htmlFor="qb-phone">
              <Input id="qb-phone" type="tel" autoComplete="tel" value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} />
            </Field>
            <Field label="Anything we should know?" htmlFor="qb-notes">
              <Textarea id="qb-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
            {error && (
              <p role="alert" className="rounded-lg bg-destructive-subtle px-3 py-2 text-sm text-text-destructive">
                {error}
              </p>
            )}
            <Button variant="default" type="submit" size="lg" loading={busy} disabled={count === 0}>
              {initial?.counterFor ? "Send my changes" : show ? "Get my proposal" : "Send my request"}
            </Button>
          </div>
        </div>
      </aside>

      {/* Phones: the summary and send button sit below a long list, so keep a way to them in reach. */}
      {count > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/95 px-4 py-2.5 shadow-lg backdrop-blur lg:hidden">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
            <div className="min-w-0 text-sm">
              <div className="font-semibold text-foreground">
                {count} {count === 1 ? "item" : "items"} selected
              </div>
              {show && priced && (
                <div className="truncate text-xs text-muted-foreground tabular-nums">
                  {usd(priced.totals.oneTime)} at start · {usd(priced.totals.monthly)}/mo
                </div>
              )}
            </div>
            <Button
              variant="default"
              onClick={() => document.getElementById("qb-summary")?.scrollIntoView({ behavior: "smooth", block: "start" })}
            >
              Review &amp; send
            </Button>
          </div>
        </div>
      )}
    </form>
  );
}
