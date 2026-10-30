"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Dialog, Field, Input, Select, Textarea, useToast } from "@/components/ui";
import { AREAS as RM_AREAS, AREA_LABEL as RM_AREA_LABEL, PRIORITY_LABEL, monthRange, phaseState } from "@/features/roadmap/format";
import { useRoadmap } from "@/features/roadmap/queries";
import type { Area, Priority } from "@/features/roadmap/types";
import { STATUS_LABEL } from "../labels";
import { useApprove, useSetStatus } from "../queries";
import type { RequestDetail, TriageStatus } from "../types";

const AREA_GUESS: Record<string, Area> = {
  SALES: "SALES", PARTNERS: "SALES", SUPPORT: "MERCHANTS", OPERATIONS: "MERCHANTS", MARKETING: "MARKETING",
  PAYMENTS: "MERCHANTS", REPORTING: "PLATFORM", PLATFORM: "PLATFORM", OTHER: "PLATFORM",
};
const PRIORITY_GUESS: Record<string, Priority> = { LOW: "LOW", NORMAL: "NORMAL", HIGH: "HIGH", BLOCKING: "HIGH" };

const COPY: Record<TriageStatus, { title: string; note: string; placeholder: string; required: boolean; button: string }> = {
  UNDER_REVIEW: { title: "Mark as under review", note: "Note (optional)", placeholder: "Anything the requester should know", required: false, button: "Mark under review" },
  NEEDS_INFO: { title: "Ask for more information", note: "What do you need to know?", placeholder: "e.g. Which columns should be sortable?", required: true, button: "Ask the requester" },
  IN_PROGRESS: { title: "Mark as in progress", note: "Note (optional)", placeholder: "", required: false, button: "Mark in progress" },
  SHIPPED: { title: "Mark as shipped", note: "What changed (optional)", placeholder: "e.g. Live on the Partners page — click a column header to sort.", required: false, button: "Mark shipped" },
  DECLINED: { title: "Decline this request", note: "Why?", placeholder: "Be specific: the requester and everyone who upvoted will read this.", required: true, button: "Decline" },
  DUPLICATE: { title: "Merge into another request", note: "Note (optional)", placeholder: "", required: false, button: "Merge" },
};

/** Set a triage status with a note (required for Declined / Needs info) or a duplicate target. */
export function StatusDialog({ request, status, onClose }: { request: RequestDetail; status: TriageStatus | null; onClose: () => void }) {
  const { toast } = useToast();
  const set = useSetStatus();
  const [note, setNote] = useState("");
  const [dup, setDup] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setNote("");
    setDup("");
    setError(null);
  }, [status]);

  if (!status) return null;
  const c = COPY[status];
  const submit = () => {
    if (c.required && !note.trim()) return setError("Please write a note.");
    if (status === "DUPLICATE" && !dup.trim()) return setError("Which request does this duplicate? e.g. R-1003");
    setError(null);
    set.mutate(
      { ref: request.ref, input: { status, note: note.trim() || null, duplicateOf: status === "DUPLICATE" ? dup.trim() : null } },
      {
        onSuccess: (r) => { toast({ variant: "success", title: `${r.ref} is now ${STATUS_LABEL[r.status].toLowerCase()}` }); onClose(); },
        onError: (e) => setError(e.messages.join(" · ")),
      },
    );
  };

  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!set.isPending}
      title={c.title}
      description={`${request.ref} · ${request.title}. The requester and everyone who upvoted or commented is told.`}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={set.isPending}>Cancel</Button>
          <Button variant={status === "DECLINED" ? "destructive" : "default"} onClick={submit} disabled={set.isPending}>
            {set.isPending ? "Saving…" : c.button}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {status === "DUPLICATE" && (
          <Field label="Duplicate of" htmlFor="rq-dup" required hint="Upvotes move to that request.">
            <Input id="rq-dup" value={dup} onChange={(e) => setDup(e.target.value)} placeholder="R-1003" />
          </Field>
        )}
        <Field label={c.note} htmlFor="rq-note" required={c.required}>
          <Textarea id="rq-note" value={note} onChange={(e) => setNote(e.target.value)} rows={4} placeholder={c.placeholder} />
        </Field>
        {error && <p className="text-sm text-text-destructive" role="alert">{error}</p>}
      </div>
    </Dialog>
  );
}

