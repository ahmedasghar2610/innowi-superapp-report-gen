"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { Button, Card, CardBody, EmptyState, ErrorState, Field, Input, Select, Skeleton, Textarea, useToast } from "@/components/ui";
import { useAuth } from "@/features/auth/auth-context";
import { hasCapability } from "@/features/auth/capabilities";
import { useDealList } from "@/features/deals/queries";
import { STAGE_LABEL } from "@/features/deals/labels";
import { cn } from "@/lib/utils/cn";
import { useCreateLink, usePriceList } from "../queries";
import type { LinkCreated, QuoteMode } from "../types";
import { LinkUrlDialog } from "./link-url-dialog";
import { PricingEditor, draftToItems, type PricingDraft } from "./pricing-editor";

const MODES: { value: QuoteMode; title: string; body: string }[] = [
  { value: "SHOW_PRICES", title: "Show prices", body: "They see prices as they build and get a proposal to accept right away." },
  { value: "HIDE_PRICES", title: "Hide prices", body: "They only pick quantities and send a request. You see the priced quote." },
];

/** Route /quotes/new: send a restaurant a build-your-own quote link. */
export function NewLinkPage() {
  const { user } = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const canEdit = hasCapability(user?.role, "quotes.edit");
  const canDiscount = hasCapability(user?.role, "quotes.discount");
  const priceList = usePriceList({ enabled: canEdit });
  const create = useCreateLink();
  const [mode, setMode] = useState<QuoteMode>("SHOW_PRICES");
  const [form, setForm] = useState({ restaurantName: "", contactName: "", contactEmail: "", contactPhone: "", message: "" });
  const [discount, setDiscount] = useState("");
  const [allowLease, setAllowLease] = useState(true);
  const [days, setDays] = useState("30");
  const [draft, setDraft] = useState<PricingDraft>({});
  const [showPricing, setShowPricing] = useState(false);
  const [created, setCreated] = useState<LinkCreated | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Optional: the deal this quote hangs off. Open deals only; ?deal=<id> preselects one.
  const [dealId, setDealId] = useState("");
  const [dealParam, setDealParam] = useState<string | null>(null);
  const openDeals = useDealList({ bucket: "OPEN", limit: 200, sortBy: "updatedAt", order: "desc" }, { enabled: canEdit });
  useEffect(() => {
    setDealParam(new URLSearchParams(window.location.search).get("deal"));
  }, []);
  useEffect(() => {
    if (!dealParam || dealId || !openDeals.data) return;
    const d = openDeals.data.data.find((x) => x.id === dealParam);
    if (d) {
      setDealId(d.id);
      setForm((f) => (f.restaurantName ? f : { ...f, restaurantName: d.restaurantName }));
    }
  }, [dealParam, dealId, openDeals.data]);

  if (user === undefined) return null;
  if (!canEdit) {
    return (
      <Card>
        <EmptyState icon={ShieldAlert} title="No access" description="Sending quote links is for the sales team." />
      </Card>
    );
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!form.restaurantName.trim()) return setError("Add the restaurant's name.");
    const pct = discount.trim() ? Number(discount) : 0;
    if (Number.isNaN(pct) || pct < 0 || pct > 100) return setError("The discount must be between 0 and 100%.");
    create.mutate(
      {
        mode,
        dealId: dealId || undefined,
        restaurantName: form.restaurantName.trim(),
        contactName: form.contactName.trim() || undefined,
        contactEmail: form.contactEmail.trim() || undefined,
        contactPhone: form.contactPhone.trim() || undefined,
        message: form.message.trim() || undefined,
        discountPercent: pct ? String(pct) : "0",
        allowLease,
        expiresInDays: Number(days),
        items: draftToItems(draft),
      },
      {
        onSuccess: (res) => setCreated(res),
        onError: (err) => setError(err.messages.join(" · ")),
      },
    );
  };

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [k]: e.target.value });
  const items = (priceList.data ?? []).filter((i) => i.active);

  return (
    <form onSubmit={submit} className="flex max-w-4xl flex-col gap-5">
      <div>
        <Link href="/quotes" className="inline-flex items-center gap-1 text-table text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Quotes
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-[-0.011em] text-foreground">New quote link</h1>
        <p className="mt-1 text-table text-muted-foreground">
          The restaurant opens the link, picks what they need and sends it back. No login for them.
        </p>
      </div>

      <Card>
        <CardBody className="flex flex-col gap-4">
          <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Pricing on the link">
            {MODES.map((m) => (
              <button
                key={m.value}
                type="button"
                role="radio"
                aria-checked={mode === m.value}
                onClick={() => setMode(m.value)}
                className={cn(
                  "flex flex-col items-start justify-start rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent",
                  mode === m.value ? "border-primary bg-primary-subtle" : "border-border hover:bg-secondary",
                )}
              >
                <div className="text-sm font-semibold text-foreground">{m.title}</div>
                <div className="text-xs text-muted-foreground">{m.body}</div>
              </button>
            ))}
          </div>
          <Field label="Deal" htmlFor="nl-deal" hint="Optional. When the restaurant signs, the deal moves to Order form signed and takes the totals.">
            <Select
              id="nl-deal"
              value={dealId}
              onChange={(e) => {
                const id = e.target.value;
                setDealId(id);
                const d = openDeals.data?.data.find((x) => x.id === id);
                if (d && !form.restaurantName) setForm({ ...form, restaurantName: d.restaurantName });
              }}
            >
              <option value="">No deal</option>
              {(openDeals.data?.data ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.key} · {d.restaurantName} · {STAGE_LABEL[d.stage]}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Restaurant" htmlFor="nl-rest" required>
              <Input id="nl-rest" value={form.restaurantName} onChange={set("restaurantName")} required />
            </Field>
            <Field label="Contact name" htmlFor="nl-name">
              <Input id="nl-name" value={form.contactName} onChange={set("contactName")} />
            </Field>
            <Field label="Contact e-mail" htmlFor="nl-email">
              <Input id="nl-email" type="email" value={form.contactEmail} onChange={set("contactEmail")} />
            </Field>
            <Field label="Contact phone" htmlFor="nl-phone">
              <Input id="nl-phone" type="tel" value={form.contactPhone} onChange={set("contactPhone")} />
            </Field>
          </div>
          <Field label="Message on their page" htmlFor="nl-msg" hint="Optional, e.g. a short hello or what you discussed">
            <Textarea id="nl-msg" rows={3} value={form.message} onChange={set("message")} />
          </Field>
          <div className="flex flex-wrap items-end gap-4">
            <Field label="Link works for" htmlFor="nl-days">
              <Select id="nl-days" value={days} onChange={(e) => setDays(e.target.value)} className="w-[150px]">
                {["7", "14", "30", "60", "90"].map((d) => (
                  <option key={d} value={d}>
                    {d} days
                  </option>
                ))}
              </Select>
            </Field>
            <label className="flex h-8 items-center gap-2 text-sm text-foreground">
              <input type="checkbox" className="size-4" checked={allowLease} onChange={(e) => setAllowLease(e.target.checked)} />
              Offer the 36-month hardware lease
            </label>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-sm font-semibold text-foreground">Special pricing</div>
              <p className="text-xs text-muted-foreground">
                {canDiscount
                  ? "Leave empty for list price. A custom price wins over % off, which wins over the discount on everything."
                  : "Only managers can give special pricing. You can still hide items from this client's page."}
              </p>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => setShowPricing((s) => !s)}>
              {showPricing ? "Hide item list" : "Set per item"}
            </Button>
          </div>
          {canDiscount && (
            <Field label="Discount on everything (%)" htmlFor="nl-disc">
              <Input id="nl-disc" inputMode="decimal" placeholder="0" className="w-[120px]" value={discount} onChange={(e) => setDiscount(e.target.value.replace(/[^\d.]/g, ""))} />
            </Field>
          )}
          {showPricing &&
            (priceList.isPending ? (
              <Skeleton className="h-40" />
            ) : priceList.isError ? (
              <ErrorState error={priceList.error} onRetry={() => priceList.refetch()} />
            ) : (
              <PricingEditor items={items} draft={draft} onChange={setDraft} canDiscount={canDiscount} />
            ))}
        </CardBody>
      </Card>

      {error && (
        <p role="alert" className="rounded-lg bg-destructive-subtle px-3 py-2 text-table text-text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button variant="default" type="submit" size="lg" loading={create.isPending}>
          Create link
        </Button>
        <Button type="button" size="lg" variant="outline" onClick={() => router.push("/quotes")}>
          Cancel
        </Button>
      </div>

      {created && (
        <LinkUrlDialog
          link={created.link}
          url={created.url}
          onClose={() => {
            toast({ variant: "success", title: "Quote link created" });
            router.push(`/quotes/links/${created.link.id}`);
          }}
        />
      )}
    </form>
  );
}
