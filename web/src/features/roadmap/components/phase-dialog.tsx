"use client";

import { useEffect, useState } from "react";
import { Button, Dialog, Field, Input, Textarea, useToast } from "@/components/ui";
import { useDeletePhase, useSavePhase } from "../queries";
import type { Phase } from "../types";

/** Add or edit a phase (admins). `phase === null` adds one. */
export function PhaseDialog({ open, phase, onClose }: { open: boolean; phase: Phase | null; onClose: () => void }) {
  const { toast } = useToast();
  const save = useSavePhase();
  const remove = useDeletePhase();
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(phase?.name ?? "");
    setGoal(phase?.goal ?? "");
    setStart(phase?.startMonth.slice(0, 7) ?? "");
    setEnd(phase?.endMonth.slice(0, 7) ?? "");
    setError(null);
  }, [open, phase]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError("Give the phase a name.");
    if (!start || !end) return setError("Pick the first and last month.");
    if (end < start) return setError("The last month can't be before the first month.");
    save.mutate(
      { id: phase?.id, input: { name: name.trim(), goal: goal.trim() || null, startMonth: `${start}-01`, endMonth: `${end}-01` } },
      {
        onSuccess: () => { toast({ variant: "success", title: phase ? "Phase saved" : "Phase added" }); onClose(); },
        onError: (err) => setError(err.messages.join(" · ")),
      },
    );
  };

  const hasItems = (phase?.counts.total ?? 0) > 0;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={phase ? "Edit phase" : "New phase"}
      description="A phase is a stretch of work with a goal and target months."
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          {phase ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={hasItems}
              title={hasItems ? "Move or delete its items first" : undefined}
              loading={remove.isPending}
              onClick={() =>
                remove.mutate(phase.id, {
                  onSuccess: () => { toast({ variant: "success", title: "Phase deleted" }); onClose(); },
                  onError: (err) => setError(err.messages.join(" · ")),
                })
              }
            >
              Delete phase
            </Button>
          ) : <span />}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button variant="default" type="submit" form="phase-form" loading={save.isPending}>
              {phase ? "Save" : "Add phase"}
            </Button>
          </div>
        </div>
      }
    >
      <form id="phase-form" onSubmit={submit} className="flex flex-col gap-3">
        <Field label="Name" htmlFor="ph-name" required>
          <Input id="ph-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Goal" htmlFor="ph-goal" hint="What's true when this phase is done">
          <Textarea id="ph-goal" rows={3} maxLength={2000} value={goal} onChange={(e) => setGoal(e.target.value)} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="First month" htmlFor="ph-start" required>
            <Input id="ph-start" type="month" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="Last month" htmlFor="ph-end" required>
            <Input id="ph-end" type="month" value={end} onChange={(e) => setEnd(e.target.value)} />
          </Field>
        </div>
        {hasItems && phase && (
          <p className="text-xs text-muted-foreground">To delete this phase, move or delete its {phase.counts.total} items first.</p>
        )}
        {error && (
          <p role="alert" className="rounded-lg bg-destructive-subtle px-3 py-2 text-sm text-text-destructive">{error}</p>
        )}
      </form>
    </Dialog>
  );
}
