"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CircleCheck, Download, FileSignature, Pencil } from "lucide-react";
import { Badge, Button, Card, CardBody, ErrorState, Field, Input, Select, Skeleton, Textarea, useToast } from "@/components/ui";
import { useAuth } from "@/features/auth/auth-context";
import { hasCapability } from "@/features/auth/capabilities";
import { formatDateTime } from "@/lib/format";
import { quotes } from "@/lib/api/resources/quotes";
import { MODE_LABEL, REQUEST_STATUS_LABEL, REQUEST_STATUS_TONE } from "../format";
import { useCountersignRequest, useQuoteRequest, useUpdateRequest } from "../queries";
import type { QuoteEvent, RequestStatus } from "../types";
import { LinesTable } from "./lines-table";
import { RevisionTrail } from "./revision-trail";
import { SignaturePad, SignatureView, type SignatureValue } from "./signature-pad";
import { TotalsPanel } from "./totals-panel";

const SETTABLE: RequestStatus[] = ["REQUESTED", "PROPOSED", "DECLINED", "CLOSED"];

const EVENT_LABEL: Record<string, string> = {
  SUBMITTED: "Submitted by the restaurant",
  VIEWED: "Opened by the restaurant",
  REVISED_STAFF: "Revision sent",
  REVISED_CLIENT: "Restaurant sent changes",
  PRICES_REVEALED: "Prices shown to the restaurant",
  SIGNED_CLIENT: "Signed by the restaurant",
  SIGNED_INNOWI: "Countersigned",
  SIGNATURE_VOIDED: "Signature voided by a new revision",
  DECLINED: "Declined by the restaurant",
  STATUS_CHANGED: "Status changed",
};

function channel(v?: boolean | null): string {
  return v === true ? "sent" : v === false ? "failed" : "not set up";
}

