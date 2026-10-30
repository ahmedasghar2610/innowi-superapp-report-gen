"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CircleAlert, Store } from "lucide-react";
import { Badge, Button, Dialog, Field, Input, Select, useToast } from "@/components/ui";
import { api, type ApiError } from "@/lib/api/client";
import { queryKeys } from "@/lib/query/query-keys";
import { cn } from "@/lib/utils/cn";
import { MERCHANT_STATUS_LABEL, MERCHANT_STATUS_TONE, STAGE_LABEL } from "../labels";
import { useCreateDeal } from "../queries";
import type { DealDetail, DealStage, MerchantStatus, OrgRef, PersonRef } from "../types";

interface MerchantPick {
  id: string;
  restaurantName: string;
  merchantCode: string | null;
  region: string | null;
  status: MerchantStatus;
  openDeals: number;
}

const START_STAGES: DealStage[] = ["NEW", "DEMO_BOOKED", "DEMO_DONE", "QUOTE_SENT"];

/**
 * Start a deal. Either pick a restaurant that is already a merchant, or type
 * a new one — the merchant is created with the deal (status Prospect), so
 * nothing else in the app needs a "convert lead" step later.
 */
export function NewDealDialog({
  open,
  onClose,
  organizations,
  owners,
  onCreated,
  merchantId,
  merchantName,
}: {
  open: boolean;
  onClose: () => void;
  organizations: OrgRef[];
  owners: PersonRef[];
  onCreated?: (deal: DealDetail) => void;
  /** When opened from a merchant page: that merchant, fixed. */
  merchantId?: string;
  merchantName?: string;
}) {
  const { toast } = useToast();
  const create = useCreateDeal();
  const fixed = !!merchantId;
  const [mode, setMode] = useState<"existing" | "new">(fixed ? "existing" : "new");
  const [picked, setPicked] = useState<MerchantPick | null>(null);
  const [term, setTerm] = useState("");
  const [q, setQ] = useState("");
  const [form, setForm] = useState({ restaurantName: "", region: "", contactName: "", contactEmail: "", contactPhone: "", city: "", state: "" });
  const [organizationId, setOrganizationId] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [stage, setStage] = useState<DealStage>("NEW");
  const [source, setSource] = useState("");
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useQuery<MerchantPick[], ApiError>({
    queryKey: [...queryKeys.deals.all, "merchant-search", q],
    queryFn: () => api.get<MerchantPick[]>("/deals/merchant-search", { q }),
    enabled: open && mode === "existing" && !fixed && q.trim().length >= 2,
  });

  useEffect(() => {
    if (!open) return;
    setMode(fixed ? "existing" : "new");
    setPicked(null);
    setTerm("");
    setQ("");
    setForm({ restaurantName: "", region: "", contactName: "", contactEmail: "", contactPhone: "", city: "", state: "" });
    setOrganizationId("");
    setOwnerId("");
    setStage("NEW");
    setSource("");
    setError(null);
  }, [open, fixed]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const onTerm = (v: string) => {
    setTerm(v);
    setPicked(null);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setQ(v.trim()), 250);
  };
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  const submit = () => {
    setError(null);
    const existingId = fixed ? merchantId : picked?.id;
    if (mode === "existing" && !existingId) return setError("Pick a restaurant from the search results, or switch to “New restaurant”.");
    if (mode === "new" && !form.restaurantName.trim()) return setError("Add the restaurant's name.");
    create.mutate(
      {
        merchantId: mode === "existing" ? existingId : undefined,
        newMerchant:
          mode === "new"
            ? {
                restaurantName: form.restaurantName.trim(),
                region: form.region.trim() || undefined,
                contactName: form.contactName.trim() || undefined,
                contactEmail: form.contactEmail.trim() || undefined,
                contactPhone: form.contactPhone.trim() || undefined,
                city: form.city.trim() || undefined,
                state: form.state.trim() || undefined,
              }
            : undefined,
        organizationId: organizationId || undefined,
        ownerId: ownerId || undefined,
        stage,
        source: source.trim() || undefined,
      },
      {
        onSuccess: (deal) => {
          toast({ variant: "success", title: `${deal.key} created`, description: mode === "new" ? `${deal.restaurantName} is a prospect merchant now.` : deal.restaurantName });
          onClose();
          onCreated?.(deal);
        },
        onError: (err) => setError(err.messages.join(" · ")),
      },
    );
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New deal"
      description={fixed ? `A new deal for ${merchantName ?? "this merchant"}.` : "A restaurant we are trying to win. New restaurants become a prospect merchant right away."}
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="default" size="sm" onClick={submit} loading={create.isPending} data-testid="create-deal">
            Create deal
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {!fixed ? (
          <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Restaurant">
            {(
              [
                { value: "new", title: "New restaurant", body: "Not a merchant yet — we create it as a prospect." },
                { value: "existing", title: "Existing merchant", body: "Already in the app (a churned or paused account, say)." },
              ] as const
            ).map((m) => (
              <button
                key={m.value}
                type="button"
                role="radio"
                aria-checked={mode === m.value}
                onClick={() => setMode(m.value)}
                className={cn(
                  "flex flex-col items-start rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent",
                  mode === m.value ? "border-primary bg-primary-subtle" : "border-border hover:bg-secondary",
                )}
              >
                <span className="text-sm font-semibold text-foreground">{m.title}</span>
                <span className="text-xs text-muted-foreground">{m.body}</span>
              </button>
            ))}
          </div>
        ) : null}

        {mode === "existing" && !fixed ? (
          <div className="flex flex-col gap-2">
            <Field label="Find the merchant" htmlFor="nd-search">
              <Input id="nd-search" value={term} onChange={(e) => onTerm(e.target.value)} placeholder="Restaurant name or merchant code" autoComplete="off" />
            </Field>
            {picked ? (
              <p className="flex items-center gap-2 rounded-md border border-primary bg-primary-subtle px-3 py-2 text-sm text-foreground">
                <Store className="size-4" /> {picked.restaurantName}
                <Badge tone={MERCHANT_STATUS_TONE[picked.status]} icon={false}>
                  {MERCHANT_STATUS_LABEL[picked.status]}
                </Badge>
              </p>
            ) : q.trim().length >= 2 ? (
              search.isPending ? (
                <p className="text-xs text-muted-foreground">Searching…</p>
              ) : (search.data ?? []).length === 0 ? (
                <p className="text-xs text-muted-foreground">No merchant matches — switch to “New restaurant” to add one.</p>
              ) : (
                <ul className="max-h-48 overflow-y-auto rounded-md border border-border" data-testid="merchant-results">
                  {(search.data ?? []).map((m) => (
                    <li key={m.id}>
                      <button type="button" onClick={() => setPicked(m)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent">
                        <span className="min-w-0 flex-1 truncate text-foreground">{m.restaurantName}</span>
                        <span className="text-xs text-muted-foreground">{[m.merchantCode, m.region].filter(Boolean).join(" · ")}</span>
                        <Badge tone={MERCHANT_STATUS_TONE[m.status]} icon={false}>
                          {MERCHANT_STATUS_LABEL[m.status]}
                        </Badge>
                        {m.openDeals > 0 ? <span className="text-xs text-text-destructive">{m.openDeals} open</span> : null}
                      </button>
                    </li>
                  ))}
                </ul>
              )
            ) : null}
          </div>
        ) : null}

        {mode === "new" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Restaurant" htmlFor="nd-rest" required className="sm:col-span-2">
              <Input id="nd-rest" value={form.restaurantName} onChange={set("restaurantName")} required />
            </Field>
            <Field label="Region" htmlFor="nd-region" hint="e.g. Bay Area, NY, LA">
              <Input id="nd-region" value={form.region} onChange={set("region")} />
            </Field>
            <Field label="City, state" htmlFor="nd-city">
              <div className="flex gap-2">
                <Input id="nd-city" value={form.city} onChange={set("city")} placeholder="City" />
                <Input value={form.state} onChange={set("state")} placeholder="CA" className="w-20" aria-label="State" />
              </div>
            </Field>
            <Field label="Contact name" htmlFor="nd-name">
              <Input id="nd-name" value={form.contactName} onChange={set("contactName")} />
            </Field>
            <Field label="Contact e-mail or phone" htmlFor="nd-email">
              <div className="flex gap-2">
                <Input id="nd-email" type="email" value={form.contactEmail} onChange={set("contactEmail")} placeholder="E-mail" />
                <Input type="tel" value={form.contactPhone} onChange={set("contactPhone")} placeholder="Phone" aria-label="Contact phone" />
              </div>
            </Field>
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Starting stage" htmlFor="nd-stage">
            <Select id="nd-stage" value={stage} onChange={(e) => setStage(e.target.value as DealStage)}>
              {START_STAGES.map((s) => (
                <option key={s} value={s}>
                  {STAGE_LABEL[s]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Owner" htmlFor="nd-owner" hint="Defaults to you">
            <Select id="nd-owner" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
              <option value="">Me</option>
              {owners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Partner organization" htmlFor="nd-org">
            <Select id="nd-org" value={organizationId} onChange={(e) => setOrganizationId(e.target.value)}>
              <option value="">None (direct)</option>
              {organizations
                .filter((o) => o.kind !== "CONTRACTOR")
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="Source" htmlFor="nd-source" hint="Referral, event, website, cold call…">
            <Input id="nd-source" value={source} onChange={(e) => setSource(e.target.value)} />
          </Field>
        </div>

        {error ? (
          <p className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-text-destructive" role="alert">
            <CircleAlert className="mt-0.5 size-4 shrink-0" />
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
