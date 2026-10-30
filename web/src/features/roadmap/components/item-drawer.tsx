"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Trash2 } from "lucide-react";
import { Badge, Button, Drawer, Field, Input, Select, Textarea, useToast } from "@/components/ui";
import { AREAS, AREA_LABEL, PRIORITY_LABEL, STATUSES, STATUS_LABEL, STATUS_TONE, monthRange, shortDate } from "../format";
import { useCreateItem, useDeleteItem, useUpdateItem } from "../queries";
import type { Area, ItemInput, ItemStatus, Phase, Priority, Roadmap, RoadmapItem } from "../types";

type Draft = {
  phaseId: string;
  title: string;
  description: string;
  area: Area;
  status: ItemStatus;
  priority: Priority;
  ownerId: string;
  targetDate: string;
  notes: string;
  link: string;
};

const blank = (phaseId: string): Draft => ({
  phaseId, title: "", description: "", area: "PLATFORM", status: "TODO", priority: "NORMAL", ownerId: "",
  targetDate: "", notes: "", link: "",
});

const fromItem = (i: RoadmapItem): Draft => ({
  phaseId: i.phaseId, title: i.title, description: i.description ?? "", area: i.area, status: i.status,
  priority: i.priority, ownerId: i.ownerId ?? "", targetDate: i.targetDate ?? "", notes: i.notes ?? "",
  link: i.link ?? "",
});

/** Only the fields that changed, with "" sent as null so a field can be cleared. */
function diff(before: Draft, after: Draft, allowed: (keyof Draft)[]): ItemInput {
  const out: Record<string, string | null> = {};
  for (const k of allowed) {
    if (before[k] !== after[k]) out[k] = after[k] === "" ? null : after[k];
  }
  return out as ItemInput;
}

const OWNER_FIELDS: (keyof Draft)[] = ["status", "targetDate", "notes"];
const ALL_FIELDS: (keyof Draft)[] = ["phaseId", "title", "description", "area", "status", "priority", "ownerId",
  "targetDate", "notes", "link"];

/**
 * View or edit one roadmap item. Admins edit everything; the item's owner can
 * change its status, target date and notes; everyone else reads it.
 * `item === null` with a `newInPhase` opens it as a new item (admins only).
 */
