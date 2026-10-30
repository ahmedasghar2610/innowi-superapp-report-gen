"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink, Mail, MapPin, Phone } from "lucide-react";
import { Badge, Button, Drawer, ErrorState, Field, Input, Select, Skeleton, Textarea, useToast } from "@/components/ui";
import { useCan } from "@/features/auth/use-can";
import { formatDateTime } from "@/lib/format";
import { MERCHANT_STATUS_LABEL, MERCHANT_STATUS_TONE, WINBACK_LABEL, WINBACK_TONE, formatDay, money } from "../labels";
import { useAddChurnNote, useChurnDetail, useUpdateChurn } from "../queries";
import { WINBACK_STATUSES, type ChurnDetail, type PersonRef, type WinbackStatus } from "../types";

const LINK_BTN =
  "inline-flex h-7 items-center gap-1 rounded-sm px-2.5 text-xs font-medium [&_svg]:size-4 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent";
const LINK_PRIMARY = "bg-primary text-primary-foreground hover:bg-primary-hover";
const LINK_OUTLINE = "border border-border bg-card text-foreground hover:bg-accent";

/** One churned account: why it left, the restaurant's contact, and the win-back work. */
export function ChurnDrawer({
  merchantId,
  owners,
  onClose,
}: {
  merchantId: string | null;
  owners: PersonRef[];
  onClose: () => void;
}) {
  const { data, isPending, isError, error, refetch } = useChurnDetail(merchantId ?? undefined);
  return (
    <Drawer
      open={!!merchantId}
      onClose={onClose}
      title={data ? data.restaurantName : "Churned account"}
      description={data ? [data.region, data.innowiSolution, data.churnedOn && `churned ${formatDay(data.churnedOn)}`].filter(Boolean).join(" · ") : undefined}
      size="lg"
    >
      {!merchantId ? null : isError ? (
        <ErrorState title="Couldn't load this account" error={error} onRetry={() => refetch()} />
      ) : isPending || !data ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : (
        <ChurnBody row={data} owners={owners} />
      )}
    </Drawer>
  );
}

