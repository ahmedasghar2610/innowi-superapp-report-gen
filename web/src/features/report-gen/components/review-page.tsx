"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CircleCheck, Pencil, Send, Trash2 } from "lucide-react";
import { Button, Card, Dialog, ErrorState, Field, Skeleton, Textarea, useToast } from "@/components/ui";
import { useApprove, useDeleteReport, useEditText, useReport, useSendReport } from "../api";
import { dateTime } from "../format";
import type { Recommendation, Report, Snapshot } from "../types";
import { StatusBadge } from "./queue-page";
import { ReportDocument } from "./report-document";
import { ExportButtons, FrozenBanner, NeverInThisReport, PreviewOptions, ReportSetup } from "./report-setup";

/**
 * /report-gen/[reportId] — the merchant report, laid out as the approved
 * prototype: the document on the left, review actions and report setup on the
 * right.
 *
 * Not built, for want of backing data (see the build notes): the headline-card
 * sparklines and the per-section six-month trend bars, which need a metric
 * series the API does not expose; and the prototype's "Held for missing data"
 * banner, which has no matching state in the lifecycle
 * (generating → draft → edited → approved → sent | failed | deleted).
 */
export function ReviewPage({ id }: { id: string }) {
  const q = useReport(id);
  const r = q.data;
  const [merchantView, setMerchantView] = useState(false);

  useEffect(() => {
    if (r?.merchant) document.title = `${r.merchant.name} — ${r.period.label} report — Innowi`;
  }, [r?.merchant, r?.period.label]);

  if (q.error) return <ErrorState title="Couldn't load the report" description={q.error.message} />;
  if (!r) return <Skeleton className="h-[40rem] w-full" />;
  const snap = r.snapshot as Snapshot;
  const hasSnapshot = !!snap && !!snap.sections;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 xl:grid-cols-[minmax(0,1fr)_21rem]">
      <div className="order-2 min-w-0 xl:order-1">
        <div className="mx-auto flex w-full max-w-[940px] flex-col gap-4">
          <FrozenBanner r={r} />
          {hasSnapshot ? (
            <Document r={r} snap={snap} merchantView={merchantView} />
          ) : (
            <Card className="p-5 text-sm text-muted-foreground">{r.error ?? "This report has no snapshot yet."}</Card>
          )}
        </div>
      </div>
      <aside className="order-1 flex flex-col gap-4 xl:sticky xl:top-0 xl:order-2">
        <ReviewPanel r={r} />
        {hasSnapshot && (
          <>
            <PreviewOptions merchantView={merchantView} onChange={setMerchantView} />
            <ReportSetup r={r} snap={snap} />
          </>
        )}
        <NeverInThisReport />
      </aside>
    </div>
  );
}

