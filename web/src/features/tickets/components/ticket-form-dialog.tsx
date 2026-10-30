"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Dialog, Field, Input, Select, Textarea, useToast } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import { useCreateTicket, useTicketCatalog, useTicketPeople, useTicketProjects, useUpdateTicket } from "../api";
import {
  PRIORITY_LABEL,
  PRIORITY_ORDER,
  REQUEST_TYPE_LABEL,
  TYPE_DOT,
  TYPE_LABEL,
  TYPE_ORDER,
  formatTarget,
} from "../labels";
import type {
  CreateTicketInput,
  TicketDetail,
  TicketPriority,
  TicketRequestType,
  TicketType,
  UpdateTicketInput,
} from "../types";
import { MerchantSelect, type MerchantValue } from "./merchant-select";
import { useTeamAvailability } from "@/features/settings/teams-api";

interface FormState {
  type: TicketType;
  title: string;
  description: string;
  category: string;
  subCategory: string;
  requestType: TicketRequestType;
  priority: TicketPriority;
  projectId: string;
  merchant: MerchantValue | null;
  assigneeId: string;
  dueDate: string;
  subtasks: string;
}

const EMPTY: FormState = {
  type: "DESIGN",
  title: "",
  description: "",
  category: "",
  subCategory: "",
  requestType: "NEW_REQUEST",
  priority: "MEDIUM",
  projectId: "",
  merchant: null,
  assigneeId: "",
  dueDate: "",
  subtasks: "",
};

function fromTicket(t: TicketDetail): FormState {
  return {
    type: t.type,
    title: t.title,
    description: t.description ?? "",
    category: t.category,
    subCategory: t.subCategory ?? "",
    requestType: t.requestType,
    priority: t.priority,
    projectId: t.project.id,
    merchant: t.merchant,
    assigneeId: t.assignee?.id ?? "",
    dueDate: t.dueDate ?? "",
    subtasks: "",
  };
}

export interface TicketFormDialogProps {
  open: boolean;
  onClose: () => void;
  /** Edit this ticket; omit to create a new one. */
  ticket?: TicketDetail;
  /** New ticket pre-linked to a merchant (merchant Tickets tab). */
  defaultMerchant?: MerchantValue | null;
  /** New ticket from a meeting's action item: prefilled fields + the link. */
  prefill?: Partial<Pick<FormState, "title" | "description" | "assigneeId" | "dueDate" | "projectId" | "merchant">>;
  actionItemId?: string;
  /** Called instead of opening the new ticket. */
  onCreated?: (key: string) => void;
}

/**
 * New / Edit ticket. Creating is two steps, as in the prototype: pick the
 * type (it sets the category list), then fill the form. Every ticket goes to
 * exactly one assignee; the merchant is optional (empty = internal work).
 */
