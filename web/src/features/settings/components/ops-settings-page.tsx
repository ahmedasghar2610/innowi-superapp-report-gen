"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Archive, ArchiveRestore, ArrowDown, ArrowUp, Check, Pencil, Plus, RotateCcw, X } from "lucide-react";
import { Badge, Button, Input, Skeleton, useToast } from "@/components/ui";
import { useCan } from "@/features/auth/use-can";
import { useTicketCatalog, useTicketPeople } from "@/features/tickets/api";
import { PRIORITY_LABEL, PRIORITY_TONE, STATUS_DOT, STATUS_LABEL, STATUS_ORDER, TYPE_DOT, formatTarget } from "@/features/tickets/labels";
import type { Project } from "@/features/tickets/types";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils/cn";
import { useAllProjects, useCreateProject, useResetSla, useSaveSla, useSlaSettings, useUpdateProject } from "../api";
import { WEEKDAYS, type SlaTarget } from "../types";
import { PreviewTag, SettingsCard, ViewOnlyNote } from "./settings-shell";

const errorText = (e: unknown) => (e as { messages?: string[] })?.messages?.[0] ?? (e as Error)?.message ?? "Something went wrong";

export function OpsSettingsPage() {
  return (
    <>
      <SlaCard />
      <ProjectsCard />
      <CreatorsCard />
      <CatalogCard />
      <StatusesCard />
    </>
  );
}