/* ------------------------------------------------------------ document ---- */
/** The document, with the reviewer's editable text folded into it. */
function Document({ r, snap, merchantView }: { r: Report; snap: Snapshot; merchantView: boolean }) {
  const edit = useEditText();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [summary, setSummary] = useState(snap.summary.join("\n\n"));
  const [bottom, setBottom] = useState(snap.bottomLine);
  const [recs, setRecs] = useState<Recommendation[]>(snap.recommendations);

  useEffect(() => {
    setSummary(snap.summary.join("\n\n"));
    setBottom(snap.bottomLine);
    setRecs(snap.recommendations);
  }, [snap]);

  // Only a draft can be edited, and never in the merchant preview.
  const canEdit = r.canManage && (r.status === "draft" || r.status === "edited") && !merchantView;

  const save = () =>
    edit.mutate(
      { id: r.id, patch: { summary: summary.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean), bottomLine: bottom, recommendations: recs } },
      {
        onSuccess: () => {
          setEditing(false);
          toast({ variant: "success", title: "Text saved" });
        },
        onError: (e) => toast({ variant: "error", title: "Couldn't save", description: e.message }),
      },
    );

  return (
    <>
      <ReportDocument snap={snap} merchantView={merchantView}>
        {editing ? (
          <Field label="Summary (one paragraph per blank line)" className="mt-4">
            <Textarea rows={6} value={summary} onChange={(e) => setSummary(e.target.value)} />
          </Field>
        ) : (
          <div className="mt-4 flex flex-col gap-2 text-sm leading-6 text-foreground">
            {snap.summary.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
            {canEdit && (
              <Button size="xs" variant="ghost" className="mt-1 self-start" onClick={() => setEditing(true)}>
                <Pencil /> Edit the written text
              </Button>
            )}
          </div>
        )}
      </ReportDocument>

      {editing && (
        <Card className="flex flex-col gap-4 p-5" data-testid="report-text-editor">
          <div>
            <h2 className="text-base font-semibold text-foreground">Recommendations</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">Figures never change through an edit — only the written text does.</p>
          </div>
          <div className="flex flex-col gap-3">
            {recs.map((rec, i) => (
              <div key={i} className="grid gap-2 rounded-lg border border-border p-3 md:grid-cols-2">
                <Field label="Action" className="md:col-span-2">
                  <Textarea rows={2} value={rec.action} onChange={(e) => setRecs(recs.map((x, j) => (j === i ? { ...x, action: e.target.value } : x)))} />
                </Field>
                <Field label="Why">
                  <Textarea rows={2} value={rec.why} onChange={(e) => setRecs(recs.map((x, j) => (j === i ? { ...x, why: e.target.value } : x)))} />
                </Field>
                <div className="flex flex-col gap-2">
                  <Field label="Owner">
                    <Textarea rows={1} value={rec.owner} onChange={(e) => setRecs(recs.map((x, j) => (j === i ? { ...x, owner: e.target.value } : x)))} />
                  </Field>
                  <Field label="Target for next month">
                    <Textarea rows={1} value={rec.target} onChange={(e) => setRecs(recs.map((x, j) => (j === i ? { ...x, target: e.target.value } : x)))} />
                  </Field>
                </div>
                <Button size="xs" variant="ghost" className="justify-self-start" onClick={() => setRecs(recs.filter((_, j) => j !== i))}>
                  Remove
                </Button>
              </div>
            ))}
            <Button size="sm" variant="outline" className="self-start" onClick={() => setRecs([...recs, { action: "", why: "", owner: "Innowi", target: "" }])}>
              Add recommendation
            </Button>
          </div>
          <Field label="Bottom line">
            <Textarea rows={3} value={bottom} onChange={(e) => setBottom(e.target.value)} />
          </Field>
          <div className="flex gap-2">
            <Button size="sm" variant="default" loading={edit.isPending} onClick={save}>
              Save text
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </Card>
      )}
    </>
  );
}