function ChurnBody({ row, owners }: { row: ChurnDetail; owners: PersonRef[] }) {
  const can = useCan();
  const canManage = can("churn.manage");
  const canEditFacts = can("churn.import");
  const canOpenMerchant = can("profile.view");
  const { toast } = useToast();
  const update = useUpdateChurn();
  const addNote = useAddChurnNote();
  const [note, setNote] = useState("");
  const [notes, setNotes] = useState(row.winbackNotes ?? "");
  const [followUp, setFollowUp] = useState(row.nextFollowUpOn ?? "");
  useEffect(() => {
    setNotes(row.winbackNotes ?? "");
    setFollowUp(row.nextFollowUpOn ?? "");
  }, [row.merchantId, row.winbackNotes, row.nextFollowUpOn]);

  const save = (input: Parameters<typeof update.mutate>[0]["input"], done: string) =>
    update.mutate(
      { merchantId: row.merchantId, input },
      {
        onSuccess: () => toast({ variant: "success", title: done }),
        onError: (err) => toast({ variant: "error", title: "Couldn't save", description: err.messages.join(" · ") }),
      },
    );

  const submitNote = () => {
    const body = note.trim();
    if (!body) return;
    addNote.mutate(
      { merchantId: row.merchantId, body },
      {
        onSuccess: () => setNote(""),
        onError: (err) => toast({ variant: "error", title: "Couldn't add note", description: err.messages.join(" · ") }),
      },
    );
  };

  const contact = row.contacts.find((c) => c.id === row.contact?.id) ?? row.contact;
  const facts: [string, string | null | undefined][] = [
    ["Churn category", row.category],
    ["CSM", row.csmName],
    ["Account manager", row.accountManager],
    ["MRR at churn", row.mrrAtChurn ? money(row.mrrAtChurn) : null],
    ["GPV at churn", row.gpvAtChurn ? money(row.gpvAtChurn) : null],
    ["Tier", row.accountTier === null ? null : String(row.accountTier)],
    ["Customer since", row.startDate ? formatDay(row.startDate) : null],
    ["Last touchpoint", row.lastTouchpointOn ? formatDay(row.lastTouchpointOn) : null],
    ["Source", row.source],
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={MERCHANT_STATUS_TONE[row.merchantStatus]} icon={false}>
          {MERCHANT_STATUS_LABEL[row.merchantStatus]}
        </Badge>
        <Badge tone={WINBACK_TONE[row.winbackStatus]} icon={false}>
          Win-back: {WINBACK_LABEL[row.winbackStatus]}
        </Badge>
        {canOpenMerchant ? (
          <Link href={`/merchants/${row.merchantId}`} className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-foreground underline underline-offset-4">
            Open merchant <ExternalLink className="size-3.5" />
          </Link>
        ) : null}
      </div>

      {/* Contact */}
      <div className="flex flex-wrap gap-2">
        {contact?.phone ? (
          <a href={`tel:${contact.phone}`} className={`${LINK_BTN} ${LINK_PRIMARY}`}>
            <Phone /> {contact.phone}
          </a>
        ) : null}
        {contact?.email ? (
          <a href={`mailto:${contact.email}`} className={`${LINK_BTN} ${LINK_OUTLINE}`}>
            <Mail /> {contact.email}
          </a>
        ) : null}
        {row.location?.address ? (
          <span className={`${LINK_BTN} ${LINK_OUTLINE} cursor-default`}>
            <MapPin /> {[row.location.address, row.location.city, row.location.state].filter(Boolean).join(", ")}
          </span>
        ) : null}
        {contact?.name ? <span className="self-center text-xs text-muted-foreground">Owner: {contact.name}</span> : null}
      </div>

      {row.reason ? (
        <div>
          <p className="mb-1.5 text-xs font-semibold text-foreground">Why they left</p>
          <p className="whitespace-pre-wrap rounded-lg bg-muted px-3 py-2.5 text-table text-foreground">{row.reason}</p>
        </div>
      ) : null}

      <DetailList title="The facts" rows={facts} />

      {/* Win-back */}
      <div>
        <p className="mb-2 text-xs font-semibold text-foreground">Win-back</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Status">
            <Select
              value={row.winbackStatus}
              disabled={!canManage || update.isPending}
              onChange={(e) => {
                const s = e.target.value as WinbackStatus;
                save({ winbackStatus: s }, s === "WON_BACK" ? "Won back — merchant is active again" : `Marked ${WINBACK_LABEL[s]}`);
              }}
              aria-label="Win-back status"
            >
              {WINBACK_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {WINBACK_LABEL[s]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Owner (our side)">
            <Select
              value={row.winbackOwner?.id ?? ""}
              disabled={!canManage || update.isPending}
              onChange={(e) => {
                const id = e.target.value;
                save(id ? { winbackOwnerId: id } : { clearWinbackOwner: true }, id ? "Owner set" : "Owner cleared");
              }}
              aria-label="Win-back owner"
            >
              <option value="">Unassigned</option>
              {owners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Next follow-up">
            <div className="flex gap-2">
              <Input
                type="date"
                value={followUp}
                disabled={!canManage}
                onChange={(e) => setFollowUp(e.target.value)}
                onBlur={() => {
                  if (followUp === (row.nextFollowUpOn ?? "")) return;
                  save(followUp ? { nextFollowUpOn: followUp } : { clearNextFollowUp: true }, "Follow-up saved");
                }}
                aria-label="Next follow-up date"
              />
            </div>
          </Field>
        </div>
        <div className="mt-3">
          <Field label="Working notes">
            <Textarea
              value={notes}
              disabled={!canManage}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => {
                if (notes === (row.winbackNotes ?? "")) return;
                save({ winbackNotes: notes }, "Notes saved");
              }}
              rows={4}
              maxLength={10000}
              aria-label="Working notes"
              placeholder="Offer on the table, what they'd need to come back…"
            />
          </Field>
        </div>
      </div>

      {/* Touches */}
      <div>
        <p className="mb-2 text-xs font-semibold text-foreground">Touches</p>
        {canManage ? (
          <div className="mb-3 flex flex-col gap-2">
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Log a call, visit or e-mail — the first one moves the account to Contacted"
              maxLength={5000}
              aria-label="New touch"
            />
            <div className="flex justify-end">
              <Button size="sm" variant="default" onClick={submitNote} loading={addNote.isPending} disabled={!note.trim()}>
                Log touch
              </Button>
            </div>
          </div>
        ) : null}
        {row.notes.length === 0 ? (
          <p className="text-table text-muted-foreground">No touches logged yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {row.notes.map((n) => (
              <li key={n.id} className="rounded-lg border border-border px-3 py-2.5">
                <p className="whitespace-pre-wrap text-table text-foreground">{n.body}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {n.author?.name ?? "—"} · {formatDateTime(n.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      {canEditFacts ? <FactsEditor row={row} onSave={save} busy={update.isPending} /> : null}
    </div>
  );
}

function FactsEditor({
  row,
  onSave,
  busy,
}: {
  row: ChurnDetail;
  onSave: (input: { churnedOn?: string; category?: string; reason?: string; mrrAtChurn?: string }, done: string) => void;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [churnedOn, setChurnedOn] = useState(row.churnedOn ?? "");
  const [category, setCategory] = useState(row.category ?? "");
  const [reason, setReason] = useState(row.reason ?? "");
  const [mrr, setMrr] = useState(row.mrrAtChurn ?? "");
  if (!open) {
    return (
      <Button variant="ghost" size="sm" className="self-start" onClick={() => setOpen(true)}>
        Correct the churn facts
      </Button>
    );
  }
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="mb-2 text-xs font-semibold text-foreground">Churn facts (managers)</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Churn date">
          <Input type="date" value={churnedOn} onChange={(e) => setChurnedOn(e.target.value)} aria-label="Churn date" />
        </Field>
        <Field label="MRR at churn">
          <Input value={mrr} onChange={(e) => setMrr(e.target.value)} inputMode="decimal" placeholder="0.00" aria-label="MRR at churn" />
        </Field>
        <Field label="Category" hint="Separate several with ; — e.g. Price; Support">
          <Input value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Churn category" />
        </Field>
      </div>
      <div className="mt-3">
        <Field label="Reason">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} aria-label="Churn reason" />
        </Field>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button
          variant="default"
          size="sm"
          loading={busy}
          onClick={() => {
            const input: { churnedOn?: string; category?: string; reason?: string; mrrAtChurn?: string } = {};
            if (churnedOn) input.churnedOn = churnedOn;
            input.category = category.trim();
            input.reason = reason.trim();
            if (mrr.trim()) input.mrrAtChurn = mrr.trim();
            onSave(input, "Churn facts saved");
            setOpen(false);
          }}
        >
          Save facts
        </Button>
      </div>
    </div>
  );
}

function DetailList({ title, rows }: { title: string; rows: [string, string | null | undefined][] }) {
  const shown = rows.filter(([, v]) => v);
  if (!shown.length) return null;
  return (
    <div>
      <p className="mb-2 text-xs font-semibold text-foreground">{title}</p>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-2.5 text-table sm:grid-cols-2">
        {shown.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-xs font-medium uppercase tracking-[0.04em] text-muted-foreground">{label}</dt>
            <dd className="mt-0.5 break-words text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
