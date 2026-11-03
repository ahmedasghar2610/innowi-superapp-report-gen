"use client";

import { useEffect, useState } from "react";
import { Pencil } from "lucide-react";
import { Button, Card, ErrorState, Field, Skeleton, Textarea, useToast } from "@/components/ui";
import { useEditText, useReport } from "../api";
import type { Recommendation, Report, Snapshot } from "../types";
import { ReportDocument } from "./report-document";
import { FrozenBanner } from "./report-setup";
import { ReportSidebar } from "./report-sidebar";

/**
 * /report-gen/[reportId] — the merchant report, laid out as the approved
 * prototype: the document on the left, and on the right a five-tab toolkit
 * (Review · Edit · Preview · Details · Activity) — see report-sidebar.tsx.
 *
 * `editing` and `merchantView` live here because both the document and the
 * sidebar need them: the sidebar's Edit tab turns editing on, and the
 * textareas appear beside the text they change.
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
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (r?.merchant) document.title = `${r.merchant.name} — ${r.period.label} report — Innowi`;
  }, [r?.merchant, r?.period.label]);

  if (q.error) return <ErrorState title="Couldn't load the report" description={q.error.message} />;
  if (!r) return <Skeleton className="h-[40rem] w-full" />;
  const snap = r.snapshot as Snapshot;
  const hasSnapshot = !!snap && !!snap.sections;
  // Unchanged rule: only a draft can be edited, and never while previewing as
  // the merchant.
  const canEdit = r.canManage && (r.status === "draft" || r.status === "edited") && !merchantView;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 xl:grid-cols-[minmax(0,1fr)_21rem]">
      <div className="order-2 min-w-0 xl:order-1">
        <div className="mx-auto flex w-full max-w-[940px] flex-col gap-4">
          <FrozenBanner r={r} />
          {hasSnapshot ? (
            <Document r={r} snap={snap} merchantView={merchantView} editing={editing && canEdit} onEditing={setEditing} canEdit={canEdit} />
          ) : (
            <Card className="p-5 text-sm text-muted-foreground">{r.error ?? "This report has no snapshot yet."}</Card>
          )}
        </div>
      </div>
      {/*
        Height budget. `main` in the app shell is the scroll container and the
        h-16 topbar sits above it in normal flow, so `top-0` is already below
        the header — no header offset is needed. What is left below the sticky
        top is 100dvh − 64px (topbar) − 24px (main's pt-6), and 16px is kept
        back so the card's rounded bottom never sits flush against the edge.

        Below xl the sidebar stacks above the document, so it is capped harder:
        a tall card there would push the report itself off the screen.
      */}
      <aside className="order-1 flex max-h-[min(70dvh,34rem)] min-h-0 flex-col xl:sticky xl:top-0 xl:order-2 xl:max-h-[calc(100dvh-6.5rem)]">
        <ReportSidebar
          r={r}
          snap={hasSnapshot ? snap : null}
          merchantView={merchantView}
          onMerchantView={setMerchantView}
          editing={editing}
          onEditing={setEditing}
          canEdit={canEdit}
        />
      </aside>
    </div>
  );
}

/* ------------------------------------------------------------ document ---- */
/** The document, with the reviewer's editable text folded into it. */
function Document({
  r,
  snap,
  merchantView,
  editing,
  onEditing,
  canEdit,
}: {
  r: Report;
  snap: Snapshot;
  merchantView: boolean;
  editing: boolean;
  onEditing: (v: boolean) => void;
  canEdit: boolean;
}) {
  const edit = useEditText();
  const { toast } = useToast();
  const [summary, setSummary] = useState(snap.summary.join("\n\n"));
  const [bottom, setBottom] = useState(snap.bottomLine);
  const [recs, setRecs] = useState<Recommendation[]>(snap.recommendations);

  useEffect(() => {
    setSummary(snap.summary.join("\n\n"));
    setBottom(snap.bottomLine);
    setRecs(snap.recommendations);
  }, [snap]);

  const save = () =>
    edit.mutate(
      { id: r.id, patch: { summary: summary.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean), bottomLine: bottom, recommendations: recs } },
      {
        onSuccess: () => {
          onEditing(false);
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
              <Button size="xs" variant="ghost" className="mt-1 self-start" onClick={() => onEditing(true)}>
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
            <Button size="sm" variant="ghost" onClick={() => onEditing(false)}>
              Cancel
            </Button>
          </div>
        </Card>
      )}
    </>
  );
}