/** Approve onto the roadmap: a new item in a phase (default), or link an existing item. */
export function ApproveDialog({ request, open, onClose }: { request: RequestDetail; open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const roadmap = useRoadmap();
  const approve = useApprove();
  const [mode, setMode] = useState<"new" | "link">("new");
  const [phaseId, setPhaseId] = useState("");
  const [itemId, setItemId] = useState("");
  const [title, setTitle] = useState("");
  const [area, setArea] = useState<Area>("PLATFORM");
  const [priority, setPriority] = useState<Priority>("NORMAL");
  const [ownerId, setOwnerId] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const phases = useMemo(() => roadmap.data?.phases ?? [], [roadmap.data]);
  const items = useMemo(() => phases.flatMap((p) => p.items.filter((i) => i.status !== "DONE").map((i) => ({ ...i, phaseName: p.name }))), [phases]);

  useEffect(() => {
    if (!open) return;
    setMode("new");
    setTitle(request.title);
    setArea(AREA_GUESS[request.area] ?? "PLATFORM");
    setPriority(PRIORITY_GUESS[request.urgency] ?? "NORMAL");
    setOwnerId("");
    setTargetDate("");
    setNote("");
    setItemId("");
    setError(null);
  }, [open, request]);

  useEffect(() => {
    if (!open || phaseId || !phases.length) return;
    setPhaseId(phases.find((p) => phaseState(p, phases) === "now")?.id ?? phases[0].id);
  }, [open, phases, phaseId]);

  const submit = () => {
    setError(null);
    const fail = (e: { messages: string[] }) => setError(e.messages.join(" · "));
    const done = () => { toast({ variant: "success", title: `${request.ref} is on the roadmap` }); onClose(); };
    if (mode === "link") {
      if (!itemId) return setError("Pick the roadmap item it belongs to.");
      approve.mutate({ ref: request.ref, input: { itemId, note: note.trim() || null } }, { onSuccess: done, onError: fail });
      return;
    }
    if (!phaseId) return setError("Pick a phase.");
    if (title.trim().length < 3) return setError("Give the roadmap item a title.");
    approve.mutate(
      {
        ref: request.ref,
        input: { phaseId, title: title.trim(), roadmapArea: area, priority, ownerId: ownerId || null,
          targetDate: targetDate || null, note: note.trim() || null },
      },
      { onSuccess: done, onError: fail },
    );
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissible={!approve.isPending}
      size="xl"
      title="Approve onto the roadmap"
      description={`${request.ref} · ${request.title}. The requester and everyone who upvoted is told.`}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={approve.isPending}>Cancel</Button>
          <Button variant="default" onClick={submit} disabled={approve.isPending || roadmap.isPending}>
            {approve.isPending ? "Saving…" : "Approve"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div role="radiogroup" aria-label="Roadmap item" className="flex gap-4 text-sm">
          <label className="inline-flex items-center gap-1.5">
            <input type="radio" name="rq-mode" checked={mode === "new"} onChange={() => setMode("new")} className="accent-[var(--color-primary)]" />
            Add a new roadmap item
          </label>
          <label className="inline-flex items-center gap-1.5">
            <input type="radio" name="rq-mode" checked={mode === "link"} onChange={() => setMode("link")} disabled={!items.length}
              className="accent-[var(--color-primary)]" />
            Part of an existing item
          </label>
        </div>
        {roadmap.isError && <p className="text-sm text-text-destructive">The roadmap didn&apos;t load: {roadmap.error.messages.join(" · ")}</p>}
        {mode === "link" ? (
          <Field label="Roadmap item" htmlFor="rq-item" required>
            <Select id="rq-item" value={itemId} onChange={(e) => setItemId(e.target.value)}>
              <option value="">Choose…</option>
              {items.map((i) => <option key={i.id} value={i.id}>{i.phaseName} — {i.title}</option>)}
            </Select>
          </Field>
        ) : (
          <>
            <Field label="Phase" htmlFor="rq-phase" required>
              <Select id="rq-phase" value={phaseId} onChange={(e) => setPhaseId(e.target.value)} disabled={!phases.length}>
                {!phases.length && <option value="">No phases yet — add one on the Roadmap</option>}
                {phases.map((p) => <option key={p.id} value={p.id}>{p.name} ({monthRange(p.startMonth, p.endMonth)})</option>)}
              </Select>
            </Field>
            <Field label="Roadmap item title" htmlFor="rq-rtitle" required>
              <Input id="rq-rtitle" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
            </Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Roadmap area" htmlFor="rq-rarea">
                <Select id="rq-rarea" value={area} onChange={(e) => setArea(e.target.value as Area)}>
                  {RM_AREAS.map((a) => <option key={a} value={a}>{RM_AREA_LABEL[a]}</option>)}
                </Select>
              </Field>
              <Field label="Priority" htmlFor="rq-prio">
                <Select id="rq-prio" value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
                  {(["HIGH", "NORMAL", "LOW"] as Priority[]).map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
                </Select>
              </Field>
              <Field label="Owner" htmlFor="rq-owner">
                <Select id="rq-owner" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
                  <option value="">Unassigned</option>
                  {roadmap.data?.owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </Select>
              </Field>
              <Field label="Target date" htmlFor="rq-date">
                <Input id="rq-date" type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
              </Field>
            </div>
          </>
        )}
        <Field label="Note to the requester (optional)" htmlFor="rq-anote">
          <Textarea id="rq-anote" value={note} onChange={(e) => setNote(e.target.value)} rows={2}
            placeholder="e.g. Planned for the week of Nov 2" />
        </Field>
        {error && <p className="text-sm text-text-destructive" role="alert">{error}</p>}
      </div>
    </Dialog>
  );
}
