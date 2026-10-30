"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CircleCheck, Pencil, Send, Trash2 } from "lucide-react";
import { Badge, Button, Card, Dialog, ErrorState, Field, Skeleton, Textarea, useToast } from "@/components/ui";
import { useApprove, useDeleteReport, useEditText, useReport, useSendReport } from "../api";
import type { HeadlineCard, Metric, Recommendation, Report, Section, Snapshot } from "../types";
import { StatusBadge } from "./queue-page";

/* ------------------------------------------------------------ formatting ---- */
function fmtValue(m: Pick<Metric, "value" | "unit">): string {
  const v = m.value;
  if (v === null || v === undefined) return "not supplied";
  switch (m.unit) {
    case "usd":
      return `$${v.toLocaleString("en-US", { maximumFractionDigits: v % 1 ? 2 : 0 })}`;
    case "pct":
      return `${(v * 100).toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
    case "multiple":
      return `${v.toLocaleString("en-US", { maximumFractionDigits: 1 })}×`;
    case "position":
      return v.toLocaleString("en-US", { maximumFractionDigits: 1 });
    case "table":
      return `${v} row${v === 1 ? "" : "s"}`;
    default:
      return v.toLocaleString("en-US", { maximumFractionDigits: 1 });
  }
}

function fmtChange(c: number | null): string {
  if (c === null || c === undefined) return "";
  const sign = c >= 0 ? "+" : "−";
  return `${sign}${Math.abs(c * 100).toFixed(0)}%`;
}

function fmtDateTime(v: string | null): string {
  return v ? new Date(v).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "";
}

/* ---------------------------------------------------------------- page ---- */
/** /report-gen/[reportId] — the draft on the left, the review panel on the right. */
export function ReviewPage({ id }: { id: string }) {
  const q = useReport(id);
  const r = q.data;
  useEffect(() => {
    if (r?.merchant) document.title = `${r.merchant.name} — ${r.period.label} report — Innowi`;
  }, [r?.merchant, r?.period.label]);
  if (q.error) return <ErrorState title="Couldn't load the report" description={q.error.message} />;
  if (!r) return <Skeleton className="h-[40rem] w-full" />;
  const snap = r.snapshot as Snapshot;
  const hasSnapshot = !!snap && !!snap.sections;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="order-2 min-w-0 xl:order-1">
        <div className="mx-auto flex w-full max-w-[920px] flex-col gap-4">
          {hasSnapshot ? <Document r={r} snap={snap} /> : <Card className="p-5 text-sm text-muted-foreground">{r.error ?? "This report has no snapshot yet."}</Card>}
        </div>
      </div>
      <ReviewPanel r={r} />
    </div>
  );
}

/* ------------------------------------------------------------ document ---- */
function Document({ r, snap }: { r: Report; snap: Snapshot }) {
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
  const canEdit = r.canManage && (r.status === "draft" || r.status === "edited");
  const location = [snap.merchant.city, snap.merchant.state].filter(Boolean).join(", ");

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
      <Card className="p-6">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Monthly report · {snap.period.label}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-[-0.01em] text-foreground">{snap.merchant.name}</h1>
        <p className="text-sm text-muted-foreground">{[snap.merchant.cuisine, location].filter(Boolean).join(" · ")}</p>
        {snap.services.length > 0 && <p className="mt-2 text-xs text-muted-foreground">Services: {snap.services.join(" · ")}</p>}
      </Card>

      <Card className="p-5">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-foreground">Executive summary</h2>
          {canEdit && !editing && (
            <Button size="xs" variant="ghost" className="ml-auto" onClick={() => setEditing(true)}>
              <Pencil /> Edit text
            </Button>
          )}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          {snap.headline.map((c, i) => (
            <Headline key={`${c.section}-${c.id ?? i}`} c={c} />
          ))}
        </div>
        {editing ? (
          <Field label="Summary (one paragraph per blank line)" className="mt-4">
            <Textarea rows={6} value={summary} onChange={(e) => setSummary(e.target.value)} />
          </Field>
        ) : (
          <div className="mt-4 flex flex-col gap-2 text-sm text-foreground">
            {snap.summary.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
        )}
      </Card>

      {snap.sectionOrder.map((key) => {
        const s = snap.sections[key];
        return s ? <SectionCard key={key} s={s} /> : null;
      })}

      <Card className="p-5">
        <h2 className="text-base font-semibold text-foreground">Recommendations</h2>
        {editing ? (
          <div className="mt-3 flex flex-col gap-3">
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
        ) : snap.recommendations.length ? (
          <ol className="mt-3 flex list-decimal flex-col gap-2 pl-5 text-sm">
            {snap.recommendations.map((rec, i) => (
              <li key={i}>
                <span className="font-medium text-foreground">{rec.action}</span>
                {rec.why && <span className="text-muted-foreground"> — {rec.why}</span>}
                <div className="text-xs text-muted-foreground">
                  Owner: {rec.owner || "—"} · Target: {rec.target || "—"}
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">No recommendation is supported by this month&apos;s data.</p>
        )}
      </Card>

      <Card className="p-5">
        <h2 className="text-base font-semibold text-foreground">Bottom line</h2>
        {editing ? <Textarea className="mt-2" rows={3} value={bottom} onChange={(e) => setBottom(e.target.value)} /> : <p className="mt-2 text-sm text-foreground">{snap.bottomLine}</p>}
        {editing && (
          <div className="mt-3 flex gap-2">
            <Button size="sm" loading={edit.isPending} onClick={save}>
              Save text
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        )}
      </Card>

      <Card className="p-5">
        <h2 className="text-sm font-semibold text-foreground">Sources</h2>
        <p className="mt-1 text-xs text-muted-foreground">{snap.sources.length ? snap.sources.join(" · ") : "No live source this month."}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Figures cover {snap.period.label}. Attributed figures are modelled by the ad platform, not measured. A figure with no data shows &quot;not supplied&quot;, never zero. Prepared by Innowi Inc.
        </p>
      </Card>
    </>
  );
}

function Headline({ c }: { c: HeadlineCard }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="text-xs text-muted-foreground">{c.label}</div>
      <div className="text-lg font-semibold tabular-nums text-foreground">{fmtValue(c)}</div>
      <div className="text-xs text-muted-foreground">{c.value === null ? c.reasonText : [fmtChange(c.change), c.tag].filter(Boolean).join(" · ")}</div>
    </div>
  );
}

function SectionCard({ s }: { s: Section }) {
  if (!s.included) return null;
  const allMissing = s.metrics.length > 0 && s.metrics.every((m) => m.value === null);
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold text-foreground">{s.title}</h2>
        {s.dataThrough && <span className="ml-auto text-xs text-muted-foreground">Data through {s.dataThrough}</span>}
      </div>
      {allMissing ? (
        <p className="mt-2 text-sm text-muted-foreground">Not supplied this month. {s.caption}</p>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-3">
            {s.metrics
              .filter((m) => m.unit !== "table")
              .map((m) => (
                <div key={m.id} className="rounded-lg border border-border px-3 py-2">
                  <div className="text-xs text-muted-foreground">{m.label}</div>
                  <div className="text-sm font-semibold tabular-nums text-foreground">{fmtValue(m)}</div>
                  <div className="text-xs text-muted-foreground">
                    {m.value === null ? m.reasonText : [fmtChange(m.change) && `${fmtChange(m.change)} vs prior month`, m.tag].filter(Boolean).join(" · ")}
                  </div>
                </div>
              ))}
          </div>
          <Tables s={s} />
          {s.caption && <p className="mt-3 text-xs text-muted-foreground">{s.caption}</p>}
        </>
      )}
    </Card>
  );
}

const TABLE_LABELS: Record<string, string> = {
  topCampaigns: "Top campaigns",
  actions: "Actions from ads",
  topQueries: "Top searches",
  localQueries: "Local and near-me searches",
  topPages: "Top pages",
  devices: "By device",
  published: "Published this month",
  topPosts: "Top posts",
};

function Tables({ s }: { s: Section }) {
  const entries = Object.entries(s.tables).filter(([k, v]) => TABLE_LABELS[k] && Array.isArray(v) && (v as unknown[]).length > 0) as [string, Record<string, unknown>[]][];
  if (!entries.length) return null;
  return (
    <div className="mt-4 grid gap-4 md:grid-cols-2">
      {entries.map(([k, rows]) => {
        const cols = Object.keys(rows[0]).filter((c) => c !== "url");
        return (
          <div key={k}>
            <div className="mb-1 text-xs font-medium text-foreground">{TABLE_LABELS[k]}</div>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted-foreground">
                  {cols.map((c) => (
                    <th key={c} className="py-1 pr-2 font-medium capitalize">
                      {c.replace(/([A-Z])/g, " $1").toLowerCase()}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 10).map((row, i) => (
                  <tr key={i} className="border-t border-border">
                    {cols.map((c) => (
                      <td key={c} className="py-1 pr-2 tabular-nums">
                        {row[c] === null || row[c] === undefined ? "—" : String(row[c])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
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
    <aside className="order-1 xl:sticky xl:top-0 xl:order-2">
      <Card className="flex flex-col gap-4 p-4">
        <Link href="/report-gen" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline">
          <ArrowLeft className="size-3.5" /> Back to the queue
        </Link>
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge s={r.status} />
            <span className="text-xs text-muted-foreground">Version {r.version}</span>
            {r.frozen && <Badge tone="neutral" icon={false}>Snapshot frozen</Badge>}
          </div>
          <h2 className="text-lg font-semibold tracking-[-0.006em] text-foreground">{r.merchant?.name ?? "Merchant"}</h2>
          <p className="text-xs text-muted-foreground">{r.period.label} · monthly report</p>
          {r.error && <p className="text-xs text-text-destructive">{r.error}</p>}
        </div>

        <div className="flex flex-col gap-2">
          {isDraft && r.canApprove && (
            <Button
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
          {r.generatedBy && <div>Generated by {r.generatedBy.name} · {fmtDateTime(r.generatedAt)}</div>}
          {r.approvedBy && <div>Approved by {r.approvedBy.name} · {fmtDateTime(r.approvedAt)}</div>}
          {r.sentAt && <div>Sent · {fmtDateTime(r.sentAt)}</div>}
          {r.deletedBy && <div>Deleted by {r.deletedBy.name} · {fmtDateTime(r.deletedAt)}</div>}
          {r.missing.length > 0 && <div>{r.missing.length} figure{r.missing.length === 1 ? "" : "s"} not supplied</div>}
        </div>

        {r.history.length > 0 && (
          <div>
            <div className="mb-1 text-xs font-medium text-foreground">History</div>
            <ol className="flex flex-col gap-1 text-xs text-muted-foreground">
              {r.history.map((h, i) => (
                <li key={i}>
                  {fmtDateTime(h.at)} · {h.action.replace("_", " ")} v{h.version}
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
    </aside>
  );
}
