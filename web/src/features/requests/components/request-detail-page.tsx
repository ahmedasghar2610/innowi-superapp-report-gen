"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, Copy, Milestone, Pencil } from "lucide-react";
import { Badge, Button, Card, EmptyState, ErrorState, Skeleton, Textarea, useToast } from "@/components/ui";
import { STATUS_LABEL as RM_STATUS_LABEL, shortDate } from "@/features/roadmap/format";
import type { ItemStatus } from "@/features/roadmap/types";
import { AREA_LABEL, STATUS_LABEL, STATUS_TONE, TYPE_LABEL, URGENCY_LABEL, ago, linkLines } from "../labels";
import { useComment, useRequest } from "../queries";
import type { RequestDetail, RequestEvent, TriageStatus } from "../types";
import { VoteButton } from "./requests-page";
import { RequestFormDialog } from "./request-form-dialog";
import { ApproveDialog, StatusDialog } from "./triage-dialogs";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h2>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function eventText(e: RequestEvent): string {
  if (e.kind === "CREATED") return "sent the request";
  if (e.kind === "EDITED") return "edited the request";
  if (e.kind === "ROADMAP") return `put it on the roadmap: ${e.note ?? ""}`;
  if (e.fromStatus && e.toStatus && e.fromStatus !== e.toStatus)
    return `moved it to ${STATUS_LABEL[e.toStatus]}`;
  return "added a note";
}

function TriageCard({ r, onStatus, onApprove }: { r: RequestDetail; onStatus: (s: TriageStatus) => void; onApprove: () => void }) {
  const closed = r.status === "SHIPPED" || r.status === "DECLINED" || r.status === "DUPLICATE";
  const onRoadmap = r.status === "APPROVED" || r.status === "IN_PROGRESS";
  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold text-foreground">Triage</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">Only triage owners see this. Every decision is sent to the requester and everyone who upvoted.</p>
      <div className="mt-3 flex flex-col gap-2">
        {!onRoadmap && !closed && (
          <Button variant="default" onClick={onApprove}><Milestone className="size-4" /> Approve onto the roadmap</Button>
        )}
        {(r.status === "NEW" || r.status === "NEEDS_INFO") && (
          <Button variant="outline" onClick={() => onStatus("UNDER_REVIEW")}>Mark under review</Button>
        )}
        {!closed && r.status !== "NEEDS_INFO" && (
          <Button variant="outline" onClick={() => onStatus("NEEDS_INFO")}>Ask for more information</Button>
        )}
        {onRoadmap && r.status !== "IN_PROGRESS" && <Button variant="outline" onClick={() => onStatus("IN_PROGRESS")}>Mark in progress</Button>}
        {onRoadmap && <Button variant="outline" onClick={() => onStatus("SHIPPED")}><CheckCircle2 className="size-4" /> Mark shipped</Button>}
        {!closed && <Button variant="outline" onClick={() => onStatus("DUPLICATE")}>Merge into another request</Button>}
        {!closed && <Button variant="ghost" className="text-text-destructive" onClick={() => onStatus("DECLINED")}>Decline…</Button>}
        {closed && <Button variant="outline" onClick={() => onStatus("UNDER_REVIEW")}>Reopen</Button>}
      </div>
    </Card>
  );
}

