"use client";

import { useState } from "react";
import { CircleCheck, Download, FileSignature, Pencil, RefreshCw } from "lucide-react";
import { Button, Field, Input, Textarea } from "@/components/ui";
import { formatDate, formatDateTime } from "@/lib/format";
import { LinesTable } from "../components/lines-table";
import { ChangeList, diffRevisions, RevisionTrail } from "../components/revision-trail";
import { SignaturePad, SignatureView, type SignatureValue } from "../components/signature-pad";
import { TotalsPanel } from "../components/totals-panel";
import type { PublicRequest } from "../types";
import { PublicApiError, publicQuotes } from "./public-api";

/** What the restaurant sees after sending: the proposal with its negotiation
 * trail, the sign form (price links / revealed requests) or a thank-you. */
export function Proposal({
  token,
  request,
  onChange,
  onEdit,
}: {
  token: string;
  request: PublicRequest;
  onChange: (r: PublicRequest) => void;
  onEdit: () => void;
}) {
  const r = request;
  const live = r.signatures.filter((s) => !s.voidedAt);
  const clientSig = live.find((s) => s.role === "CLIENT");
  const innowiSig = live.find((s) => s.role === "INNOWI");
  const current = r.revisions.find((rev) => rev.revNo === r.currentRevisionNo);
  const previous = r.revisions.find((rev) => rev.revNo === r.currentRevisionNo - 1);
  const updatedByInnowi = r.status === "PROPOSED" && current?.authorKind === "STAFF";

  const trail = r.revisions.length > 1 && (
    <div className="rounded-xl border border-border bg-background p-4">
      <h3 className="mb-2 text-sm font-semibold text-foreground">History</h3>
      <RevisionTrail
        revisions={r.revisions}
        currentRevisionNo={r.currentRevisionNo}
        author={(rev) => (rev.authorKind === "STAFF" ? "Innowi" : "You")}
      />
    </div>
  );

  if (!r.showPrices) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-5">
        {r.status === "DECLINED" ? (
          <DeclinedBanner r={r} />
        ) : (
          <div className="rounded-xl border border-success-border bg-success-subtle p-5">
            <div className="flex items-center gap-2 text-lg font-semibold text-success-subtle-foreground">
              <CircleCheck className="size-5" aria-hidden /> Thanks, {r.contactName.split(" ")[0]}. We&apos;ve got your request.
            </div>
            <p className="mt-1 text-sm text-success-subtle-foreground">
              Reference {r.number}. Your Innowi contact will price this and get back to you at {r.contactEmail}.
            </p>
          </div>
        )}
        <div className="rounded-xl border border-border bg-background p-5">
          <h2 className="mb-3 text-base font-semibold text-foreground">What you asked for</h2>
          <LinesTable lines={r.lines} />
          {r.notes && <p className="mt-4 whitespace-pre-line text-sm text-muted-foreground">“{r.notes}”</p>}
        </div>
        {trail}
        <div>
          <Button variant="outline" onClick={onEdit}>
            <Pencil className="size-4" /> {r.status === "DECLINED" ? "Adjust & resend" : "Change my selection"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-primary">
            Proposal {r.number}
            {r.currentRevisionNo > 1 && ` · revision ${r.currentRevisionNo}`}
          </div>
          <h2 className="text-2xl font-semibold tracking-[-0.011em] text-foreground">{r.restaurantName}</h2>
          <p className="text-sm text-muted-foreground">
            {current ? `Updated ${formatDate(current.createdAt)}` : `Prepared ${formatDate(r.createdAt)}`} for {r.contactName}
          </p>
        </div>
        <a
          href={publicQuotes.pdfUrl(token, r.id)}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-sm font-medium text-foreground hover:bg-secondary"
        >
          <Download className="size-4" aria-hidden /> Download PDF
        </a>
      </div>

      {updatedByInnowi && (
        <div className="rounded-xl border border-primary-border bg-primary-subtle/60 p-4" role="status">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <RefreshCw className="size-4" aria-hidden /> Your Innowi contact updated this proposal
          </div>
          {current?.note && <p className="mt-1 whitespace-pre-line text-sm text-foreground">“{current.note}”</p>}
          {previous && (
            <ChangeList className="mt-2" changes={diffRevisions(previous.lines, current!.lines)} />
          )}
        </div>
      )}

      {r.status === "DECLINED" && <DeclinedBanner r={r} />}

      {(r.status === "SIGNED" || r.status === "EXECUTED" || r.status === "ACCEPTED") && (
        <div className="rounded-xl border border-success-border bg-success-subtle p-4 text-sm text-success-subtle-foreground" role="status">
          <div className="flex items-center gap-2 font-semibold">
            <CircleCheck className="size-5" aria-hidden />
            {r.status === "EXECUTED"
              ? "Fully signed — this agreement is in effect"
              : clientSig
                ? `Signed by ${clientSig.name} on ${formatDateTime(clientSig.signedAt)}`
                : `Accepted by ${r.acceptedName} on ${formatDateTime(r.acceptedAt)}`}
          </div>
          <p className="mt-1">
            {r.status === "EXECUTED"
              ? "Both parties have signed. The signed copy was e-mailed to you — you can also download it above."
              : "Thank you! Innowi countersigns next, and you'll get the fully signed copy by e-mail."}
          </p>
          {(clientSig || innowiSig) && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {[clientSig, innowiSig].map(
                (s) =>
                  s && (
                    <div key={s.role} className="rounded-lg border border-success-border bg-background/70 p-3">
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {s.role === "CLIENT" ? r.restaurantName : "Innowi, Inc."}
                      </div>
                      <div className="mt-1.5">
                        <SignatureView method={s.method} data={s.signatureData} />
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {s.name}
                        {s.title ? `, ${s.title}` : ""} · {formatDateTime(s.signedAt)}
                      </div>
                    </div>
                  ),
              )}
            </div>
          )}
        </div>
      )}

      {r.totals && <TotalsPanel totals={r.totals} plan={r.hardwarePlan} leaseMonths={r.leaseMonths} />}

      <div className="rounded-xl border border-border bg-background p-5">
        <LinesTable lines={r.lines} totals={r.totals} leaseMonths={r.leaseMonths} />
      </div>

      {r.goldIncluded.length > 0 && (
        <p className="text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">Included with Gold:</span> {r.goldIncluded.join(" · ")}
        </p>
      )}

      {r.terms.length > 0 && (
        <details className="rounded-xl border border-border bg-background p-4 text-sm">
          <summary className="cursor-pointer font-semibold text-foreground">Terms and notes</summary>
          <ul className="mt-2 list-disc pl-5 text-muted-foreground">
            {r.terms.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </details>
      )}

      {trail}

      {r.status === "PROPOSED" && (
        <SignForm token={token} request={r} onChange={onChange} onEdit={onEdit} />
      )}
      {r.status === "DECLINED" && (
        <div>
          <Button variant="outline" onClick={onEdit}>
            <Pencil className="size-4" /> Adjust & resend
          </Button>
        </div>
      )}
    </div>
  );
}