/* ------------------------------------------------------------------ SLA -- */
function SlaCard() {
  const { data, isPending } = useSlaSettings();
  const save = useSaveSla();
  const reset = useResetSla();
  const { toast } = useToast();
  const [draft, setDraft] = useState<SlaTarget[]>([]);

  useEffect(() => {
    if (data) setDraft(data.targets.map(({ priority, responseHours, resolutionHours }) => ({ priority, responseHours, resolutionHours })));
  }, [data]);

  if (isPending || !data) {
    return (
      <SettingsCard title="SLA targets">
        <Skeleton className="h-40 w-full" />
      </SettingsCard>
    );
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(data.targets.map(({ priority, responseHours, resolutionHours }) => ({ priority, responseHours, resolutionHours })));
  const invalid = draft.find((t) => !(t.responseHours >= 1) || !(t.resolutionHours >= 1) || t.responseHours > t.resolutionHours);
  const set = (i: number, k: "responseHours" | "resolutionHours", v: string) =>
    setDraft((d) => d.map((t, j) => (j === i ? { ...t, [k]: Math.max(0, Math.round(Number(v) || 0)) } : t)));
  const days = data.workDays.map((d) => WEEKDAYS[d]).join(", ");

  return (
    <SettingsCard
      title="SLA targets"
      description={
        <>
          Business hours per priority. The clock counts {days} in {data.timezone.replace("_", " ")} (24 h = one working day), pauses
          while Awaiting Merchant, and turns “at risk” with under {Math.round(data.atRiskShare * 100)}% left.
        </>
      }
      action={
        data.canEdit && (
          <>
            {!data.isDefault && (
              <Button
                size="sm"
                variant="ghost"
                loading={reset.isPending}
                onClick={() => reset.mutate(undefined, { onSuccess: () => toast({ title: "SLA targets reset to the defaults", variant: "success" }) })}
              >
                <RotateCcw className="size-4" />
                Reset to defaults
              </Button>
            )}
            <Button
              size="sm"
              variant="default"
              disabled={!dirty || !!invalid}
              loading={save.isPending}
              onClick={() =>
                save.mutate(draft, {
                  onSuccess: () => toast({ title: "SLA targets saved", description: "New tickets and priority changes use them now.", variant: "success" }),
                  onError: (e) => toast({ title: "Couldn't save", description: errorText(e), variant: "error" }),
                })
              }
            >
              Save targets
            </Button>
          </>
        )
      }
    >
      {!data.canEdit && <div className="mb-3"><ViewOnlyNote /></div>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <th className="py-2 pr-3 font-medium">Priority</th>
              <th className="px-2 py-2 font-medium">First response</th>
              <th className="px-2 py-2 font-medium">Resolution</th>
              <th className="py-2 pl-2 font-medium">Default</th>
            </tr>
          </thead>
          <tbody>
            {draft.map((t, i) => {
              const def = data.targets[i];
              const bad = t.responseHours > t.resolutionHours;
              return (
                <tr key={t.priority} className="border-b border-border last:border-0">
                  <td className="py-3 pr-3">
                    <Badge tone={PRIORITY_TONE[t.priority]}>{PRIORITY_LABEL[t.priority]}</Badge>
                  </td>
                  {(["responseHours", "resolutionHours"] as const).map((k) => (
                    <td key={k} className="px-2 py-3">
                      {data.canEdit ? (
                        <div className="flex items-center gap-2">
                          <Input
                            type="number"
                            min={1}
                            max={k === "responseHours" ? 2000 : 5000}
                            className={cn("h-7 w-20 text-right", bad && "border-destructive")}
                            aria-label={`${PRIORITY_LABEL[t.priority]} ${k === "responseHours" ? "first response" : "resolution"} hours`}
                            value={t[k] || ""}
                            onChange={(e) => set(i, k, e.target.value)}
                          />
                          <span className="text-xs text-muted-foreground">h · {t[k] ? formatTarget(t[k]) : "—"}</span>
                        </div>
                      ) : (
                        <span>{formatTarget(t[k])}</span>
                      )}
                    </td>
                  ))}
                  <td className="py-3 pl-2 text-xs text-muted-foreground">
                    {formatTarget(def.defaultResponseHours)} / {formatTarget(def.defaultResolutionHours)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        {invalid ? (
          <span className="text-text-destructive">First response can&apos;t be later than resolution.</span>
        ) : data.isDefault ? (
          "Using the built-in targets."
        ) : (
          `Changed ${data.updatedAt ? formatDateTime(data.updatedAt) : ""}${data.updatedBy ? ` by ${data.updatedBy}` : ""}. Tickets already open keep the due times they were given until their priority changes.`
        )}
      </p>
    </SettingsCard>
  );
}

/* ------------------------------------------------------------- projects -- */
function ProjectsCard() {
  const can = useCan();
  const canEdit = can("settings.manage") || can("ticket.manage");
  const { data: projects, isPending } = useAllProjects();
  const create = useCreateProject();
  const update = useUpdateProject();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<string>();
  const [editName, setEditName] = useState("");
  const [showArchived, setShowArchived] = useState(false);

  const live = (projects ?? []).filter((p) => !p.archived);
  const archived = (projects ?? []).filter((p) => p.archived);
  const fail = (e: unknown) => toast({ title: "Couldn't save", description: errorText(e), variant: "error" });

  const move = (p: Project, dir: -1 | 1) => {
    const i = live.findIndex((x) => x.id === p.id);
    if (!live[i + dir]) return;
    const order = [...live];
    [order[i], order[i + dir]] = [order[i + dir], order[i]];
    // Renumber 1…n so equal or gappy positions can't stop the swap.
    order.forEach((x, n) => {
      if (x.position !== n + 1) update.mutate({ id: x.id, position: n + 1 }, { onError: fail });
    });
  };

  return (
    <SettingsCard
      title="Projects"
      description="The folders every ticket sits in. Archived projects keep their tickets but can't be picked for new ones."
    >
      {!canEdit && <div className="mb-3"><ViewOnlyNote>Admins and the people who create tickets can change projects.</ViewOnlyNote></div>}
      {isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {live.map((p, i) => (
            <li key={p.id} className="flex items-center gap-2 px-3 py-2">
              {editing === p.id ? (
                <form
                  className="flex flex-1 items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    update.mutate({ id: p.id, name: editName.trim() }, { onSuccess: () => setEditing(undefined), onError: fail });
                  }}
                >
                  <Input autoFocus value={editName} onChange={(e) => setEditName(e.target.value)} className="h-7" aria-label="Project name" />
                  <Button size="icon-sm" type="submit" variant="ghost" aria-label="Save name" disabled={!editName.trim()}>
                    <Check />
                  </Button>
                  <Button size="icon-sm" variant="ghost" aria-label="Cancel" onClick={() => setEditing(undefined)}>
                    <X />
                  </Button>
                </form>
              ) : (
                <>
                  <span className="flex-1 text-sm text-foreground">{p.name}</span>
                  {canEdit && (
                    <div className="flex gap-0.5">
                      <Button size="icon-sm" variant="ghost" aria-label={`Move ${p.name} up`} disabled={i === 0} onClick={() => move(p, -1)}>
                        <ArrowUp />
                      </Button>
                      <Button size="icon-sm" variant="ghost" aria-label={`Move ${p.name} down`} disabled={i === live.length - 1} onClick={() => move(p, 1)}>
                        <ArrowDown />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Rename ${p.name}`}
                        onClick={() => {
                          setEditing(p.id);
                          setEditName(p.name);
                        }}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Archive ${p.name}`}
                        onClick={() =>
                          update.mutate(
                            { id: p.id, archived: true },
                            { onSuccess: () => toast({ title: `Archived “${p.name}”` }), onError: fail },
                          )
                        }
                      >
                        <Archive />
                      </Button>
                    </div>
                  )}
                </>
              )}
            </li>
          ))}
          {canEdit && (
            <li className="px-3 py-2">
              <form
                className="flex items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  create.mutate(name.trim(), {
                    onSuccess: (p) => {
                      setName("");
                      toast({ title: `Added “${p.name}”`, variant: "success" });
                    },
                    onError: fail,
                  });
                }}
              >
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New project name" className="h-7" maxLength={120} aria-label="New project name" />
                <Button size="sm" type="submit" disabled={!name.trim()} loading={create.isPending}>
                  <Plus className="size-4" />
                  Add
                </Button>
              </form>
            </li>
          )}
        </ul>
      )}
      {archived.length > 0 && (
        <div className="mt-3">
          <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={() => setShowArchived((v) => !v)}>
            {showArchived ? "Hide" : "Show"} archived ({archived.length})
          </button>
          {showArchived && (
            <ul className="mt-2 flex flex-col gap-1">
              {archived.map((p) => (
                <li key={p.id} className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span className="flex-1">{p.name}</span>
                  {canEdit && (
                    <Button size="sm" variant="ghost" onClick={() => update.mutate({ id: p.id, archived: false }, { onError: fail })}>
                      <ArchiveRestore className="size-4" />
                      Restore
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </SettingsCard>
  );
}

/* ------------------------------------------------------------- creators -- */
function CreatorsCard() {
  const can = useCan();
  const { data: people, isPending } = useTicketPeople();
  const creators = (people ?? []).filter((p) => p.canManageTickets);
  return (
    <SettingsCard
      title="Who can create tickets"
      description="Create, edit, reassign and delete any ticket. Everyone else works the tickets assigned to them."
      action={
        can("users.manage") && (
          <Link href="/settings/team" className="text-xs font-medium text-primary hover:underline">
            Change in Team & access
          </Link>
        )
      }
    >
      {isPending ? (
        <Skeleton className="h-8 w-1/2" />
      ) : creators.length ? (
        <div className="flex flex-wrap gap-2">
          {creators.map((p) => (
            <Badge key={p.id} tone={p.role === "SUPER_ADMIN" ? "primary" : "accent"}>
              {p.name}
              {p.role === "SUPER_ADMIN" ? " · Super Admin" : ""}
            </Badge>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Nobody yet — give “Create & manage tickets” to Aima and Maheen in Team & access.</p>
      )}
    </SettingsCard>
  );
}

/* -------------------------------------------------------------- catalog -- */
function CatalogCard() {
  const { data, isPending } = useTicketCatalog();
  const [open, setOpen] = useState<string>();
  return (
    <SettingsCard
      title="Ticket types & categories"
      description="The type sets the fields and SLA; the category and sub-category route the work."
      action={
        <>
          <PreviewTag>Editing coming soon</PreviewTag>
          <Button size="sm" disabled title="Categories are fixed in the API for now (modules/ops/taxonomy.py)">
            <Pencil className="size-4" />
            Edit
          </Button>
        </>
      }
    >
      {isPending || !data ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {data.types.map((t) => {
            const subs = t.categories.reduce((n, c) => n + c.subCategories.length, 0);
            const expanded = open === t.type;
            return (
              <div key={t.type} className="rounded-lg border border-border p-3">
                <div className="flex items-center gap-2">
                  <span className={cn("size-2.5 rounded-sm", TYPE_DOT[t.type])} aria-hidden />
                  <span className="text-sm font-semibold text-foreground">{t.label}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {t.categories.length} categories · {subs} sub-categories
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{t.description}</p>
                <button type="button" className="mt-2 text-xs font-medium text-primary hover:underline" onClick={() => setOpen(expanded ? undefined : t.type)}>
                  {expanded ? "Hide categories" : "Show categories"}
                </button>
                {expanded && (
                  <ul className="mt-2 flex flex-col gap-1.5">
                    {t.categories.map((c) => (
                      <li key={c.name} className="text-xs">
                        <span className="font-medium text-foreground">{c.name}</span>
                        <span className="text-muted-foreground"> — {c.subCategories.join(", ")}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </SettingsCard>
  );
}

/* ------------------------------------------------------------- statuses -- */
const STATUS_NOTE: Record<string, string> = {
  NEW: "Created, not started. Moving it on counts as the first response.",
  IN_PROGRESS: "Being worked on by the assignee.",
  AWAITING_MERCHANT: "Waiting on the merchant — the SLA clock pauses.",
  IN_REVIEW: "Done by the assignee, waiting for sign-off.",
  DONE: "Closed. Reopening clears the completed time.",
};

function StatusesCard() {
  return (
    <SettingsCard title="Statuses" description="The same five steps for every ticket type." action={<PreviewTag>Fixed for now</PreviewTag>}>
      <ol className="flex flex-col gap-2">
        {STATUS_ORDER.map((s, i) => (
          <li key={s} className="flex items-start gap-3 text-sm">
            <span className="w-4 text-right text-xs text-muted-foreground">{i + 1}</span>
            <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", STATUS_DOT[s])} aria-hidden />
            <span className="w-40 shrink-0 font-medium text-foreground">{STATUS_LABEL[s]}</span>
            <span className="text-muted-foreground">{STATUS_NOTE[s]}</span>
          </li>
        ))}
      </ol>
    </SettingsCard>
  );
}
