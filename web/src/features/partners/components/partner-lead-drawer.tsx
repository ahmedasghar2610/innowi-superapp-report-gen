"use client";

import { useState } from "react";
import { Mail, Phone, Globe, PhoneCall } from "lucide-react";
import { Badge, Button, Drawer, ErrorState, Field, Select, Skeleton, Textarea, useToast } from "@/components/ui";
import { LinkToOrganization } from "@/features/deals/components/link-to-organization";
import { useCan } from "@/features/auth/use-can";
import { formatDate, formatDateTime, displayUrl } from "@/lib/format";
import { STATUS_LABEL, STATUS_TONE, ctaLabel, describeEvent, memberName } from "../labels";
import { useAddPartnerLeadNote, usePartnerLead, useUpdatePartnerLead } from "../queries";
import { PARTNER_LEAD_STATUSES, type PartnerLeadDetail, type PartnerLeadStatus, type PartnerTeamMember } from "../types";

// Links styled like the DS Button (size "sm"): an <a> can't wrap a <button>.
const LINK_BTN =
  "inline-flex h-7 items-center gap-1 rounded-sm px-2.5 text-xs font-medium [&_svg]:size-4 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent";
const LINK_PRIMARY = "bg-primary text-primary-foreground hover:bg-primary-hover";
const LINK_OUTLINE = "border border-border bg-card text-foreground hover:bg-accent";

/** One partner lead: contact details, status + owner, notes and history. */
export function PartnerLeadDrawer({
  leadId,
  team,
  onClose,
}: {
  leadId: string | null;
  team: PartnerTeamMember[] | undefined;
  onClose: () => void;
}) {
  const { data: lead, isPending, isError, error, refetch } = usePartnerLead(leadId ?? undefined);

  return (
    <Drawer
      open={!!leadId}
      onClose={onClose}
      title={lead ? lead.fullName : "Partner lead"}
      description={lead ? `${lead.company ? `${lead.company} · ` : ""}applied ${formatDate(lead.createdAt)}` : undefined}
      size="lg"
    >
      {!leadId ? null : isError ? (
        <ErrorState title="Couldn't load this lead" error={error} onRetry={() => refetch()} />
      ) : isPending || !lead ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : (
        <LeadDetail lead={lead} team={team} />
      )}
    </Drawer>
  );
}

