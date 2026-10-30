"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Award, Globe, Mail, Phone, Plus, Trash2 } from "lucide-react";
import { Badge, Button, Drawer, ErrorState, Field, Input, Select, Skeleton, Textarea, useToast } from "@/components/ui";
import { SourceBadge } from "@/features/sources/source-badge";
import { useCan } from "@/features/auth/use-can";
import { MERCHANT_STATUS_LABEL, MERCHANT_STATUS_TONE, ORG_KIND_LABEL, ORG_KIND_TONE, PARTNER_STAGE_LABEL, STAGE_LABEL, STAGE_TONE, cameFromLabel, formatDay, money } from "../labels";
import { useAddOrganizationNote, useOrganizationDetail, useRemoveOrganizationContact, useSaveOrganizationContact, useUpdateOrganization } from "../queries";
import { ORGANIZATION_KINDS, type CameFrom, type OrganizationContact, type OrganizationDetail, type OrganizationEvent, type OrganizationKind, type UpdateOrganizationInput } from "../types";
import { useAuth } from "@/features/auth/auth-context";
import { CameFromSelect, OwnerSelect, SellingBadge, StageStepper } from "./partner-ui";

const LINK_BTN =
  "inline-flex h-7 items-center gap-1 rounded-sm border border-border bg-card px-2.5 text-xs font-medium text-foreground hover:bg-accent [&_svg]:size-4 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent";

