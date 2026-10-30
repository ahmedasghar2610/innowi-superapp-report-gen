"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink, FileText, Link2, Plus } from "lucide-react";
import { Badge, Button, Drawer, ErrorState, Field, Input, Select, Skeleton, Textarea, useToast } from "@/components/ui";
import { useCan } from "@/features/auth/use-can";
import { useQuoteLinks } from "@/features/quotes/queries";
import { formatDateTime } from "@/lib/format";
import {
  DEPLOYED_BY_LABEL,
  EVENT_LABEL,
  HIRED_BY_LABEL,
  MERCHANT_STATUS_LABEL,
  MERCHANT_STATUS_TONE,
  QUOTE_STATUS_LABEL,
  QUOTE_STATUS_TONE,
  STAGE_LABEL,
  STAGE_TONE,
  formatDay,
  fromLocalInput,
  money,
  toLocalInput,
} from "../labels";
import { useAddDealNote, useDealDetail, useLinkQuoteToDeal, useUpdateDeal } from "../queries";
import { ALL_STAGES, type DealDetail, type DealStage, type DeployedBy, type HiredBy, type OrgRef, type PersonRef, type UpdateDealInput } from "../types";

/** One deal: where it is, who owns it, the money, the deployment, its quotes and its history. */
export function DealDrawer({
  dealId,
  owners,
  organizations,
  onClose,
}: {
  dealId: string | null;
  owners: PersonRef[];
  organizations: OrgRef[];
  onClose: () => void;
}) {
  const { data, isPending, isError, error, refetch } = useDealDetail(dealId);
  return (
    <Drawer
      open={!!dealId}
      onClose={onClose}
      title={data ? `${data.key} · ${data.restaurantName}` : "Deal"}
      description={data ? [data.region, data.organization?.name, data.owner ? `owner ${data.owner.name}` : "unassigned"].filter(Boolean).join(" · ") : undefined}
      size="lg"
    >
      {!dealId ? null : isError ? (
        <ErrorState title="Couldn't load this deal" error={error} onRetry={() => refetch()} />
      ) : isPending || !data ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : (
        <DealBody deal={data} owners={owners} organizations={organizations} />
      )}
    </Drawer>
  );
}