function LeadDetail({ lead, team }: { lead: PartnerLeadDetail; team: PartnerTeamMember[] | undefined }) {
  const can = useCan();
  const canEdit = can("partners.edit");
  const { toast } = useToast();
  const update = useUpdatePartnerLead();
  const addNote = useAddPartnerLeadNote();
  const [note, setNote] = useState("");
  const assignable = (team ?? []).filter((m) => m.assignable || m.email === lead.assignedTo);

  const change = (input: { status?: PartnerLeadStatus; assignedTo?: string | null }, done: string) =>
    update.mutate(
      { id: lead.id, input },
      {
        onSuccess: () => toast({ variant: "success", title: done }),
        onError: (err) => toast({ variant: "error", title: "Couldn't save", description: err.messages.join(" · ") }),
      },
    );

  const submitNote = () => {
    const body = note.trim();
    if (!body) return;
    addNote.mutate(
      { id: lead.id, body },
      {
        onSuccess: () => setNote(""),
        onError: (err) => toast({ variant: "error", title: "Couldn't add note", description: err.messages.join(" · ") }),
      },
    );
  };

  const details: [string, string | null | undefined][] = [
    ["Title", lead.title],
    ["Partner type", lead.partnerType],
    ["Territory", lead.region],
    ["Portfolio", [lead.portfolioSize && `${lead.portfolioSize} merchants`, lead.restaurantShare && `${lead.restaurantShare} restaurants`].filter(Boolean).join(" · ")],
    ["Processors", lead.processors],
    ["Interests", lead.interests.join(", ")],
    ["Timeline", lead.timeline],
    ["Heard about us", lead.heardAbout],
  ];
  const source: [string, string | null | undefined][] = [
    ["Button clicked", ctaLabel(lead.sourceCta)],
    ["Landing page", lead.landingUrl],
    ["Referrer", lead.referrer],
    ["UTM", [lead.utmSource, lead.utmMedium, lead.utmCampaign, lead.utmTerm, lead.utmContent].filter(Boolean).join(" / ")],
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={STATUS_TONE[lead.status]} icon={false}>
          {STATUS_LABEL[lead.status]}
        </Badge>
        {lead.wantsCall ? (
          <Badge tone="accent" icon={PhoneCall}>
            Wants a discovery call
          </Badge>
        ) : null}
        <span className="text-xs text-muted-foreground">Owner: {memberName(lead.assignedTo, team)}</span>
      </div>

      <LinkToOrganization leadId={lead.id} />

      {/* Contact */}
      <div className="flex flex-wrap gap-2">
        <a href={`mailto:${lead.email}?subject=${encodeURIComponent("Innowi partner program")}`} className={`${LINK_BTN} ${LINK_PRIMARY}`}>
          <Mail /> {lead.email}
        </a>
        {lead.phone ? (
          <a href={`tel:${lead.phone}`} className={`${LINK_BTN} ${LINK_OUTLINE}`}>
            <Phone /> {lead.phone}
          </a>
        ) : null}
        {lead.website ? (
          <a
            href={/^https?:\/\//.test(lead.website) ? lead.website : `https://${lead.website}`}
            target="_blank"
            rel="noopener noreferrer"
            className={`${LINK_BTN} ${LINK_OUTLINE}`}
          >
            <Globe /> {displayUrl(lead.website)}
          </a>
        ) : null}
      </div>

      {/* Status + owner */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Status">
          <Select
            value={lead.status}
            disabled={!canEdit || update.isPending}
            onChange={(e) => {
              const status = e.target.value as PartnerLeadStatus;
              change({ status }, `Marked as ${STATUS_LABEL[status]}`);
            }}
            aria-label="Lead status"
          >
            {PARTNER_LEAD_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Owner">
          <Select
            value={lead.assignedTo ?? ""}
            disabled={!canEdit || update.isPending}
            onChange={(e) => {
              const assignedTo = e.target.value || null;
              change({ assignedTo }, assignedTo ? `Assigned to ${memberName(assignedTo, team)}` : "Unassigned");
            }}
            aria-label="Lead owner"
          >
            <option value="">Unassigned</option>
            {assignable.map((m) => (
              <option key={m.email} value={m.email}>
                {m.name || m.email}
                {m.status === "invited" ? " (invited)" : m.status !== "active" ? " (can't take leads now)" : ""}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {lead.message ? (
        <div>
          <p className="mb-1.5 text-xs font-semibold text-foreground">Message</p>
          <p className="whitespace-pre-wrap rounded-lg bg-muted px-3 py-2.5 text-table text-foreground">{lead.message}</p>
        </div>
      ) : null}

      <DetailList title="About them" rows={details} />
      <DetailList title="Where they came from" rows={source} />

      {/* Notes */}
      <div>
        <p className="mb-2 text-xs font-semibold text-foreground">Notes</p>
        {canEdit ? (
          <div className="mb-3 flex flex-col gap-2">
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add a note — call outcome, next step…"
              maxLength={4000}
              aria-label="New note"
            />
            <div className="flex justify-end">
              <Button size="sm" variant="default" onClick={submitNote} loading={addNote.isPending} disabled={!note.trim()}>
                Add note
              </Button>
            </div>
          </div>
        ) : null}
        {lead.notes.length === 0 ? (
          <p className="text-table text-muted-foreground">No notes yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {lead.notes.map((n) => (
              <li key={n.id} className="rounded-lg border border-border px-3 py-2.5">
                <p className="whitespace-pre-wrap text-table text-foreground">{n.body}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {memberName(n.authorEmail, team)} · {formatDateTime(n.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* History */}
      <div>
        <p className="mb-2 text-xs font-semibold text-foreground">History</p>
        <ol className="flex flex-col gap-2 border-l border-border pl-3">
          {lead.events.map((e) => (
            <li key={e.id} className="text-table">
              <span className="text-foreground">{describeEvent(e, team)}</span>
              <span className="text-xs text-muted-foreground">
                {" "}
                · {e.actorEmail ? `${memberName(e.actorEmail, team)} · ` : ""}
                {formatDateTime(e.createdAt)}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function DetailList({ title, rows }: { title: string; rows: [string, string | null | undefined][] }) {
  const shown = rows.filter(([, v]) => v);
  if (!shown.length) return null;
  return (
    <div>
      <p className="mb-2 text-xs font-semibold text-foreground">{title}</p>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-2.5 text-table sm:grid-cols-2">
        {shown.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-xs font-medium uppercase tracking-[0.04em] text-muted-foreground">{label}</dt>
            <dd className="mt-0.5 break-words text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
