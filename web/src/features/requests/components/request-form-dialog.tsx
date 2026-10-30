"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Dialog, Field, Input, Select, Textarea, useToast } from "@/components/ui";
import { AREAS, AREA_LABEL, TYPES, TYPE_HINT, TYPE_LABEL, URGENCIES, URGENCY_LABEL } from "../labels";
import { useCreateRequest, useUpdateRequest } from "../queries";
import type { RequestArea, RequestDetail, RequestInput, RequestType, Urgency } from "../types";

type Draft = {
  type: RequestType;
  area: RequestArea;
  urgency: Urgency;
  title: string;
  details: string;
  why: string;
  whoAffected: string;
  links: string;
};

const blank: Draft = {
  type: "FEATURE", area: "SALES", urgency: "NORMAL", title: "", details: "", why: "", whoAffected: "", links: "",
};

const fromRequest = (r: RequestDetail): Draft => ({
  type: r.type, area: r.area, urgency: r.urgency, title: r.title, details: r.details, why: r.why ?? "",
  whoAffected: r.whoAffected ?? "", links: r.links ?? "",
});

/**
 * Send a new request, or edit one (the requester while it's New / Needs info;
 * triage owners any time). Opens the request after it's sent.
 */
export function RequestFormDialog({
  open,
  onClose,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  editing?: RequestDetail | null;
}) {
  const { toast } = useToast();
  const router = useRouter();
  const create = useCreateRequest();
  const update = useUpdateRequest();
  const [d, setD] = useState<Draft>(blank);
  const [errors, setErrors] = useState<Partial<Record<keyof Draft, string>>>({});
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setD(editing ? fromRequest(editing) : blank);
    setErrors({});
    setServerError(null);
  }, [open, editing]);

  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setD((x) => ({ ...x, [k]: e.target.value }));
  const busy = create.isPending || update.isPending;

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const next: typeof errors = {};
    if (d.title.trim().length < 3) next.title = "Give it a short title (at least 3 characters).";
    if (d.details.trim().length < 3) next.details = "Say what you need.";
    setErrors(next);
    if (Object.keys(next).length) return;
    setServerError(null);
    const input: RequestInput = {
      type: d.type, area: d.area, urgency: d.urgency, title: d.title.trim(), details: d.details.trim(),
      why: d.why.trim() || null, whoAffected: d.whoAffected.trim() || null, links: d.links.trim() || null,
    };
    const fail = (err: { messages: string[] }) => setServerError(err.messages.join(" · "));
    if (editing) {
      update.mutate({ ref: editing.ref, input }, {
        onSuccess: () => { toast({ variant: "success", title: "Request updated" }); onClose(); },
        onError: fail,
      });
      return;
    }
    create.mutate(input, {
      onSuccess: (r) => {
        toast({ variant: "success", title: `Sent as ${r.ref}`, description: "The triage team has been notified." });
        onClose();
        router.push(`/requests/${r.ref}`);
      },
      onError: fail,
    });
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissible={!busy}
      size="xl"
      title={editing ? `Edit ${editing.ref}` : "New request"}
      description={editing ? undefined : "An idea, a missing feature, something broken or in your way. One request per thing."}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="default" onClick={() => submit()} disabled={busy}>
            {busy ? "Saving…" : editing ? "Save changes" : "Send request"}
          </Button>
        </>
      }
    >
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Type" htmlFor="rq-type" hint={TYPE_HINT[d.type]} className="sm:col-span-1">
            <Select id="rq-type" value={d.type} onChange={set("type")}>
              {TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
            </Select>
          </Field>
          <Field label="Area" htmlFor="rq-area">
            <Select id="rq-area" value={d.area} onChange={set("area")}>
              {AREAS.map((a) => <option key={a} value={a}>{AREA_LABEL[a]}</option>)}
            </Select>
          </Field>
          <Field label="How urgent" htmlFor="rq-urgency">
            <Select id="rq-urgency" value={d.urgency} onChange={set("urgency")}>
              {URGENCIES.map((u) => <option key={u} value={u}>{URGENCY_LABEL[u]}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Title" htmlFor="rq-title" required error={errors.title}>
          <Input id="rq-title" value={d.title} onChange={set("title")} maxLength={200}
            placeholder="e.g. Sort the partner list A–Z" autoFocus={!editing} />
        </Field>
        <Field label="What do you need?" htmlFor="rq-details" required error={errors.details}
          hint="Describe it the way you'd explain it to a colleague. Steps, screens, examples.">
          <Textarea id="rq-details" value={d.details} onChange={set("details")} rows={5} maxLength={10000} />
        </Field>
        <Field label="Why does it matter?" htmlFor="rq-why" hint="The problem it solves, time it saves, deals it helps close.">
          <Textarea id="rq-why" value={d.why} onChange={set("why")} rows={3} maxLength={5000} />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Who does it affect?" htmlFor="rq-who" hint="A team, a role, or people by name.">
            <Input id="rq-who" value={d.whoAffected} onChange={set("whoAffected")} maxLength={300}
              placeholder="e.g. Sales team, Support" />
          </Field>
          <Field label="Links" htmlFor="rq-links" hint="Sheets, screenshots, emails. One per line.">
            <Textarea id="rq-links" value={d.links} onChange={set("links")} rows={2} maxLength={5000} />
          </Field>
        </div>
        {serverError && <p className="text-sm text-text-destructive" role="alert">{serverError}</p>}
        {/* Enter in a text field submits */}
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </Dialog>
  );
}