/* ---------------------------------------------------------- review panel ---- */
function ReviewPanel({ r }: { r: Report }) {
  const approve = useApprove();
  const del = useDeleteReport();
  const send = useSendReport();
  const { toast } = useToast();
  const [confirm, setConfirm] = useState<"delete" | "send" | null>(null);
  const isDraft = r.status === "draft" || r.status === "edited";
  const canSend = r.canApprove && (r.status === "approved" || (r.status === "failed" && !!r.approvedAt)) && !r.sentAt;
  const canDelete = r.canManage && ["draft", "edited", "approved", "failed"].includes(r.status);

  return (
    <>
      <Card className="flex flex-col gap-4 p-4">
        <Link href="/report-gen" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline">
          <ArrowLeft className="size-3.5" /> Back to the queue
        </Link>
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge s={r.status} />
            <span className="text-xs text-muted-foreground">Version {r.version}</span>
          </div>
          <h2 className="text-lg font-semibold tracking-[-0.006em] text-foreground">{r.merchant?.name ?? "Merchant"}</h2>
          <p className="text-xs text-muted-foreground">{r.period.label} · monthly report</p>
          {r.error && <p className="text-xs text-text-destructive">{r.error}</p>}
        </div>

        <div className="flex flex-col gap-2">
          {isDraft && r.canApprove && (
            <Button
              variant="default"
              loading={approve.isPending}
              disabled={!!r.approveBlocked}
              title={r.approveBlocked ?? undefined}
              onClick={() =>
                approve.mutate(r.id, {
                  onSuccess: () => toast({ variant: "success", title: "Approved — snapshot frozen" }),
                  onError: (e) => toast({ variant: "error", title: "Couldn't approve", description: e.message }),
                })
              }
            >
              <CircleCheck /> Approve
            </Button>
          )}
          {isDraft && r.approveBlocked && <p className="text-xs text-muted-foreground">{r.approveBlocked}</p>}
          <ExportButtons r={r} />
          {canSend && (
            <Button variant="outline" onClick={() => setConfirm("send")}>
              <Send /> {r.sendMode === "live" ? "Send to merchant" : `Send (${r.sendMode})`}
            </Button>
          )}
          {canDelete && (
            <Button variant="ghost" onClick={() => setConfirm("delete")}>
              <Trash2 /> Delete
            </Button>
          )}
        </div>

        <div className="flex flex-col gap-1 text-xs text-muted-foreground">
          <div>Recipients: {r.defaultRecipients.length ? r.defaultRecipients.join(", ") : "none on file (add an OWNER or MARKETING contact with an e-mail)"}</div>
          {r.generatedBy && (
            <div>
              Generated by {r.generatedBy.name} · {dateTime(r.generatedAt)}
            </div>
          )}
          {r.approvedBy && (
            <div>
              Approved by {r.approvedBy.name} · {dateTime(r.approvedAt)}
            </div>
          )}
          {r.sentAt && <div>Sent · {dateTime(r.sentAt)}</div>}
          {r.deletedBy && (
            <div>
              Deleted by {r.deletedBy.name} · {dateTime(r.deletedAt)}
            </div>
          )}
          {r.missing.length > 0 && (
            <div>
              {r.missing.length} figure{r.missing.length === 1 ? "" : "s"} not supplied
            </div>
          )}
        </div>

        {r.history.length > 0 && (
          <div>
            <div className="mb-1 text-xs font-medium text-foreground">History</div>
            <ol className="flex flex-col gap-1 text-xs text-muted-foreground">
              {r.history.map((h, i) => (
                <li key={i}>
                  {dateTime(h.at)} · {h.action.replace("_", " ")} v{h.version}
                  {h.user ? ` · ${h.user.name}` : ""}
                  {h.note ? ` · ${h.note}` : ""}
                </li>
              ))}
            </ol>
          </div>
        )}
      </Card>

      <Dialog
        open={confirm === "delete"}
        onClose={() => setConfirm(null)}
        title="Delete this report?"
        description="The draft is hidden from the queue. Its history stays, and a new report can be generated for the same month."
        tone="danger"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              loading={del.isPending}
              onClick={() =>
                del.mutate(r.id, {
                  onSuccess: () => {
                    setConfirm(null);
                    toast({ variant: "success", title: "Report deleted" });
                  },
                  onError: (e) => toast({ variant: "error", title: "Couldn't delete", description: e.message }),
                })
              }
            >
              Delete
            </Button>
          </>
        }
      />

      <Dialog
        open={confirm === "send"}
        onClose={() => setConfirm(null)}
        title={r.sendMode === "live" ? "Send the approved report?" : `Send in ${r.sendMode} mode`}
        description={
          r.sendMode === "live"
            ? `The approved version goes to ${r.defaultRecipients.join(", ") || "nobody"}.`
            : "Dry run: the recipients and subject are recorded, nothing is e-mailed, and the report stays approved."
        }
        tone="primary"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="default"
              loading={send.isPending}
              onClick={() =>
                send.mutate(
                  { id: r.id },
                  {
                    onSuccess: (res) => {
                      setConfirm(null);
                      toast({
                        variant: "success",
                        title: res.send.status === "sent" ? "Sent" : "Dry run recorded",
                        description: `${res.send.subject} → ${res.send.recipients.join(", ")}`,
                      });
                    },
                    onError: (e) => toast({ variant: "error", title: "Couldn't send", description: e.message }),
                  },
                )
              }
            >
              {r.sendMode === "live" ? "Send" : "Run dry run"}
            </Button>
          </>
        }
      />
    </>
  );
}