export function OrganizationDrawer({ orgId, onClose }: { orgId: string | null; onClose: () => void }) {
  const { data, isPending, isError, error, refetch } = useOrganizationDetail(orgId);
  return (
    <Drawer
      open={!!orgId}
      onClose={onClose}
      title={data ? data.name : "Organization"}
      description={data ? [ORG_KIND_LABEL[data.kind], [data.city, data.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ") : undefined}
      size="lg"
    >
      {!orgId ? null : isError ? (
        <ErrorState title="Couldn't load this organization" error={error} onRetry={() => refetch()} />
      ) : isPending || !data ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : (
        <OrgBody org={data} inDrawer />
      )}
    </Drawer>
  );
}

/** The organization's details, stage, owner and contacts — in the drawer and on the full page. */
export function OrgBody({ org, inDrawer = false }: { org: OrganizationDetail; inDrawer?: boolean }) {
  const can = useCan();
  const { user } = useAuth();
  const canManage = can("organizations.manage");
  const canAssign = can("organizations.assign");
  // Anyone who manages organizations may take an unassigned one; moving it on is the sales lead's call.
  const canChangeOwner = canAssign || (canManage && !org.owner);
  const { toast } = useToast();
  const update = useUpdateOrganization();
  const [notes, setNotes] = useState(org.notes ?? "");
  const [cameDetail, setCameDetail] = useState(org.cameFromDetail ?? "");
  const [nextStep, setNextStep] = useState(org.nextStep ?? "");
  const [nextDue, setNextDue] = useState(org.nextStepDue ?? "");
  const [certified, setCertified] = useState(org.certified);
  const [f, setF] = useState({ website: org.website ?? "", email: org.email ?? "", phone: org.phone ?? "", address: org.address ?? "", city: org.city ?? "", state: org.state ?? "", zip: org.zip ?? "" });
  useEffect(() => {
    setNotes(org.notes ?? "");
    setCameDetail(org.cameFromDetail ?? "");
    setNextStep(org.nextStep ?? "");
    setNextDue(org.nextStepDue ?? "");
    setCertified(org.certified);
    setF({ website: org.website ?? "", email: org.email ?? "", phone: org.phone ?? "", address: org.address ?? "", city: org.city ?? "", state: org.state ?? "", zip: org.zip ?? "" });
  }, [org.id, org.notes, org.certified, org.website, org.email, org.phone, org.address, org.city, org.state, org.zip, org.cameFromDetail, org.nextStep, org.nextStepDue]);

  const save = (input: UpdateOrganizationInput, done: string) =>
    update.mutate(
      { id: org.id, input },
      {
        onSuccess: () => toast({ variant: "success", title: done }),
        onError: (err) => toast({ variant: "error", title: "Couldn't save", description: err.messages.join(" · ") }),
      },
    );
  const blur = (k: keyof typeof f, label: string) => () => {
    if (f[k] === (org[k] ?? "")) return;
    save({ [k]: f[k] } as UpdateOrganizationInput, `${label} saved`);
  };
  const disabled = !canManage || update.isPending;

  return (
    <div className="flex flex-col gap-6" data-testid={inDrawer ? "organization-drawer" : "organization-details"}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={ORG_KIND_TONE[org.kind]} icon={false}>
          {ORG_KIND_LABEL[org.kind]}
        </Badge>
        {org.certified ? (
          <Badge tone="success" icon={false} data-testid="certified-badge">
            Certified{org.certifiedAt ? ` since ${formatDay(org.certifiedAt)}` : ""}
          </Badge>
        ) : null}
        <SellingBadge selling={org.selling} deals={org.dealsLast30} />
        <SourceBadge source={org.source} detail={org.sourceDetail} />
        {org.needsReview ? (
          <Badge tone="warning" icon={false} title="Stage and came-from were filled in from a spreadsheet; confirm them">
            Check stage &amp; came from
          </Badge>
        ) : null}
        <span className="ml-auto flex flex-wrap items-center gap-3">
          {org.partnerLeadId ? (
            <Link href={`/partners?lead=${org.partnerLeadId}`} className="text-xs font-medium text-foreground underline underline-offset-4">
              Partner application
            </Link>
          ) : null}
          {org.salesforceAccountId ? (
            <Link href={`/sales/customers/${org.salesforceAccountId}`} className="text-xs font-medium text-foreground underline underline-offset-4" data-testid="salesforce-link">
              Also in Salesforce
            </Link>
          ) : null}
          {inDrawer ? (
            <Link href={`/organizations/${org.id}`} className="inline-flex items-center gap-1 text-xs font-medium text-foreground underline underline-offset-4" data-testid="open-full-page">
              Open full page <ArrowUpRight className="size-3.5" aria-hidden />
            </Link>
          ) : null}
        </span>
      </div>

      {org.parent ? (
        <p className="text-table text-muted-foreground">
          Agent of{" "}
          <Link href={`/organizations/${org.parent.id}`} className="font-medium text-foreground underline underline-offset-4">
            {org.parent.name}
          </Link>
        </p>
      ) : null}
      {org.agentCount ? (
        <p className="text-table text-muted-foreground" data-testid="agent-rollup">
          <span className="font-medium text-foreground">{org.agentCount} agents</span> · {org.agentsIuEnrolled} in Innowi University · {org.agentsCertified} certified · {org.agentsSelling} selling
          {inDrawer ? (
            <>
              {" "}
              ·{" "}
              <Link href={`/organizations/${org.id}`} className="font-medium text-foreground underline underline-offset-4">
                see agents
              </Link>
            </>
          ) : null}
        </p>
      ) : null}

      <div>
        <p className="mb-2 text-xs font-semibold text-foreground">Stage</p>
        <StageStepper stage={org.stage} changedAt={org.stageChangedAt} disabled={disabled} onPick={canManage ? (stage) => save({ stage }, `Moved to ${PARTNER_STAGE_LABEL[stage]}`) : undefined} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Owner" hint={canChangeOwner ? undefined : "Ask a sales lead to reassign"}>
          <OwnerSelect
            value={org.owner?.id ?? ""}
            disabled={!canChangeOwner || update.isPending}
            onChange={(v) => save(v ? { ownerId: v } : { clearOwner: true }, v ? "Owner saved" : "Owner removed")}
          />
        </Field>
        {!org.owner && canManage && !canAssign && user ? (
          <Field label=" ">
            <Button variant="outline" size="sm" onClick={() => save({ ownerId: user.id }, "It's yours")} data-testid="take-it">
              Take it
            </Button>
          </Field>
        ) : null}
        <Field label="Came from">
          <CameFromSelect value={org.cameFrom ?? ""} disabled={disabled} onChange={(v) => save(v ? { cameFrom: v as CameFrom } : { clearCameFrom: true }, "Came from saved")} />
        </Field>
        <Field label="Introduced by / event" hint={org.cameFrom ? cameFromLabel(org.cameFrom) : undefined}>
          <Input
            value={cameDetail}
            disabled={!canManage}
            onChange={(e) => setCameDetail(e.target.value)}
            onBlur={() => {
              if (cameDetail === (org.cameFromDetail ?? "")) return;
              save({ cameFromDetail: cameDetail }, "Saved");
            }}
            placeholder="Gustavo Ponce, WSAA 2026…"
            aria-label="Introduced by or event"
          />
        </Field>
        <Field label="Next step" className="sm:col-span-2">
          <div className="flex gap-2">
            <Input
              value={nextStep}
              disabled={!canManage}
              onChange={(e) => setNextStep(e.target.value)}
              onBlur={() => {
                if (nextStep === (org.nextStep ?? "")) return;
                save(nextStep ? { nextStep } : { clearNextStep: true }, "Next step saved");
              }}
              placeholder="Send the NDA, book the demo…"
              aria-label="Next step"
            />
            <Input
              type="date"
              value={nextDue}
              disabled={!canManage}
              onChange={(e) => {
                setNextDue(e.target.value);
                if (e.target.value !== (org.nextStepDue ?? "")) save({ nextStepDue: e.target.value || null }, "Due date saved");
              }}
              className="w-40"
              aria-label="Next step due"
            />
          </div>
        </Field>
      </div>

      <div className="flex flex-wrap gap-2">
        {org.phone ? (
          <a href={`tel:${org.phone}`} className={LINK_BTN}>
            <Phone /> {org.phone}
          </a>
        ) : null}
        {org.email ? (
          <a href={`mailto:${org.email}`} className={LINK_BTN}>
            <Mail /> {org.email}
          </a>
        ) : null}
        {org.website ? (
          <a href={org.website} target="_blank" rel="noreferrer" className={LINK_BTN}>
            <Globe /> {org.website.replace(/^https?:\/\//, "")}
          </a>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Kind">
          <Select value={org.kind} disabled={disabled} onChange={(e) => save({ kind: e.target.value as OrganizationKind }, "Kind saved")} aria-label="Organization kind">
            {ORGANIZATION_KINDS.map((k) => (
              <option key={k} value={k}>
                {ORG_KIND_LABEL[k]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Innowi Certified Partner" hint="Never expires; blocks nothing" className="sm:col-span-2">
          <label className="flex h-8 items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              className="size-4"
              checked={certified}
              disabled={disabled}
              onChange={(e) => {
                setCertified(e.target.checked);
                save({ certified: e.target.checked }, e.target.checked ? "Certified" : "Certification removed");
              }}
              data-testid="certified-toggle"
            />
            <Award className="size-4 text-muted-foreground" /> Certified
          </label>
        </Field>
        <Field label="Website">
          <Input value={f.website} disabled={!canManage} onChange={(e) => setF({ ...f, website: e.target.value })} onBlur={blur("website", "Website")} aria-label="Website" />
        </Field>
        <Field label="Main e-mail">
          <Input type="email" value={f.email} disabled={!canManage} onChange={(e) => setF({ ...f, email: e.target.value })} onBlur={blur("email", "E-mail")} aria-label="Main e-mail" />
        </Field>
        <Field label="Main phone">
          <Input type="tel" value={f.phone} disabled={!canManage} onChange={(e) => setF({ ...f, phone: e.target.value })} onBlur={blur("phone", "Phone")} aria-label="Main phone" />
        </Field>
        <Field label="Address">
          <Input value={f.address} disabled={!canManage} onChange={(e) => setF({ ...f, address: e.target.value })} onBlur={blur("address", "Address")} aria-label="Address" />
        </Field>
        <Field label="City, state, ZIP" className="sm:col-span-2">
          <div className="flex gap-2">
            <Input value={f.city} disabled={!canManage} onChange={(e) => setF({ ...f, city: e.target.value })} onBlur={blur("city", "City")} aria-label="City" placeholder="City" />
            <Input value={f.state} disabled={!canManage} onChange={(e) => setF({ ...f, state: e.target.value })} onBlur={blur("state", "State")} aria-label="State" placeholder="CA" className="w-20" />
            <Input value={f.zip} disabled={!canManage} onChange={(e) => setF({ ...f, zip: e.target.value })} onBlur={blur("zip", "ZIP")} aria-label="ZIP" placeholder="ZIP" className="w-28" />
          </div>
        </Field>
      </div>

      <Contacts org={org} canManage={canManage} />

      <div>
        <p className="mb-2 text-xs font-semibold text-foreground">Deals ({org.deals.length})</p>
        {org.deals.length === 0 ? (
          <p className="text-table text-muted-foreground">No deals through this organization yet.</p>
        ) : (
          <ul className="flex flex-col gap-2" data-testid="organization-deals">
            {org.deals.map((d) => (
              <li key={d.id}>
                <Link href={`/deals?deal=${d.id}`} className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2 hover:border-primary">
                  <span className="text-xs text-muted-foreground tabular">{d.key}</span>
                  <span className="min-w-0 flex-1 truncate text-table font-medium text-foreground">{d.restaurantName}</span>
                  <Badge tone={STAGE_TONE[d.stage]} icon={false}>
                    {STAGE_LABEL[d.stage]}
                  </Badge>
                  <Badge tone={MERCHANT_STATUS_TONE[d.merchantStatus]} icon={false}>
                    {MERCHANT_STATUS_LABEL[d.merchantStatus]}
                  </Badge>
                  {d.contractor?.id === org.id ? <span className="text-xs text-muted-foreground">installing</span> : null}
                  {d.amountMonthly ? <span className="text-xs text-muted-foreground tabular">{money(d.amountMonthly)}/mo</span> : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Field label="Notes">
        <Textarea
          value={notes}
          disabled={!canManage}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => {
            if (notes === (org.notes ?? "")) return;
            save({ notes }, "Notes saved");
          }}
          rows={3}
          maxLength={10000}
          aria-label="Organization notes"
          placeholder="Territory, commission terms, who to call…"
        />
      </Field>

      <Timeline org={org} canManage={canManage} limit={inDrawer ? 6 : undefined} />
    </div>
  );
}

function eventText(e: OrganizationEvent): string {
  switch (e.kind) {
    case "CREATED":
      return e.body ?? "Added";
    case "STAGE_CHANGED":
      return `Stage: ${label(e.fromValue)} → ${label(e.toValue)}`;
    case "OWNER_CHANGED":
      return e.toValue ? `Assigned to ${e.toValue}${e.fromValue ? ` (was ${e.fromValue})` : ""}${e.body ? ` · ${e.body}` : ""}` : `Owner removed (was ${e.fromValue ?? "nobody"})`;
    case "CAME_FROM_CHANGED":
      return `Came from: ${e.fromValue ?? "not set"} → ${e.toValue ?? "not set"}`;
    case "LINKED":
      return `Linked ${e.toValue?.toLowerCase() ?? "record"}${e.body ? `: ${e.body}` : ""}`;
    case "AGENT_ADDED":
      return `Agents added: ${e.toValue ?? ""}`;
    default:
      return e.body ?? "";
  }
}

function label(stage: string | null): string {
  return stage ? (PARTNER_STAGE_LABEL as Record<string, string>)[stage] ?? stage : "—";
}

function Timeline({ org, canManage, limit }: { org: OrganizationDetail; canManage: boolean; limit?: number }) {
  const { toast } = useToast();
  const add = useAddOrganizationNote();
  const [note, setNote] = useState("");
  const events = limit ? org.events.slice(0, limit) : org.events;
  return (
    <div data-testid="organization-timeline">
      <p className="mb-2 text-xs font-semibold text-foreground">History</p>
      {canManage ? (
        <div className="mb-3 flex gap-2">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note (call, e-mail, meeting)…" aria-label="Add a note" />
          <Button
            variant="outline"
            size="sm"
            disabled={!note.trim()}
            loading={add.isPending}
            onClick={() =>
              add.mutate(
                { id: org.id, body: note.trim() },
                { onSuccess: () => setNote(""), onError: (err) => toast({ variant: "error", title: "Couldn't add the note", description: err.messages.join(" · ") }) },
              )
            }
          >
            Add
          </Button>
        </div>
      ) : null}
      <ul className="flex flex-col gap-2">
        {events.map((e) => (
          <li key={e.id} className="text-table">
            <span className={e.kind === "NOTE" ? "text-foreground" : "text-muted-foreground"}>{eventText(e)}</span>
            <span className="block text-xs text-muted-foreground">
              {formatDay(e.createdAt)}
              {e.actor ? ` · ${e.actor.name}` : ""}
            </span>
          </li>
        ))}
      </ul>
      {limit && org.events.length > limit ? (
        <Link href={`/organizations/${org.id}`} className="mt-2 inline-block text-xs font-medium text-foreground underline underline-offset-4">
          All {org.events.length} entries
        </Link>
      ) : null}
    </div>
  );
}

const BLANK = { name: "", role: "", email: "", phone: "", isPrimary: false };

function Contacts({ org, canManage }: { org: OrganizationDetail; canManage: boolean }) {
  const { toast } = useToast();
  const saveC = useSaveOrganizationContact();
  const removeC = useRemoveOrganizationContact();
  const [editing, setEditing] = useState<OrganizationContact | "new" | null>(null);
  const [c, setC] = useState(BLANK);

  const start = (x: OrganizationContact | "new") => {
    setEditing(x);
    setC(x === "new" ? BLANK : { name: x.name, role: x.role ?? "", email: x.email ?? "", phone: x.phone ?? "", isPrimary: x.isPrimary });
  };
  const submit = () => {
    if (!c.name.trim()) return;
    saveC.mutate(
      { id: org.id, contactId: editing === "new" || !editing ? undefined : editing.id, input: { name: c.name.trim(), role: c.role.trim() || undefined, email: c.email.trim() || undefined, phone: c.phone.trim() || undefined, isPrimary: c.isPrimary } },
      {
        onSuccess: () => {
          toast({ variant: "success", title: "Contact saved" });
          setEditing(null);
        },
        onError: (err) => toast({ variant: "error", title: "Couldn't save contact", description: err.messages.join(" · ") }),
      },
    );
  };

  return (
    <div data-testid="organization-contacts">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-semibold text-foreground">Contacts</p>
        {canManage && editing === null ? (
          <Button variant="outline" size="sm" onClick={() => start("new")} data-testid="add-contact">
            <Plus className="size-3.5" /> Add contact
          </Button>
        ) : null}
      </div>
      {editing !== null ? (
        <div className="mb-3 grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-2">
          <Field label="Name" required>
            <Input value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} aria-label="Contact name" autoFocus />
          </Field>
          <Field label="Role">
            <Input value={c.role} onChange={(e) => setC({ ...c, role: e.target.value })} aria-label="Contact role" />
          </Field>
          <Field label="E-mail">
            <Input type="email" value={c.email} onChange={(e) => setC({ ...c, email: e.target.value })} aria-label="Contact e-mail" />
          </Field>
          <Field label="Phone">
            <Input type="tel" value={c.phone} onChange={(e) => setC({ ...c, phone: e.target.value })} aria-label="Contact phone" />
          </Field>
          <label className="flex items-center gap-2 text-sm text-foreground sm:col-span-2">
            <input type="checkbox" className="size-4" checked={c.isPrimary} onChange={(e) => setC({ ...c, isPrimary: e.target.checked })} /> Primary contact
          </label>
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button variant="default" size="sm" onClick={submit} loading={saveC.isPending} disabled={!c.name.trim()} data-testid="save-contact">
              Save contact
            </Button>
          </div>
        </div>
      ) : null}
      {org.contacts.length === 0 && editing === null ? (
        <p className="text-table text-muted-foreground">No contacts yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {org.contacts.map((x) => (
            <li key={x.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2" data-testid="organization-contact">
              <span className="text-table font-medium text-foreground">{x.name}</span>
              {x.isPrimary ? (
                <Badge tone="accent" icon={false}>
                  Primary
                </Badge>
              ) : null}
              <span className="text-xs text-muted-foreground">{[x.role, x.email, x.phone].filter(Boolean).join(" · ")}</span>
              {canManage ? (
                <span className="ml-auto flex gap-1">
                  <Button variant="ghost" size="sm" onClick={() => start(x)}>
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove ${x.name}`}
                    loading={removeC.isPending && removeC.variables?.contactId === x.id}
                    onClick={() => removeC.mutate({ id: org.id, contactId: x.id }, { onError: (err) => toast({ variant: "error", title: "Couldn't remove", description: err.messages.join(" · ") }) })}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
