"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Send } from "lucide-react";
import { Button, Card, CardBody, ErrorState, Field, Skeleton, Textarea, useToast } from "@/components/ui";
import { quotes } from "@/lib/api/resources/quotes";
import { cn } from "@/lib/utils/cn";
import { SECTION_LABEL, usd } from "../format";
import { usePriceList, useQuoteLink, useQuoteRequest, useReviseRequest } from "../queries";
import type { HardwarePlan, Priced, PriceItem } from "../types";
import { QtyStepper } from "./qty-stepper";
import { ChangeList, diffRevisions } from "./revision-trail";
import { TotalsPanel } from "./totals-panel";

const SECTION_ORDER = ["devices", "hardware", "networking", "software", "marketing", "services"];

/** Route /quotes/requests/[id]/revise: build a counter-offer as the request's next revision.

Pricing comes from the request's link (its discount and special prices), so to
change this client's prices, set special pricing on the link first. */
export function RevisePage({ id }: { id: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const req = useQuoteRequest(id);
  const link = useQuoteLink(req.data?.linkId);
  const priceList = usePriceList();
  const revise = useReviseRequest();

  const [qty, setQty] = useState<Record<string, number> | null>(null);
  const [plan, setPlan] = useState<HardwarePlan>("BUY");
  const [note, setNote] = useState("");
  const [reveal, setReveal] = useState(true);
  const [priced, setPriced] = useState<Priced | null>(null);
  const [priceError, setPriceError] = useState<string | null>(null);
  const [pricing, setPricing] = useState(false);
  const seq = useRef(0);

  const items = useMemo(() => {
    const hidden = new Set((link.data?.items ?? []).filter((i) => i.hidden).map((i) => i.itemId));
    return (priceList.data ?? []).filter((i) => i.active && i.selectable && !hidden.has(i.id));
  }, [priceList.data, link.data]);
  const bySku = useMemo(() => new Map(items.map((i) => [i.sku, i])), [items]);

  // Start from the current revision's quantities (derived software lines are skipped).
  useEffect(() => {
    if (qty !== null || !req.data || !priceList.data) return;
    const initial: Record<string, number> = {};
    for (const l of req.data.lines) {
      const item = bySku.get(l.sku);
      if (item) initial[item.id] = Math.max(initial[item.id] ?? 0, l.qty);
    }
    setQty(initial);
    setPlan(req.data.hardwarePlan);
    setReveal(req.data.mode === "HIDE_PRICES" ? true : false);
  }, [req.data, priceList.data, bySku, qty]);

  const selections = useMemo(
    () => Object.entries(qty ?? {}).filter(([, n]) => n > 0).map(([itemId, n]) => ({ itemId, qty: n })),
    [qty],
  );

  // Bundles: the server strips an included item; mirror it here so totals match.
  const selectedSkus = useMemo(() => {
    const byId = new Map(items.map((i) => [i.id, i]));
    return new Set(selections.map((s) => byId.get(s.itemId)?.sku).filter(Boolean) as string[]);
  }, [items, selections]);
  const bundledOut = (it: PriceItem) => !!it.bundledInSku && selectedSkus.has(it.bundledInSku);

  // Live price through the link (same engine the request will use).
  useEffect(() => {
    const linkId = req.data?.linkId;
    if (!linkId || !selections.length) {
      setPriced(null);
      return;
    }
    const n = ++seq.current;
    setPricing(true);
    const t = setTimeout(async () => {
      try {
        const res = await quotes.previewLink(linkId, selections, plan);
        if (n === seq.current) {
          setPriced(res);
          setPriceError(null);
        }
      } catch (e) {
        if (n === seq.current) setPriceError(e instanceof Error ? e.message : "Couldn't price that.");
      } finally {
        if (n === seq.current) setPricing(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [req.data?.linkId, selections, plan]);

  if (req.isPending || priceList.isPending || qty === null) return <Skeleton className="h-64" />;
  if (req.isError) return <ErrorState error={req.error} onRetry={() => req.refetch()} />;
  const r = req.data;
  const changes = priced ? diffRevisions(r.lines, priced.lines) : [];

  const send = () => {
    if (!selections.length) return;
    revise.mutate(
      { id, items: selections, hardwarePlan: plan, note: note.trim() || undefined,
        revealPrices: r.mode === "HIDE_PRICES" ? reveal : undefined },
      {
        onSuccess: () => {
          toast({ variant: "success", title: `Revision sent to ${r.restaurantName}` });
          router.push(`/quotes/requests/${id}`);
        },
        onError: (e) => toast({ variant: "error", title: "Couldn't send", description: e.messages.join(" · ") }),
      },
    );
  };

  const sections = SECTION_ORDER.map((key) => ({ key, items: items.filter((i) => i.section === key) })).filter(
    (s) => s.items.length,
  );

  return (
    <div className="flex max-w-5xl flex-col gap-5">
      <div>
        <Link href={`/quotes/requests/${id}`} className="inline-flex items-center gap-1 text-table text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> {r.number}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-[-0.011em] text-foreground">
          Counter-offer for {r.restaurantName}
        </h1>
        <p className="mt-1 text-table text-muted-foreground">
          This becomes revision {r.currentRevisionNo + 1}. Prices come from the client&apos;s link — to change them,{" "}
          <Link className="underline underline-offset-2" href={`/quotes/links/${r.linkId}`}>
            adjust the link&apos;s special pricing
          </Link>{" "}
          first.
          {(r.status === "SIGNED" || r.status === "ACCEPTED") &&
            " Sending a revision voids the existing signature: everyone signs the new numbers."}
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          <div className="rounded-xl border border-border bg-background p-4">
            <div className="text-sm font-semibold text-foreground">Hardware</div>
            <div className="mt-2 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Hardware plan">
              {(["BUY", "LEASE"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={plan === p}
                  onClick={() => setPlan(p)}
                  className={cn(
                    "rounded-lg border px-3 py-2 text-left text-sm font-medium transition-colors",
                    plan === p ? "border-primary bg-primary-subtle text-primary-subtle-foreground" : "border-border hover:bg-secondary",
                  )}
                >
                  {p === "BUY" ? "Buy outright" : "Lease (36 months)"}
                </button>
              ))}
            </div>
          </div>

          {sections.map((s) => (
            <section key={s.key} className="rounded-xl border border-border bg-background">
              <div className="border-b border-border px-4 py-2.5 text-sm font-semibold text-foreground">
                {SECTION_LABEL[s.key] ?? s.key}
              </div>
              <ul className="divide-y divide-border">
                {s.items.map((it) => (
                  <li key={it.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-foreground">{it.name}</div>
                      {bundledOut(it) ? (
                        <div className="text-xs text-success">Included with {bySku.get(it.bundledInSku!)?.name ?? it.bundledInSku}</div>
                      ) : (
                        <div className="text-xs tabular-nums text-muted-foreground">
                          {it.monthlyPrice != null && `${usd(it.monthlyPrice)}/mo list`}
                          {it.purchasePrice != null && `${it.monthlyPrice != null ? " · " : ""}${usd(it.purchasePrice)} list`}
                        </div>
                      )}
                    </div>
                    {!bundledOut(it) && (
                      <QtyStepper value={qty[it.id] ?? 0} max={it.maxQty} onChange={(n) => setQty((q) => ({ ...(q ?? {}), [it.id]: n }))} label={it.name} />
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-6 lg:self-start">
          <Card>
            <CardBody className="flex flex-col gap-3">
              <div className="text-sm font-semibold text-foreground">This revision</div>
              {priceError && <p className="text-sm text-text-destructive">{priceError}</p>}
              {priced && <TotalsPanel totals={priced.totals} plan={plan} audience="staff" busy={pricing} />}
              {!priced && <p className="text-sm text-muted-foreground">Pick at least one item.</p>}
              {priced && (
                <div>
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Changes vs revision {r.currentRevisionNo}
                  </div>
                  <ChangeList changes={changes} />
                </div>
              )}
              <Field label={`Message to ${r.contactName.split(" ")[0]}`} htmlFor="rev-note" hint="Shown with the revision and in their e-mail">
                <Textarea id="rev-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
              </Field>
              {r.mode === "HIDE_PRICES" && !r.pricesRevealed && (
                <label className="flex items-start gap-2 text-sm text-foreground">
                  <input type="checkbox" className="mt-0.5 size-4 shrink-0" checked={reveal} onChange={(e) => setReveal(e.target.checked)} />
                  Show this request&apos;s prices to the client, so they can review and sign
                </label>
              )}
              <Button variant="default" size="lg" disabled={!selections.length || !!priceError} loading={revise.isPending} onClick={send}>
                <Send className="size-4" /> Send revision
              </Button>
              <p className="text-xs text-muted-foreground">
                {r.contactName} is e-mailed at {r.contactEmail} and reviews it on their existing quote link.
              </p>
            </CardBody>
          </Card>
        </aside>
      </div>
    </div>
  );
}