/** Route /quotes/requests/[id]: one request or proposal, always with prices for staff. */
export function RequestPage({ id }: { id: string }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const canEdit = hasCapability(user?.role, "quotes.edit");
  const req = useQuoteRequest(id);
  const update = useUpdateRequest();
  const [note, setNote] = useState("");

  useEffect(() => {
    if (req.data) setNote(req.data.staffNote ?? "");
  }, [req.data]);

  if (req.isPending) return <Skeleton className="h-64" />;
  if (req.isError) return <ErrorState error={req.error} onRetry={() => req.refetch()} />;
  const r = req.data;
  const locked = r.status === "ACCEPTED" || r.status === "SIGNED" || r.status === "EXECUTED";
  const live = r.signatures.filter((s) => !s.voidedAt);
  const clientSig = live.find((s) => s.role === "CLIENT");
  const innowiSig = live.find((s) => s.role === "INNOWI");
  const save = (input: { status?: RequestStatus; staffNote?: string | null }, done: string) =>
    update.mutate(
      { id, ...input },
      {
        onSuccess: () => toast({ variant: "success", title: done }),
        onError: (e) => toast({ variant: "error", title: "Couldn't save", description: e.messages.join(" · ") }),
      },
    );

  return (
    <div className="flex max-w-5xl flex-col gap-5">
      <div>
        <Link href="/quotes" className="inline-flex items-center gap-1 text-table text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Quotes
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-[-0.011em] text-foreground">
            {r.number} · {r.restaurantName}
          </h1>
          <Badge tone={REQUEST_STATUS_TONE[r.status]}>{REQUEST_STATUS_LABEL[r.status]}</Badge>
          {r.currentRevisionNo > 1 && <Badge tone="neutral">Rev {r.currentRevisionNo}</Badge>}
          {r.mode === "HIDE_PRICES" && r.pricesRevealed && <Badge tone="accent">Prices revealed</Badge>}
        </div>
        <p className="mt-1 text-table text-muted-foreground">
          {r.contactName} · <a className="underline underline-offset-2" href={`mailto:${r.contactEmail}`}>{r.contactEmail}</a>
          {r.contactPhone ? ` · ${r.contactPhone}` : ""} · received {formatDateTime(r.createdAt)} · {MODE_LABEL[r.mode]}
          {r.mode === "HIDE_PRICES" && !r.pricesRevealed && " (the client sees quantities only)"} ·{" "}
          <Link className="underline underline-offset-2" href={`/quotes/links/${r.linkId}`}>
            link
          </Link>
        </p>
      </div>

      {r.status === "SIGNED" && clientSig && (
        <div className="rounded-xl border border-border bg-warning-soft p-4 text-table text-warning-text">
          <div className="flex items-center gap-2 font-semibold">
            <FileSignature className="size-5" aria-hidden /> Signed by {clientSig.name}
            {clientSig.title ? `, ${clientSig.title}` : ""} on {formatDateTime(clientSig.signedAt)}
          </div>
          <p className="mt-0.5">Countersign below to execute the agreement — both parties then get the signed copy by e-mail.</p>
        </div>
      )}
      {r.status === "EXECUTED" && (
        <div className="rounded-xl border border-success-border bg-success-subtle p-4 text-table text-success-subtle-foreground">
          <div className="flex items-center gap-2 font-semibold">
            <CircleCheck className="size-5" aria-hidden /> Fully signed
            {innowiSig ? ` — countersigned by ${innowiSig.name} on ${formatDateTime(innowiSig.signedAt)}` : ""}
          </div>
          <p className="mt-0.5">The signed copy, with its signature certificate, went to {r.contactEmail} and the team.</p>
        </div>
      )}
      {r.status === "ACCEPTED" && (
        <div className="rounded-xl border border-success-border bg-success-subtle p-4 text-table text-success-subtle-foreground">
          <div className="flex items-center gap-2 font-semibold">
            <CircleCheck className="size-5" aria-hidden /> Accepted by {r.acceptedName}
            {r.acceptedTitle ? `, ${r.acceptedTitle}` : ""} on {formatDateTime(r.acceptedAt)}
          </div>
        </div>
      )}
      {r.status === "DECLINED" && r.declinedReason && (
        <div className="rounded-xl border border-border bg-muted/60 p-4 text-table text-foreground">
          <span className="font-semibold">Declined:</span> “{r.declinedReason}”
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-5">
          <Card>
            <CardBody className="flex flex-col gap-4">
              <TotalsPanel totals={r.totals} plan={r.hardwarePlan} audience="staff" />
              <LinesTable lines={r.lines} totals={r.totals} />
              {r.notes && (
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-primary">Their notes</div>
                  <p className="mt-1 whitespace-pre-line text-table text-foreground">{r.notes}</p>
                </div>
              )}
            </CardBody>
          </Card>

          {live.length > 0 && (
            <Card>
              <CardBody>
                <div className="mb-2 text-sm font-semibold text-foreground">Signatures (revision {r.currentRevisionNo})</div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {live.map((s) => (
                    <div key={s.role} className="rounded-lg border border-border p-3">
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {s.role === "CLIENT" ? r.restaurantName : "Innowi, Inc."}
                      </div>
                      <div className="mt-1.5">
                        <SignatureView method={s.method} data={s.signatureData} />
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {s.name}
                        {s.title ? `, ${s.title}` : ""} · {formatDateTime(s.signedAt)}
                        {s.ip ? ` · IP ${s.ip}` : ""}
                      </div>
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>
          )}

          {r.status === "SIGNED" && canEdit && <CountersignCard id={id} defaultName={user?.email ?? ""} />}

          {r.revisions.length > 0 && (
            <Card>
              <CardBody>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-foreground">Negotiation trail</div>
                  {canEdit && r.status !== "EXECUTED" && (
                    <Link
                      href={`/quotes/requests/${r.id}/revise`}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
                    >
                      <Pencil className="size-3.5" aria-hidden /> Edit &amp; send revision
                    </Link>
                  )}
                </div>
                <RevisionTrail
                  revisions={r.revisions}
                  currentRevisionNo={r.currentRevisionNo}
                  author={(rev) => (rev.authorKind === "STAFF" ? (rev as { authorName?: string | null }).authorName || "Innowi" : "Restaurant")}
                  renderActions={(rev) => (
                    <a
                      href={quotes.requestPdfUrl(r.id, rev.revNo === r.currentRevisionNo ? undefined : rev.revNo)}
                      className="mt-2 inline-flex items-center gap-1 text-xs text-primary underline underline-offset-4"
                    >
                      <Download className="size-3.5" aria-hidden /> PDF of this revision
                    </a>
                  )}
                />
              </CardBody>
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <a
            href={quotes.requestPdfUrl(r.id)}
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-3 text-sm font-medium text-foreground hover:bg-secondary"
          >
            <Download className="size-4" aria-hidden /> Proposal PDF
          </a>
          <Card>
            <CardBody className="flex flex-col gap-3">
              <Field label="Status" htmlFor="rq-status">
                <Select
                  id="rq-status"
                  value={r.status}
                  disabled={!canEdit || locked || update.isPending}
                  onChange={(e) => save({ status: e.target.value as RequestStatus }, "Status updated")}
                >
                  {locked && <option value={r.status}>{REQUEST_STATUS_LABEL[r.status]}</option>}
                  {SETTABLE.map((s) => (
                    <option key={s} value={s}>
                      {REQUEST_STATUS_LABEL[s]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Team note" htmlFor="rq-note" hint="Only the team sees this">
                <Textarea id="rq-note" rows={4} value={note} disabled={!canEdit} onChange={(e) => setNote(e.target.value)} />
              </Field>
              {canEdit && (
                <Button variant="outline" disabled={note === (r.staffNote ?? "")} loading={update.isPending} onClick={() => save({ staffNote: note || null }, "Note saved")}>
                  Save note
                </Button>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardBody className="text-xs text-muted-foreground">
              <div className="mb-1 font-semibold text-foreground">Notifications</div>
              {Object.entries(r.notified).length === 0 ? (
                <div>None recorded.</div>
              ) : (
                Object.entries(r.notified).map(([event, ch]) => (
                  <div key={event}>
                    {event}: Teams {channel(ch?.teams)}, team e-mail {channel(ch?.email)}
                    {ch && "clientEmail" in ch ? `, client e-mail ${channel(ch.clientEmail)}` : ""}
                  </div>
                ))
              )}
              {r.linkCreatedByEmail && <div className="mt-1">Link sent by {r.linkCreatedByEmail}</div>}
            </CardBody>
          </Card>
          {r.events.length > 0 && (
            <Card>
              <CardBody className="text-xs text-muted-foreground">
                <div className="mb-1 font-semibold text-foreground">Activity</div>
                <ol className="flex flex-col gap-1">
                  {[...r.events].reverse().map((e, i) => (
                    <EventRow key={i} e={e} />
                  ))}
                </ol>
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function EventRow({ e }: { e: QuoteEvent }) {
  return (
    <li>
      <span className="text-foreground">{EVENT_LABEL[e.kind] ?? e.kind}</span>
      {e.revNo ? ` (rev ${e.revNo})` : ""} · {formatDateTime(e.createdAt)}
      {e.actor ? ` · ${e.actor}` : ""}
    </li>
  );
}

function CountersignCard({ id, defaultName }: { id: string; defaultName: string }) {
  const { toast } = useToast();
  const countersign = useCountersignRequest();
  const [name, setName] = useState(defaultName);
  const [title, setTitle] = useState("");
  const [sig, setSig] = useState<SignatureValue>({ method: "DRAWN", data: null });
  const [agree, setAgree] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (name.trim().length < 2) return setError("Type your full name.");
    if (!sig.data) return setError(sig.method === "DRAWN" ? "Draw your signature (or switch to Type)." : "Type your name to sign.");
    if (!agree) return setError("Tick the box to sign on Innowi's behalf.");
    countersign.mutate(
      { id, name: name.trim(), title: title.trim() || undefined, method: sig.method, signatureData: sig.data, agree: true },
      {
        onSuccess: () => toast({ variant: "success", title: "Countersigned — the agreement is fully executed" }),
        onError: (err) => setError(err.messages.join(" · ")),
      },
    );
  };

  return (
    <Card>
      <CardBody>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <FileSignature className="size-4" aria-hidden /> Countersign for Innowi
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Your full name" htmlFor="cs-name" required>
              <Input id="cs-name" value={name} onChange={(e) => setName(e.target.value)} required />
            </Field>
            <Field label="Title" htmlFor="cs-title" hint="e.g. Sales Manager">
              <Input id="cs-title" value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>
          </div>
          <SignaturePad value={sig} onChange={setSig} label="Innowi signature" />
          <label className="flex items-start gap-2 text-sm text-foreground">
            <input type="checkbox" className="mt-0.5 size-4 shrink-0" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            I&apos;m authorized to sign on behalf of Innowi, Inc. and agree to sign this agreement electronically.
          </label>
          {error && (
            <p role="alert" className="rounded-lg bg-destructive-subtle px-3 py-2 text-sm text-text-destructive">
              {error}
            </p>
          )}
          <div>
            <Button variant="default" type="submit" loading={countersign.isPending}>
              Countersign &amp; execute
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
