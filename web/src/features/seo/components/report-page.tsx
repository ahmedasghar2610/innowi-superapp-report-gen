"use client";

import { useEffect, useState } from "react";
import { CircleCheck, ExternalLink, Mail, Printer, RefreshCw } from "lucide-react";
import { ReportDocument } from "./report-document";
import {
  Button,
  Card,
  Dialog,
  ErrorState,
  Field,
  Skeleton,
  Textarea,
  useToast,
} from "@/components/ui";
import { useGenerateReport, useReport, useSendReport, useSeoStatus, useSignOff } from "../api";
import { CADENCE, fmtDateTime } from "../lib";
import type { Report } from "../types";
import { DemoBadge, InfoNote, ReportStatusBadge } from "./parts";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** /web/seo/reports/[reportId] — review a client report: the report on the left, a sticky review panel (status, sign-off, send, print) on the right. */
export function ReportPage({ id }: { id: string }) {
  const q = useReport(id);
  const status = useSeoStatus();
  const r = q.data;
  useEffect(() => {
    if (r?.site) document.title = `${r.site.name} report — SEO — Innowi`;
  }, [r?.site]);

  if (q.error)
    return (
      <ErrorState
        title="Couldn't load the report"
        description={q.error.message}
      />
    );
  if (!r) return <Skeleton className="h-[40rem] w-full" />;
  return (
    <ReportView
      r={r}
      canApprove={!!status.data?.canApprove}
      canManage={!!status.data?.canManage}
    />
  );
}

/** Full-page client preview, opened in a new tab (no sidebar — exactly what the client receives). */
export const previewHref = (id: string, print = false) =>
  `/seo-report/${id}${print ? "?print=1" : ""}`;

function ReportView({
  r,
  canApprove,
  canManage,
}: {
  r: Report;
  canApprove: boolean;
  canManage: boolean;
}) {
  const [placeholders, setPlaceholders] = useState(false);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 xl:grid-cols-[minmax(0,1fr)_19rem]">
      <div className="order-2 min-w-0 xl:order-1">
        <div className="mx-auto w-full max-w-[920px]">
          <ReportDocument
            r={r}
            showPlaceholders={placeholders}
            canEdit={canManage}
          />
        </div>
      </div>
      <ReviewPanel
        r={r}
        canApprove={canApprove}
        canManage={canManage}
        placeholders={placeholders}
        onPlaceholders={setPlaceholders}
      />
    </div>
  );
}

function ReviewPanel({
  r,
  canApprove,
  canManage,
  placeholders,
  onPlaceholders,
}: {
  r: Report;
  canApprove: boolean;
  canManage: boolean;
  placeholders: boolean;
  onPlaceholders: (v: boolean) => void;
}) {
  const sign = useSignOff();
  const regen = useGenerateReport();
  const { toast } = useToast();
  const [sending, setSending] = useState(false);
  return (
    <aside className="order-1 xl:sticky xl:top-0 xl:order-2 print:hidden">
      <Card className="flex flex-col gap-4 p-4">
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <ReportStatusBadge s={r.status} />
            {r.snapshot.isDemo && <DemoBadge />}
          </div>
          <h2 className="text-lg font-semibold tracking-[-0.006em] text-foreground">
            {r.site?.name ?? "Deleted site"}
          </h2>
          <p className="text-xs text-muted-foreground">
            {r.snapshot.period.label} · {CADENCE[r.snapshot.period.cadence]}{" "}
            report
          </p>
        </div>

        <div className="flex flex-wrap gap-2 xl:grid xl:grid-cols-2">
          {r.status === "awaiting_signoff" && canApprove && (
            <Button
              size="sm"
              className="xl:col-span-2 xl:h-9"
              loading={sign.isPending}
              onClick={() =>
                sign.mutate(r.id, {
                  onSuccess: () =>
                    toast({ variant: "success", title: "Signed off" }),
                  onError: (e) =>
                    toast({
                      variant: "error",
                      title: "Couldn't sign off",
                      description: e.messages?.[0] ?? e.message,
                    }),
                })
              }
            >
              <CircleCheck className="size-4" />
              Sign off
            </Button>
          )}
          {r.status !== "awaiting_signoff" && canApprove && (
            <Button
              size="sm"
              className="xl:col-span-2 xl:h-9"
              variant={r.status === "signed" ? "default" : "outline"}
              onClick={() => setSending(true)}
              disabled={!r.emailConfigured}
              title={
                r.emailConfigured ? undefined : "Email sending isn't set up"
              }
            >
              <Mail className="size-4" />
              {r.status === "sent" ? "Send again" : "Send to client"}
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => window.open(previewHref(r.id), "_blank", "noopener")}
            title="Opens in a new tab"
          >
            <ExternalLink className="size-4" />
            Client preview
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              window.open(previewHref(r.id, true), "_blank", "noopener")
            }
            title="Opens in a new tab"
          >
            <Printer className="size-4" />
            Print / PDF
          </Button>
          {r.status === "awaiting_signoff" && canManage && r.site && (
            <Button
              size="sm"
              variant="ghost"
              className="xl:col-span-2"
              loading={regen.isPending}
              title="Rebuild this report from the latest synced data and crawl"
              onClick={() =>
                regen.mutate(
                  { siteId: r.site!.id, period: { periodStart: r.periodStart, periodEnd: r.periodEnd } },
                  {
                    onSuccess: () => toast({ variant: "success", title: "Report rebuilt with the latest data" }),
                    onError: (e) => toast({ variant: "error", title: "Couldn't rebuild the report", description: e.messages?.[0] ?? e.message }),
                  },
                )
              }
            >
              <RefreshCw className="size-4" />
              Refresh data
            </Button>
          )}
        </div>

        {r.status === "awaiting_signoff" && !canApprove && (
          <InfoNote>
            A manager (or someone granted report approval) signs the report off
            before it can be sent.
          </InfoNote>
        )}
        {r.error && (
          <p className="rounded-md bg-destructive-subtle px-3 py-2 text-sm text-text-destructive">
            Last delivery failed: {r.error}
          </p>
        )}

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 border-t border-border pt-3 text-xs md:grid-cols-4 xl:grid-cols-1">
          <Row label="Assembled">
            {fmtDateTime(r.generatedAt)} ·{" "}
            {r.auto ? "automatically" : (r.generatedBy?.name ?? "by hand")}
          </Row>
          <Row label="Signed off">
            {r.signedAt
              ? `${fmtDateTime(r.signedAt)}${r.signedBy?.name ? ` · ${r.signedBy.name}` : ""}`
              : "—"}
          </Row>
          <Row label="Sent">
            {r.sentAt
              ? `${fmtDateTime(r.sentAt)} · ${r.recipients.join(", ")}`
              : "—"}
          </Row>
          <Row label={r.recipients.length ? "Sent to" : "Will go to"}>
            <Recipients r={r} />
          </Row>
        </dl>

        <label className="flex cursor-pointer items-start gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={placeholders}
            onChange={(e) => onPlaceholders(e.target.checked)}
            className="mt-0.5 size-3.5 accent-[var(--primary)]"
          />
          <span>
            Show placeholder sections (backlinks, AI visibility). They are never
            printed or e-mailed.
          </span>
        </label>
        <SendDialog r={r} open={sending} onClose={() => setSending(false)} />
      </Card>
    </aside>
  );
}