function DealBody({ deal, owners, organizations }: { deal: DealDetail; owners: PersonRef[]; organizations: OrgRef[] }) {
  const can = useCan();
  const canManage = can("deals.manage");
  const canOpenMerchant = can("profile.view");
  const canQuote = can("quotes.edit");
  const { toast } = useToast();
  const update = useUpdateDeal();
  const addNote = useAddDealNote();
  const [note, setNote] = useState("");
  const [notes, setNotes] = useState(deal.notes ?? "");
  const [monthly, setMonthly] = useState(deal.amountMonthly ?? "");
  const [oneTime, setOneTime] = useState(deal.amountOneTime ?? "");
  const [demoAt, setDemoAt] = useState(toLocalInput(deal.demoAt));
  const [deployment, setDeployment] = useState(deal.deploymentDate ?? "");
  const [goLive, setGoLive] = useState(deal.goLiveDate ?? "");
  const [lostFor, setLostFor] = useState<string | null>(null);
  const [lostReason, setLostReason] = useState("");
  useEffect(() => {
    setNotes(deal.notes ?? "");
    setMonthly(deal.amountMonthly ?? "");
    setOneTime(deal.amountOneTime ?? "");
    setDemoAt(toLocalInput(deal.demoAt));
    setDeployment(deal.deploymentDate ?? "");
    setGoLive(deal.goLiveDate ?? "");
  }, [deal.id, deal.notes, deal.amountMonthly, deal.amountOneTime, deal.demoAt, deal.deploymentDate, deal.goLiveDate]);

  const save = (input: UpdateDealInput, done: string) =>
    update.mutate(
      { id: deal.id, input },
      {
        onSuccess: () => toast({ variant: "success", title: done }),
        onError: (err) => toast({ variant: "error", title: "Couldn't save", description: err.messages.join(" · ") }),
      },
    );

  const onStage = (stage: DealStage) => {
    if (stage === deal.stage) return;
    if (stage === "LOST") {
      setLostFor("LOST");
      return;
    }
    const msg =
      stage === "LIVE"
        ? "Live — the merchant is active now"
        : stage === "ORDER_FORM_SIGNED"
          ? "Order form signed — the merchant is onboarding"
          : `Moved to ${STAGE_LABEL[stage]}`;
    save({ stage }, msg);
  };

  const submitNote = () => {
    const body = note.trim();
    if (!body) return;
    addNote.mutate(
      { id: deal.id, body },
      {
        onSuccess: () => setNote(""),
        onError: (err) => toast({ variant: "error", title: "Couldn't add note", description: err.messages.join(" · ") }),
      },
    );
  };

  const contractors = organizations.filter((o) => o.kind === "CONTRACTOR");
  const partners = organizations.filter((o) => o.kind !== "CONTRACTOR");
  const disabled = !canManage || update.isPending;

  return (
    <div className="flex flex-col gap-6" data-testid="deal-drawer">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={STAGE_TONE[deal.stage]} icon={false} data-testid="deal-stage-badge">
          {STAGE_LABEL[deal.stage]}
        </Badge>
        <Badge tone={MERCHANT_STATUS_TONE[deal.merchantStatus]} icon={false} data-testid="deal-merchant-badge">
          Merchant: {MERCHANT_STATUS_LABEL[deal.merchantStatus]}
        </Badge>
        {canOpenMerchant ? (
          <Link href={`/merchants/${deal.merchantId}`} className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-foreground underline underline-offset-4">
            Open merchant <ExternalLink className="size-3.5" />
          </Link>
        ) : null}
      </div>

      {deal.stage === "LOST" && deal.lostReason ? (
        <p className="rounded-lg bg-muted px-3 py-2.5 text-table text-foreground">
          <span className="font-medium">Lost:</span> {deal.lostReason}
        </p>
      ) : null}

      {/* Stage + people */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Stage">
          <Select value={deal.stage} disabled={disabled} onChange={(e) => onStage(e.target.value as DealStage)} aria-label="Deal stage" data-testid="deal-stage">
            {ALL_STAGES.map((s) => (
              <option key={s} value={s}>
                {STAGE_LABEL[s]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Owner">
          <Select
            value={deal.owner?.id ?? ""}
            disabled={disabled}
            onChange={(e) => {
              const id = e.target.value;
              save(id ? { ownerId: id } : { clearOwner: true }, id ? "Owner set" : "Owner cleared");
            }}
            aria-label="Deal owner"
          >
            <option value="">Unassigned</option>
            {owners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Partner organization" hint="The ISO, agent or reseller who brought the deal">
          <Select
            value={deal.organization?.id ?? ""}
            disabled={disabled}
            onChange={(e) => {
              const id = e.target.value;
              save(id ? { organizationId: id } : { clearOrganization: true }, id ? "Organization set" : "Organization cleared");
            }}
            aria-label="Partner organization"
          >
            <option value="">None (direct)</option>
            {partners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Demo">
          <Input
            type="datetime-local"
            value={demoAt}
            disabled={!canManage}
            onChange={(e) => setDemoAt(e.target.value)}
            onBlur={() => {
              if (demoAt === toLocalInput(deal.demoAt)) return;
              const iso = fromLocalInput(demoAt);
              save(iso ? { demoAt: iso } : { clearDemoAt: true }, iso ? "Demo saved" : "Demo cleared");
            }}
            aria-label="Demo date and time"
          />
        </Field>
      </div>

      {lostFor ? (
        <div className="rounded-lg border border-border p-3" data-testid="lost-reason-box">
          <Field label="Why was it lost?" required>
            <Textarea value={lostReason} onChange={(e) => setLostReason(e.target.value)} rows={2} maxLength={500} aria-label="Lost reason" autoFocus />
          </Field>
          <div className="mt-2 flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setLostFor(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={!lostReason.trim()}
              loading={update.isPending}
              onClick={() => {
                save({ stage: "LOST", lostReason: lostReason.trim() }, "Marked lost");
                setLostFor(null);
                setLostReason("");
              }}
            >
              Mark lost
            </Button>
          </div>
        </div>
      ) : null}

      {/* Money */}
      <div>
        <p className="mb-2 text-xs font-semibold text-foreground">Money</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Monthly" hint="Software + lease, from the signed quote or typed">
            <Input
              value={monthly}
              disabled={!canManage}
              inputMode="decimal"
              placeholder="0.00"
              onChange={(e) => setMonthly(e.target.value)}
              onBlur={() => {
                if (monthly === (deal.amountMonthly ?? "")) return;
                save({ amountMonthly: monthly.trim() || "0" }, "Monthly amount saved");
              }}
              aria-label="Monthly amount"
            />
          </Field>
          <Field label="One-time" hint="Hardware and services">
            <Input
              value={oneTime}
              disabled={!canManage}
              inputMode="decimal"
              placeholder="0.00"
              onChange={(e) => setOneTime(e.target.value)}
              onBlur={() => {
                if (oneTime === (deal.amountOneTime ?? "")) return;
                save({ amountOneTime: oneTime.trim() || "0" }, "One-time amount saved");
              }}
              aria-label="One-time amount"
            />
          </Field>
        </div>
      </div>

      {/* Deployment */}
      <div>
        <p className="mb-2 text-xs font-semibold text-foreground">Deployment</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Deployment date">
            <Input
              type="date"
              value={deployment}
              disabled={!canManage}
              onChange={(e) => setDeployment(e.target.value)}
              onBlur={() => {
                if (deployment === (deal.deploymentDate ?? "")) return;
                save(deployment ? { deploymentDate: deployment } : { clearDeploymentDate: true }, "Deployment date saved");
              }}
              aria-label="Deployment date"
            />
          </Field>
          <Field label="Deployed by">
            <Select
              value={deal.deployedBy ?? ""}
              disabled={disabled}
              onChange={(e) => {
                const v = e.target.value as DeployedBy | "";
                if (v) save({ deployedBy: v }, "Saved");
              }}
              aria-label="Deployed by"
            >
              <option value="">Not decided</option>
              {(Object.keys(DEPLOYED_BY_LABEL) as DeployedBy[]).map((k) => (
                <option key={k} value={k}>
                  {DEPLOYED_BY_LABEL[k]}
                </option>
              ))}
            </Select>
          </Field>
          {deal.deployedBy === "CONTRACTOR" ? (
            <>
              <Field label="Contractor">
                <Select
                  value={deal.contractor?.id ?? ""}
                  disabled={disabled}
                  onChange={(e) => {
                    const id = e.target.value;
                    save(id ? { contractorOrganizationId: id } : { clearContractor: true }, id ? "Contractor set" : "Contractor cleared");
                  }}
                  aria-label="Contractor"
                >
                  <option value="">Pick a contractor</option>
                  {contractors.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Hired by">
                <Select
                  value={deal.hiredBy ?? ""}
                  disabled={disabled}
                  onChange={(e) => {
                    const v = e.target.value as HiredBy | "";
                    if (v) save({ hiredBy: v }, "Saved");
                  }}
                  aria-label="Hired by"
                >
                  <option value="">Not decided</option>
                  {(Object.keys(HIRED_BY_LABEL) as HiredBy[]).map((k) => (
                    <option key={k} value={k}>
                      {HIRED_BY_LABEL[k]}
                    </option>
                  ))}
                </Select>
              </Field>
            </>
          ) : null}
          <Field label="Go-live date" hint="Set when the deal goes Live">
            <Input
              type="date"
              value={goLive}
              disabled={!canManage}
              onChange={(e) => setGoLive(e.target.value)}
              onBlur={() => {
                if (goLive === (deal.goLiveDate ?? "") || !goLive) return;
                save({ goLiveDate: goLive }, "Go-live date saved");
              }}
              aria-label="Go-live date"
            />
          </Field>
        </div>
      </div>

      {/* Quotes */}
      <QuotesSection deal={deal} canManage={canManage} canQuote={canQuote} />

      {/* Notes */}
      <div>
        <Field label="Working notes">
          <Textarea
            value={notes}
            disabled={!canManage}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => {
              if (notes === (deal.notes ?? "")) return;
              save({ notes }, "Notes saved");
            }}
            rows={3}
            maxLength={10000}
            aria-label="Working notes"
            placeholder="What they need, who decides, what's in the way…"
          />
        </Field>
      </div>

      {/* Timeline */}
      <div>
        <p className="mb-2 text-xs font-semibold text-foreground">History</p>
        {canManage ? (
          <div className="mb-3 flex flex-col gap-2">
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Log a call, visit or e-mail" maxLength={5000} aria-label="New note" rows={2} />
            <div className="flex justify-end">
              <Button size="sm" variant="default" onClick={submitNote} loading={addNote.isPending} disabled={!note.trim()}>
                Add note
              </Button>
            </div>
          </div>
        ) : null}
        <ul className="flex flex-col gap-2" data-testid="deal-events">
          {deal.events.map((e) => (
            <li key={e.id} className="rounded-lg border border-border px-3 py-2.5" data-testid={`event-${e.kind}`}>
              <p className="text-table text-foreground">
                {e.kind === "STAGE_CHANGED" && e.toStage ? (
                  <>
                    <span className="font-medium">{STAGE_LABEL[e.toStage]}</span>
                    {e.fromStage ? <span className="text-muted-foreground"> (from {STAGE_LABEL[e.fromStage]})</span> : null}
                  </>
                ) : e.kind === "NOTE" ? (
                  <span className="whitespace-pre-wrap">{e.body}</span>
                ) : (
                  <>
                    <span className="font-medium">{EVENT_LABEL[e.kind]}</span>
                    {e.body ? <span className="text-muted-foreground"> — {e.body}</span> : null}
                  </>
                )}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {e.actor?.name ?? "System"} · {formatDateTime(e.createdAt)}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function QuotesSection({ deal, canManage, canQuote }: { deal: DealDetail; canManage: boolean; canQuote: boolean }) {
  const { toast } = useToast();
  const link = useLinkQuoteToDeal();
  const [attaching, setAttaching] = useState(false);
  const [pick, setPick] = useState("");
  const links = useQuoteLinks({ status: "ACTIVE", limit: 100 }, { enabled: attaching });
  const candidates = (links.data?.data ?? []).filter((l) => !deal.quotes.some((q) => q.linkId === l.id));
  return (
    <div data-testid="deal-quotes">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-foreground">Quotes</p>
        {canManage ? (
          <div className="flex gap-1.5">
            {canQuote ? (
              <Link href={`/quotes/new?deal=${deal.id}`} className="inline-flex h-7 items-center gap-1 rounded-sm bg-primary px-2.5 text-xs font-medium text-primary-foreground hover:bg-primary-hover">
                <Plus className="size-3.5" /> New quote link
              </Link>
            ) : null}
            <Button variant="outline" size="sm" onClick={() => setAttaching((v) => !v)}>
              <Link2 className="size-3.5" /> Attach existing
            </Button>
          </div>
        ) : null}
      </div>
      {attaching ? (
        <div className="mb-3 flex flex-wrap items-end gap-2 rounded-lg border border-border p-3">
          <Field label="Quote link" className="min-w-[220px] flex-1">
            <Select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Quote link to attach">
              <option value="">{links.isPending ? "Loading…" : candidates.length ? "Pick a link" : "No other active links"}</option>
              {candidates.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.restaurantName} · {l.createdByEmail} · {formatDay(l.createdAt)}
                </option>
              ))}
            </Select>
          </Field>
          <Button
            variant="default"
            size="sm"
            disabled={!pick}
            loading={link.isPending}
            onClick={() =>
              link.mutate(
                { id: deal.id, linkId: pick },
                {
                  onSuccess: () => {
                    toast({ variant: "success", title: "Quote attached" });
                    setAttaching(false);
                    setPick("");
                  },
                  onError: (err) => toast({ variant: "error", title: "Couldn't attach", description: err.messages.join(" · ") }),
                },
              )
            }
          >
            Attach
          </Button>
        </div>
      ) : null}
      {deal.quotes.length === 0 ? (
        <p className="text-table text-muted-foreground">No quotes yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {deal.quotes.map((q) => (
            <li key={q.linkId} className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2" data-testid="deal-quote">
              <FileText className="size-4 text-muted-foreground" />
              <Link href={q.requestId ? `/quotes/requests/${q.requestId}` : `/quotes/links/${q.linkId}`} className="text-table font-medium text-foreground underline-offset-4 hover:underline">
                {q.requestNumber ?? (q.mode === "HIDE_PRICES" ? "Hidden-price link" : "Priced link")}
              </Link>
              <Badge tone={q.requestStatus ? QUOTE_STATUS_TONE[q.requestStatus] ?? "neutral" : q.linkStatus === "REVOKED" ? "outline" : "neutral"} icon={false}>
                {q.requestStatus ? QUOTE_STATUS_LABEL[q.requestStatus] ?? q.requestStatus : q.linkStatus === "REVOKED" ? "Link revoked" : "Waiting for the restaurant"}
              </Badge>
              <span className="ml-auto text-xs text-muted-foreground tabular">
                {q.monthlyTotal ? `${money(q.monthlyTotal)}/mo` : ""}
                {q.oneTimeTotal ? ` · ${money(q.oneTimeTotal)} one-time` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