export function TicketFormDialog({ open, onClose, ticket, defaultMerchant, prefill, actionItemId, onCreated }: TicketFormDialogProps) {
  const editing = !!ticket;
  const router = useRouter();
  const { toast } = useToast();
  const catalog = useTicketCatalog();
  const people = useTicketPeople();
  const projects = useTicketProjects();
  const create = useCreateTicket();
  const update = useUpdateTicket(ticket?.key ?? "");

  const [step, setStep] = useState<1 | 2>(editing ? 2 : 1);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [serverError, setServerError] = useState<string | null>(null);

  // Reset every time the dialog opens — keyed on ids, not objects, so a
  // background refetch (or a parent re-render) never wipes what's been typed.
  const ticketId = ticket?.id;
  const defaultMerchantId = defaultMerchant?.id;
  useEffect(() => {
    if (!open) return;
    setForm(ticket ? fromTicket(ticket) : { ...EMPTY, merchant: defaultMerchant ?? null, ...prefill });
    setStep(ticket ? 2 : 1);
    setErrors({});
    setServerError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ticketId, defaultMerchantId, actionItemId]);

  // Default the project to the first one once projects load (create only).
  useEffect(() => {
    if (open && !editing && !form.projectId && projects.data?.length) {
      setForm((f) => ({ ...f, projectId: projects.data[0].id }));
    }
  }, [open, editing, form.projectId, projects.data]);

  const spec = catalog.data?.types.find((t) => t.type === form.type);
  const categories = useMemo(() => spec?.categories ?? [], [spec]);
  const subCategories = useMemo(
    () => categories.find((c) => c.name === form.category)?.subCategories ?? [],
    [categories, form.category],
  );

  // Keep category / sub-category valid for the chosen type.
  useEffect(() => {
    if (!categories.length) return;
    if (!categories.some((c) => c.name === form.category)) {
      setForm((f) => ({ ...f, category: categories[0].name, subCategory: categories[0].subCategories[0] ?? "" }));
    } else if (subCategories.length && !subCategories.includes(form.subCategory)) {
      setForm((f) => ({ ...f, subCategory: subCategories[0] }));
    }
  }, [categories, subCategories, form.category, form.subCategory]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const availability = useTeamAvailability();
  const onLeave = useMemo(
    () => new Set((availability.data?.people ?? []).filter((p) => p.onLeave).map((p) => p.id)),
    [availability.data],
  );
  const activePeople = useMemo(() => people.data ?? [], [people.data]);
  const busy = create.isPending || update.isPending;

  const validate = (): boolean => {
    const e: Partial<Record<keyof FormState, string>> = {};
    if (!form.title.trim()) e.title = "Give the ticket a title";
    if (!form.projectId) e.projectId = "Choose a project";
    if (!form.category) e.category = "Choose a category";
    if (subCategories.length && !form.subCategory) e.subCategory = "Choose a sub-category";
    if (!form.assigneeId) e.assigneeId = "Every ticket needs one assignee";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = (andNew = false) => {
    setServerError(null);
    if (!validate()) return;
    const onError = (err: { messages?: string[]; message: string }) =>
      setServerError(err.messages?.join(" · ") ?? err.message);

    if (!editing) {
      const input: CreateTicketInput = {
        title: form.title.trim(),
        description: form.description.trim() || null,
        type: form.type,
        category: form.category,
        subCategory: form.subCategory || null,
        requestType: form.requestType,
        priority: form.priority,
        projectId: form.projectId,
        merchantId: form.merchant?.id ?? null,
        assigneeId: form.assigneeId,
        dueDate: form.dueDate || null,
        subtasks: form.subtasks
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
        ...(actionItemId ? { actionItemId } : {}),
      };
      create.mutate(input, {
        onSuccess: (t) => {
          toast({ variant: "success", title: `${t.key} created`, description: `Assigned to ${t.assignee?.name ?? "—"}.` });
          if (andNew) {
            // Keep the context (type, category, project, merchant) for the next one.
            setForm((f) => ({ ...EMPTY, type: f.type, category: f.category, subCategory: f.subCategory, requestType: f.requestType, projectId: f.projectId, merchant: f.merchant }));
            setErrors({});
            document.getElementById("t-title")?.focus();
            return;
          }
          onClose();
          if (onCreated) onCreated(t.key);
          else router.push(`/ops/tickets/${t.key}`);
        },
        onError,
      });
      return;
    }

    // Edit: send only what changed.
    const before = fromTicket(ticket);
    const diff: UpdateTicketInput = {};
    if (form.title.trim() !== before.title) diff.title = form.title.trim();
    if (form.description.trim() !== before.description) diff.description = form.description.trim() || null;
    if (form.type !== before.type) diff.type = form.type;
    if (form.category !== before.category) diff.category = form.category;
    if (form.subCategory !== before.subCategory) diff.subCategory = form.subCategory || null;
    if (form.requestType !== before.requestType) diff.requestType = form.requestType;
    if (form.priority !== before.priority) diff.priority = form.priority;
    if (form.projectId !== before.projectId) diff.projectId = form.projectId;
    if ((form.merchant?.id ?? null) !== (before.merchant?.id ?? null)) diff.merchantId = form.merchant?.id ?? null;
    if (form.assigneeId !== before.assigneeId) diff.assigneeId = form.assigneeId;
    if (form.dueDate !== before.dueDate) diff.dueDate = form.dueDate || null;
    if (Object.keys(diff).length === 0) return onClose();
    update.mutate(diff, {
      onSuccess: (t) => {
        toast({ variant: "success", title: `${t.key} updated` });
        onClose();
      },
      onError,
    });
  };

  // ---- step 1: type --------------------------------------------------------
  if (step === 1) {
    return (
      <Dialog
        open={open}
        onClose={onClose}
        size="xl"
        title="What kind of ticket is this?"
        description="The type sets the categories you can choose."
        footer={
          <>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="default" onClick={() => setStep(2)} disabled={!catalog.data}>
              Next
            </Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Ticket type">
          {TYPE_ORDER.map((type) => {
            const s = catalog.data?.types.find((t) => t.type === type);
            const selected = form.type === type;
            return (
              <button
                key={type}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => set("type", type)}
                onDoubleClick={() => {
                  set("type", type);
                  setStep(2);
                }}
                className={cn(
                  "flex flex-col gap-1.5 rounded-xl border p-4 text-left transition-colors",
                  selected ? "border-primary bg-accent ring-1 ring-primary" : "border-border bg-card hover:bg-accent/50",
                )}
              >
                <span className="flex items-center gap-2 text-base font-semibold text-foreground">
                  <span className={cn("size-2.5 rounded-sm", TYPE_DOT[type])} aria-hidden />
                  {s?.label ?? TYPE_LABEL[type]}
                </span>
                <span className="text-sm text-muted-foreground">{s?.description ?? ""}</span>
              </button>
            );
          })}
        </div>
      </Dialog>
    );
  }

  // ---- step 2: details -----------------------------------------------------
  return (
    <Dialog
      open={open}
      onClose={busy ? () => undefined : onClose}
      size="2xl"
      title={editing ? `Edit ${ticket.key}` : `New ${spec?.label ?? TYPE_LABEL[form.type]} ticket`}
      footerBordered
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          {editing ? (
            <span />
          ) : (
            <Button variant="ghost" onClick={() => setStep(1)} disabled={busy}>
              Change type
            </Button>
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            {!editing && !actionItemId ? (
              <Button variant="outline" onClick={() => submit(true)} disabled={busy}>
                Save &amp; new
              </Button>
            ) : null}
            <Button variant="default" onClick={() => submit()} loading={busy}>
              {editing ? "Save changes" : "Create ticket"}
            </Button>
          </div>
        </div>
      }
    >
      <div className="grid max-h-[62vh] gap-4 overflow-y-auto px-0.5 pb-1 sm:grid-cols-2">
        {serverError ? (
          <p role="alert" className="rounded-lg bg-destructive-subtle px-3 py-2 text-sm text-text-destructive sm:col-span-2">
            {serverError}
          </p>
        ) : null}

        <Field label="Title" htmlFor="t-title" required error={errors.title} className="sm:col-span-2">
          <Input
            id="t-title"
            value={form.title}
            maxLength={200}
            autoFocus
            onChange={(e) => set("title", e.target.value)}
            aria-invalid={!!errors.title}
            placeholder="e.g. New logo for storefront signage"
          />
        </Field>

        <Field label="Merchant" htmlFor="t-merchant" hint="Leave empty for internal work">
          <MerchantSelect id="t-merchant" value={form.merchant} onChange={(m) => set("merchant", m)} />
        </Field>

        <Field label="Project" htmlFor="t-project" required error={errors.projectId}>
          <Select id="t-project" value={form.projectId} onChange={(e) => set("projectId", e.target.value)} aria-invalid={!!errors.projectId}>
            <option value="" disabled>
              Choose…
            </option>
            {(projects.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>

        {editing ? (
          <Field label="Type" htmlFor="t-type" required>
            <Select id="t-type" value={form.type} onChange={(e) => set("type", e.target.value as TicketType)}>
              {TYPE_ORDER.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABEL[t]}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}

        <Field label="Category" htmlFor="t-cat" required error={errors.category}>
          <Select id="t-cat" value={form.category} onChange={(e) => set("category", e.target.value)}>
            {categories.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Sub-category" htmlFor="t-sub" required error={errors.subCategory}>
          <Select id="t-sub" value={form.subCategory} onChange={(e) => set("subCategory", e.target.value)}>
            {subCategories.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Priority"
          htmlFor="t-pri"
          required
          hint={(() => {
            const p = catalog.data?.sla.find((x) => x.priority === form.priority);
            return p ? `SLA: respond within ${formatTarget(p.responseHours)}, resolve within ${formatTarget(p.resolutionHours)}` : undefined;
          })()}
        >
          <Select id="t-pri" value={form.priority} onChange={(e) => set("priority", e.target.value as TicketPriority)}>
            {PRIORITY_ORDER.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABEL[p]}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Request type" htmlFor="t-req" required>
          <Select id="t-req" value={form.requestType} onChange={(e) => set("requestType", e.target.value as TicketRequestType)}>
            {(Object.keys(REQUEST_TYPE_LABEL) as TicketRequestType[]).map((r) => (
              <option key={r} value={r}>
                {REQUEST_TYPE_LABEL[r]}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Assignee" htmlFor="t-assignee" required error={errors.assigneeId} hint="One person owns this ticket">
          <Select
            id="t-assignee"
            value={form.assigneeId}
            onChange={(e) => set("assigneeId", e.target.value)}
            aria-invalid={!!errors.assigneeId}
          >
            <option value="" disabled>
              Choose a person…
            </option>
            {activePeople.map((p) => (
              <option key={p.id} value={p.id}>
                {/* Two people with the same name are told apart by email. */}
                {activePeople.some((o) => o.id !== p.id && o.name === p.name) ? `${p.name} (${p.email})` : p.name}
                {onLeave.has(p.id) ? " — on leave" : ""}
              </option>
            ))}
          </Select>
          {onLeave.has(form.assigneeId) ? (
            <p className="mt-1 text-xs text-warning-text">This person is out of office (Outlook automatic reply is on).</p>
          ) : null}
        </Field>

        <Field label="Due date" htmlFor="t-due">
          <Input id="t-due" type="date" value={form.dueDate} onChange={(e) => set("dueDate", e.target.value)} />
        </Field>

        <Field label="Description" htmlFor="t-desc" className="sm:col-span-2">
          <Textarea
            id="t-desc"
            rows={4}
            maxLength={10000}
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            placeholder="What's needed, for whom, and any deadlines or files to know about"
          />
        </Field>

        {!editing ? (
          <Field label="Sub-tasks" htmlFor="t-subtasks" hint="Optional — one per line" className="sm:col-span-2">
            <Textarea
              id="t-subtasks"
              rows={3}
              value={form.subtasks}
              onChange={(e) => set("subtasks", e.target.value)}
              placeholder={"Collect brand files from merchant\nThree icon directions"}
            />
          </Field>
        ) : null}
      </div>
    </Dialog>
  );
}