function DeclinedBanner({ r }: { r: PublicRequest }) {
  return (
    <div className="rounded-xl border border-border bg-muted/60 p-4 text-sm text-foreground" role="status">
      <div className="font-semibold">You declined this proposal.</div>
      {r.declinedReason && <p className="mt-1 whitespace-pre-line text-muted-foreground">“{r.declinedReason}”</p>}
      <p className="mt-1 text-muted-foreground">Changed your mind? Adjust the selection below and send it back.</p>
    </div>
  );
}

function SignForm({
  token,
  request: r,
  onChange,
  onEdit,
}: {
  token: string;
  request: PublicRequest;
  onChange: (r: PublicRequest) => void;
  onEdit: () => void;
}) {
  const [name, setName] = useState(r.contactName ?? "");
  const [title, setTitle] = useState("");
  const [sig, setSig] = useState<SignatureValue>({ method: "DRAWN", data: null });
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [declining, setDeclining] = useState(false);
  const [declineReason, setDeclineReason] = useState("");

  const refetch = async () => onChange(await publicQuotes.request(token, r.id));

  const sign = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (name.trim().length < 2) return setError("Please type your full name.");
    if (!sig.data) return setError(sig.method === "DRAWN" ? "Please draw your signature (or switch to Type)." : "Please type your name to sign.");
    if (!agree) return setError("Please tick the box to agree and sign.");
    setBusy(true);
    try {
      onChange(
        await publicQuotes.sign(token, r.id, {
          revisionNo: r.currentRevisionNo,
          name: name.trim(),
          title: title.trim() || undefined,
          method: sig.method,
          signatureData: sig.data,
          agree: true,
        }),
      );
    } catch (err) {
      if (err instanceof PublicApiError && err.status === 409) {
        setError(err.message);
        await refetch().catch(() => undefined);
      } else {
        setError(err instanceof PublicApiError ? err.message : "Couldn't sign. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  };

  const decline = async () => {
    if (name.trim().length < 2) return setError("Please type your full name first.");
    setBusy(true);
    setError(null);
    try {
      onChange(await publicQuotes.decline(token, r.id, { name: name.trim(), reason: declineReason.trim() || undefined }));
    } catch (err) {
      setError(err instanceof PublicApiError ? err.message : "Couldn't send that. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={sign} className="rounded-xl border border-primary-border bg-primary-subtle/50 p-5">
      <h3 className="flex items-center gap-2 text-base font-semibold text-foreground">
        <FileSignature className="size-5" aria-hidden /> Sign to go ahead
      </h3>
      <p className="mb-3 text-sm text-muted-foreground">
        Sign below and Innowi countersigns — you&apos;ll get the fully signed copy by e-mail.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Your full name" htmlFor="sig-name" required>
          <Input id="sig-name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label="Title" htmlFor="sig-title" hint="e.g. Owner">
          <Input id="sig-title" autoComplete="organization-title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
      </div>
      <div className="mt-3">
        <SignaturePad value={sig} onChange={setSig} />
      </div>
      {r.consentText && (
        <label className="mt-3 flex items-start gap-2 text-sm text-foreground">
          <input type="checkbox" className="mt-0.5 size-4 shrink-0" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          <span>{r.consentText}</span>
        </label>
      )}
      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-destructive-subtle px-3 py-2 text-sm text-text-destructive">
          {error}
        </p>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button variant="default" type="submit" size="lg" loading={busy}>
          Sign &amp; accept
        </Button>
        <Button type="button" size="lg" variant="outline" onClick={onEdit}>
          <Pencil className="size-4" /> Adjust &amp; send back
        </Button>
        {!declining && (
          <button
            type="button"
            className="ml-auto text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
            onClick={() => setDeclining(true)}
          >
            Not going ahead? Decline
          </button>
        )}
      </div>
      {declining && (
        <div className="mt-3 rounded-lg border border-border bg-background p-3">
          <Field label="Anything we should know? (optional)" htmlFor="decline-reason">
            <Textarea id="decline-reason" rows={2} value={declineReason} onChange={(e) => setDeclineReason(e.target.value)} />
          </Field>
          <div className="mt-2 flex gap-2">
            <Button type="button" variant="outline" loading={busy} onClick={decline}>
              Decline proposal
            </Button>
            <Button type="button" variant="ghost" onClick={() => setDeclining(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </form>
  );
}