/** Report recipients with where each one comes from (merchant contact or typed by hand). */
function Recipients({ r }: { r: Report }) {
  if (r.recipients.length) return <>{r.recipients.join(", ")}</>;
  const { fromMerchant, manual } = r.recipientSources;
  const extra = manual.filter((e) => !fromMerchant.some((c) => c.email === e));
  if (!fromMerchant.length && !extra.length)
    return <span className="text-warning-text">Nobody yet — link a merchant with an Owner or Marketing contact, or add addresses in SEO → Site settings.</span>;
  return (
    <ul className="flex flex-col gap-1">
      {fromMerchant.map((c) => (
        <li key={c.email} className="flex flex-wrap items-center gap-1">
          <span className="break-all">{c.email}</span>
          <span className="text-muted-foreground">· {c.role}</span>
        </li>
      ))}
      {extra.map((e) => (
        <li key={e} className="flex flex-wrap items-center gap-1">
          <span className="break-all">{e}</span>
          <span className="text-muted-foreground">· added by hand</span>
        </li>
      ))}
    </ul>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="font-medium uppercase tracking-wide text-[11px] text-muted-foreground">
        {label}
      </dt>
      <dd className="break-words text-foreground">{children}</dd>
    </div>
  );
}

function SendDialog({
  r,
  open,
  onClose,
}: {
  r: Report;
  open: boolean;
  onClose: () => void;
}) {
  const send = useSendReport();
  const { toast } = useToast();
  const [text, setText] = useState("");
  useEffect(() => {
    if (open)
      setText(
        (r.recipients.length ? r.recipients : r.defaultRecipients).join(", "),
      );
  }, [open, r.recipients, r.defaultRecipients]);
  const list = text
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const bad = list.filter((e) => !EMAIL_RE.test(e));
  return (
    <Dialog
      open={open}
      onClose={onClose}
      icon={<Mail className="size-5" />}
      tone="primary"
      title="Send the report"
      description="The client gets the report as an email, sent through Gmail from the Google account connected for SEO (it shows in that mailbox's Sent folder)."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={send.isPending}
            disabled={!list.length || bad.length > 0}
            onClick={() =>
              send.mutate(
                { id: r.id, recipients: list },
                {
                  onSuccess: () => {
                    onClose();
                    toast({
                      variant: "success",
                      title: `Sent to ${list.length} recipient${list.length === 1 ? "" : "s"}`,
                    });
                  },
                  onError: (e) =>
                    toast({
                      variant: "error",
                      title: "Couldn't send",
                      description: e.messages?.[0] ?? e.message,
                    }),
                },
              )
            }
          >
            Send
          </Button>
        </>
      }
    >
      <Field
        label="Recipients"
        hint="Pre-filled with the merchant's Owner / Marketing contacts plus the extra addresses from SEO → Site settings. Separate with commas."
        error={
          bad.length ? `Not an email address: ${bad.join(", ")}` : undefined
        }
      >
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          placeholder="owner@restaurant.com"
        />
      </Field>
    </Dialog>
  );
}