/** Route /requests/[ref] — one request: details, upvotes, conversation, history and (for triage owners) decisions. */
export function RequestDetailPage({ refParam }: { refParam: string }) {
  const { toast } = useToast();
  const q = useRequest(refParam);
  const comment = useComment();
  const [body, setBody] = useState("");
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState<TriageStatus | null>(null);
  const [approving, setApproving] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);

  if (q.isPending) return <Skeleton className="h-96" />;
  if (q.isError) {
    if (q.error.status === 404)
      return <Card><EmptyState title="Request not found" description={`There's no request ${refParam}.`} /></Card>;
    return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  }
  const r = q.data;
  const answering = r.status === "NEEDS_INFO" && r.mine;

  const send = () => {
    if (!body.trim()) return;
    setCommentError(null);
    comment.mutate({ ref: r.ref, body: body.trim() }, {
      onSuccess: () => setBody(""),
      onError: (e) => setCommentError(e.messages.join(" · ")),
    });
  };
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast({ variant: "success", title: "Link copied" });
    } catch {
      /* clipboard blocked */
    }
  };
  const links = linkLines(r.links);

  return (
    <div className="flex flex-col gap-5">
      <Link href="/requests" className="inline-flex items-center gap-1 self-start text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> All requests
      </Link>

      <div className="flex items-start gap-4">
        <VoteButton row={r} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={STATUS_TONE[r.status]} icon={false}>{STATUS_LABEL[r.status]}</Badge>
            <span className="text-sm font-medium tabular-nums text-muted-foreground">{r.ref}</span>
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-[-0.011em] text-foreground">{r.title}</h1>
          <p className="mt-1 text-table text-muted-foreground">
            {r.mine ? "You" : r.requester.name} sent this {ago(r.createdAt)} · {r.votes} {r.votes === 1 ? "person needs" : "people need"} it
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button variant="ghost" size="icon-sm" onClick={copyLink} aria-label="Copy link"><Copy /></Button>
          {r.canEdit && <Button variant="outline" size="sm" onClick={() => setEditing(true)}><Pencil className="size-4" /> Edit</Button>}
        </div>
      </div>

      {(r.status === "NEEDS_INFO" || r.status === "DECLINED" || r.status === "DUPLICATE") && (r.decisionNote || r.duplicateOf) && (
        <Card className={r.status === "NEEDS_INFO" ? "border-warning bg-warning-soft/40 p-4" : "p-4"}>
          <div className="text-sm font-medium text-foreground">
            {r.status === "NEEDS_INFO" ? "More information needed" : r.status === "DECLINED" ? "Why it was declined" : "Merged"}
          </div>
          {r.duplicateOf && (
            <p className="mt-1 text-sm">Duplicate of <Link className="text-primary hover:underline" href={`/requests/${r.duplicateOf}`}>{r.duplicateOf}</Link> — upvotes moved there.</p>
          )}
          {r.decisionNote && <p className="mt-1 whitespace-pre-line text-sm text-foreground">{r.decisionNote}</p>}
          {answering && <p className="mt-2 text-xs text-muted-foreground">Reply below — your answer sends it back for review.</p>}
        </Card>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex flex-col gap-5">
          <Card className="flex flex-col gap-4 p-4">
            <Section title="What's needed"><p className="whitespace-pre-line text-sm text-foreground">{r.details}</p></Section>
            {r.why && <Section title="Why it matters"><p className="whitespace-pre-line text-sm text-foreground">{r.why}</p></Section>}
            {r.whoAffected && <Section title="Who it affects"><p className="text-sm text-foreground">{r.whoAffected}</p></Section>}
            {links.length > 0 && (
              <Section title="Links">
                <ul className="flex flex-col gap-1">
                  {links.map((l, i) => (
                    <li key={i} className="break-all text-sm">
                      {l.href ? <a href={l.href} target="_blank" rel="noreferrer noopener" className="text-primary hover:underline">{l.text}</a> : l.text}
                    </li>
                  ))}
                </ul>
              </Section>
            )}
          </Card>

          <Card className="p-4">
            <h2 className="text-sm font-semibold text-foreground">Conversation</h2>
            {r.commentList.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">No comments yet.</p>
            ) : (
              <ul className="mt-3 flex flex-col gap-3">
                {r.commentList.map((c) => (
                  <li key={c.id} className="rounded-lg bg-muted/50 px-3 py-2">
                    <div className="text-xs text-muted-foreground"><span className="font-medium text-foreground">{c.author.name}</span> · {ago(c.createdAt)}</div>
                    <p className="mt-1 whitespace-pre-line text-sm text-foreground">{c.body}</p>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3 flex flex-col gap-2">
              <Textarea
                aria-label="Add a comment"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={3}
                placeholder={answering ? "Answer the question…" : "Add details, an example, or say how it affects you…"}
                onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") send(); }}
              />
              {commentError && <p className="text-sm text-text-destructive" role="alert">{commentError}</p>}
              <div className="flex justify-end">
                <Button variant="default" size="sm" onClick={send} disabled={!body.trim() || comment.isPending}>
                  {comment.isPending ? "Sending…" : answering ? "Send answer" : "Comment"}
                </Button>
              </div>
            </div>
          </Card>
        </div>

        <div className="flex flex-col gap-5">
          {r.canTriage && <TriageCard r={r} onStatus={setStatus} onApprove={() => setApproving(true)} />}

          <Card className="flex flex-col gap-3 p-4 text-sm">
            <div className="flex justify-between gap-3"><span className="text-muted-foreground">Type</span><span className="text-right text-foreground">{TYPE_LABEL[r.type]}</span></div>
            <div className="flex justify-between gap-3"><span className="text-muted-foreground">Area</span><span className="text-right text-foreground">{AREA_LABEL[r.area]}</span></div>
            <div className="flex justify-between gap-3"><span className="text-muted-foreground">Urgency</span><span className="text-right text-foreground">{URGENCY_LABEL[r.urgency]}</span></div>
            <div className="flex justify-between gap-3"><span className="text-muted-foreground">From</span><span className="text-right text-foreground" title={r.requester.email}>{r.requester.name}</span></div>
            {r.roadmapItem && (
              <div className="rounded-lg border border-border p-3">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">On the roadmap</div>
                <Link href="/roadmap" className="mt-1 block font-medium text-primary hover:underline">{r.roadmapItem.title}</Link>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {r.roadmapItem.phaseName} · {RM_STATUS_LABEL[r.roadmapItem.status as ItemStatus] ?? r.roadmapItem.status}
                  {r.roadmapItem.targetDate ? ` · by ${shortDate(r.roadmapItem.targetDate)}` : ""}
                </div>
              </div>
            )}
            {r.voters.length > 0 && (
              <div>
                <div className="text-muted-foreground">Upvoted by</div>
                <div className="mt-1 text-foreground">{r.voters.join(", ")}</div>
              </div>
            )}
          </Card>

          <Card className="p-4">
            <h2 className="text-sm font-semibold text-foreground">History</h2>
            <ol className="mt-2 flex flex-col gap-2">
              {r.events.map((e) => (
                <li key={e.id} className="text-xs">
                  <span className="text-foreground">{e.actor ?? "Someone"}</span>{" "}
                  <span className="text-muted-foreground">{eventText(e)} · {ago(e.createdAt)}</span>
                  {e.note && e.kind === "STATUS" && <p className="mt-0.5 whitespace-pre-line text-muted-foreground">“{e.note}”</p>}
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>

      <RequestFormDialog open={editing} onClose={() => setEditing(false)} editing={r} />
      <StatusDialog request={r} status={status} onClose={() => setStatus(null)} />
      <ApproveDialog request={r} open={approving} onClose={() => setApproving(false)} />
    </div>
  );
}