export function ItemDrawer({
  data,
  item,
  newInPhase,
  onClose,
}: {
  data: Roadmap;
  item: RoadmapItem | null;
  newInPhase: string | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const update = useUpdateItem();
  const create = useCreateItem();
  const remove = useDeleteItem();
  const open = Boolean(item || newInPhase);
  const isNew = !item && Boolean(newInPhase);
  const [draft, setDraft] = useState<Draft>(blank(newInPhase ?? ""));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(item ? fromItem(item) : blank(newInPhase ?? data.phases[0]?.id ?? ""));
    setConfirmDelete(false);
    setError(null);
  }, [item, newInPhase, data.phases]);

  const isOwner = Boolean(item && item.ownerId && item.ownerId === data.me);
  const canAll = data.canManage;
  const canSome = canAll || isOwner;
  const editable = (k: keyof Draft) => canAll || (isOwner && OWNER_FIELDS.includes(k));
  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setDraft((d) => ({ ...d, [k]: e.target.value }));
  const owner = data.owners.find((o) => o.id === (item?.ownerId ?? ""));
  const phase: Phase | undefined = data.phases.find((p) => p.id === draft.phaseId);
  const changes = item ? diff(fromItem(item), draft, canAll ? ALL_FIELDS : OWNER_FIELDS) : {};
  const dirty = isNew ? draft.title.trim().length > 0 : Object.keys(changes).length > 0;

  const save = () => {
    setError(null);
    const fail = (e: { messages: string[] }) => setError(e.messages.join(" · "));
    if (isNew) {
      if (!draft.title.trim()) return setError("Give the item a title.");
      const input = diff(blank(draft.phaseId), draft, ALL_FIELDS);
      create.mutate(
        { ...input, phaseId: draft.phaseId, title: draft.title.trim(), area: draft.area },
        { onSuccess: () => { toast({ variant: "success", title: "Item added" }); onClose(); }, onError: fail },
      );
      return;
    }
    if (!item) return;
    update.mutate(
      { id: item.id, input: changes },
      { onSuccess: () => { toast({ variant: "success", title: "Saved" }); onClose(); }, onError: fail },
    );
  };

  const del = () => {
    if (!item) return;
    remove.mutate(item.id, {
      onSuccess: () => { toast({ variant: "success", title: "Item deleted" }); onClose(); },
      onError: (e) => setError(e.messages.join(" · ")),
    });
  };

  const readOnlyText = (v?: string | null) => (v ? <p className="whitespace-pre-line text-sm text-foreground">{v}</p>
    : <p className="text-sm text-muted-foreground">—</p>);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      size="lg"
      title={isNew ? "New roadmap item" : item?.title}
      description={isNew ? `In ${phase?.name ?? "this phase"}` : phase ? `${phase.name} · ${monthRange(phase.startMonth, phase.endMonth)}` : undefined}
      footer={
        canSome || isNew ? (
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            {canAll && item ? (
              confirmDelete ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Delete this item?</span>
                  <Button variant="destructive" size="sm" loading={remove.isPending} onClick={del}>Delete</Button>
                  <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>Keep</Button>
                </div>
              ) : (
                <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}>
                  <Trash2 className="size-4" /> Delete
                </Button>
              )
            ) : <span />}
            <div className="flex gap-2">
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button variant="default" disabled={!dirty} loading={update.isPending || create.isPending} onClick={save}>
                {isNew ? "Add item" : "Save"}
              </Button>
            </div>
          </div>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-4">
        {!canSome && !isNew && (
          <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
            Only admins and the item&apos;s owner can change it.
          </p>
        )}
        {isOwner && !canAll && (
          <p className="rounded-lg bg-accent px-3 py-2 text-sm text-primary-subtle-foreground">
            This is yours: you can update the status, target date and notes.
          </p>
        )}

        {canAll ? (
          <Field label="Title" htmlFor="rm-title" required>
            <Input id="rm-title" value={draft.title} maxLength={200} onChange={set("title")} />
          </Field>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Status" htmlFor="rm-status">
            {editable("status") ? (
              <Select id="rm-status" value={draft.status} onChange={set("status")}>
                {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
              </Select>
            ) : (
              <div><Badge tone={STATUS_TONE[draft.status]}>{STATUS_LABEL[draft.status]}</Badge></div>
            )}
          </Field>
          <Field label="Owner" htmlFor="rm-owner">
            {editable("ownerId") ? (
              <Select id="rm-owner" value={draft.ownerId} onChange={set("ownerId")}>
                <option value="">Unassigned</option>
                {data.owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </Select>
            ) : (
              <p className="text-sm text-foreground">{owner ? owner.name : <span className="text-muted-foreground">Unassigned</span>}</p>
            )}
          </Field>
          <Field label="Target date" htmlFor="rm-target">
            {editable("targetDate") ? (
              <Input id="rm-target" type="date" value={draft.targetDate} onChange={set("targetDate")} />
            ) : (
              <p className="text-sm text-foreground">{shortDate(draft.targetDate) || <span className="text-muted-foreground">None</span>}</p>
            )}
          </Field>
          {canAll ? (
            <Field label="Priority" htmlFor="rm-priority">
              <Select id="rm-priority" value={draft.priority} onChange={set("priority")}>
                {(["HIGH", "NORMAL", "LOW"] as Priority[]).map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
              </Select>
            </Field>
          ) : (
            <Field label="Priority"><p className="text-sm text-foreground">{PRIORITY_LABEL[draft.priority]}</p></Field>
          )}
          {canAll ? (
            <Field label="Area" htmlFor="rm-area">
              <Select id="rm-area" value={draft.area} onChange={set("area")}>
                {AREAS.map((a) => <option key={a} value={a}>{AREA_LABEL[a]}</option>)}
              </Select>
            </Field>
          ) : (
            <Field label="Area"><p className="text-sm text-foreground">{AREA_LABEL[draft.area]}</p></Field>
          )}
          {canAll ? (
            <Field label="Phase" htmlFor="rm-phase">
              <Select id="rm-phase" value={draft.phaseId} onChange={set("phaseId")}>
                {data.phases.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </Field>
          ) : null}
        </div>

        <Field label="What it is" htmlFor="rm-desc">
          {canAll ? (
            <Textarea id="rm-desc" rows={3} maxLength={4000} value={draft.description} onChange={set("description")} />
          ) : readOnlyText(draft.description)}
        </Field>

        <Field label="Notes" htmlFor="rm-notes" hint={editable("notes") ? "Progress, blockers, decisions" : undefined}>
          {editable("notes") ? (
            <Textarea id="rm-notes" rows={4} maxLength={4000} value={draft.notes} onChange={set("notes")} />
          ) : readOnlyText(draft.notes)}
        </Field>

        <Field label="Link" htmlFor="rm-link" hint={canAll ? "A pull request, doc or ticket (https://…)" : undefined}>
          {canAll ? (
            <Input id="rm-link" type="url" placeholder="https://" value={draft.link} onChange={set("link")} />
          ) : draft.link ? (
            <a href={draft.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-primary underline underline-offset-2">
              {draft.link} <ExternalLink className="size-3.5" aria-hidden />
            </a>
          ) : readOnlyText(null)}
        </Field>

        {item && (
          <p className="text-xs text-muted-foreground">
            {item.status === "DONE" && item.doneOn ? `Done on ${shortDate(item.doneOn)}. ` : ""}
            {item.updatedByEmail && item.updatedByEmail !== "seed" ? `Last changed by ${item.updatedByEmail}.` : ""}
          </p>
        )}
        {error && (
          <p role="alert" className="rounded-lg bg-destructive-subtle px-3 py-2 text-sm text-text-destructive">{error}</p>
        )}
      </div>
    </Drawer>
  );
}
