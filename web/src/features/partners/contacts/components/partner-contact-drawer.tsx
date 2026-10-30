"use client";

import { useEffect, useState } from "react";
import { Globe, Handshake, Mail, MapPin, Phone } from "lucide-react";
import { Badge, Button, Drawer, ErrorState, Field, Input, Select, Skeleton, Textarea, useToast } from "@/components/ui";
import { LinkToOrganization } from "@/features/deals/components/link-to-organization";
import { useCan } from "@/features/auth/use-can";
import { displayUrl, formatDate, formatDateTime } from "@/lib/format";
import { CONTACT_STATUS_LABEL, CONTACT_STATUS_TONE, contactSourceLabel } from "../labels";
import { usePartnerContact, usePromotePartnerContact, useUpdatePartnerContact } from "../queries";
import {
  PARTNER_CONTACT_STATUSES,
  PARTNER_TYPES,
  type PartnerContact,
  type PartnerContactStatus,
  type UpdatePartnerContactInput,
} from "../types";

// Links styled like the DS Button (size "sm"): an <a> can't wrap a <button>.
const LINK_BTN =
  "inline-flex h-7 items-center gap-1 rounded-sm px-2.5 text-xs font-medium [&_svg]:size-4 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent";
const LINK_PRIMARY = "bg-primary text-primary-foreground hover:bg-primary-hover";
const LINK_OUTLINE = "border border-border bg-card text-foreground hover:bg-accent";

/** One contact: card details (editable), status, notes, and the "Promote to partner lead" action. */
export function PartnerContactDrawer({ contactId, onClose }: { contactId: string | null; onClose: () => void }) {
  const { data: contact, isPending, isError, error, refetch } = usePartnerContact(contactId ?? undefined);

  return (
    <Drawer
      open={!!contactId}
      onClose={onClose}
      title={contact ? contact.fullName : "Contact"}
      description={
        contact
          ? `${contact.company ? `${contact.company} · ` : ""}${contact.metAt ? `met at ${contact.metAt} · ` : ""}added ${formatDate(contact.createdAt)}`
          : undefined
      }
      size="lg"
    >
      {!contactId ? null : isError ? (
        <ErrorState title="Couldn't load this contact" error={error} onRetry={() => refetch()} />
      ) : isPending || !contact ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : (
        <ContactDetail contact={contact} />
      )}
    </Drawer>
  );
}

type Editable = Pick<PartnerContact, "fullName" | "title" | "company" | "email" | "phone" | "website" | "address" | "metAt">;
const EDITABLE: (keyof Editable)[] = ["fullName", "title", "company", "email", "phone", "website", "address", "metAt"];
const LABEL: Record<keyof Editable, string> = {
  fullName: "Name",
  title: "Title",
  company: "Company",
  email: "Email",
  phone: "Phone",
  website: "Website",
  address: "Address",
  metAt: "Met at",
};

function ContactDetail({ contact }: { contact: PartnerContact }) {
  const can = useCan();
  const canEdit = can("partners.edit");
  const { toast } = useToast();
  const update = useUpdatePartnerContact();
  const promote = usePromotePartnerContact();
  const [form, setForm] = useState<Editable>(() => pick(contact));
  const [notes, setNotes] = useState(contact.notes ?? "");
  const [promoteType, setPromoteType] = useState(contact.partnerType ?? "Other");
  useEffect(() => {
    setForm(pick(contact));
    setNotes(contact.notes ?? "");
    setPromoteType(contact.partnerType ?? "Other");
  }, [contact]);

  const save = (input: UpdatePartnerContactInput, done: string) =>
    update.mutate(
      { id: contact.id, input },
      {
        onSuccess: () => toast({ variant: "success", title: done }),
        onError: (err) => toast({ variant: "error", title: "Couldn't save", description: err.messages.join(" · ") }),
      },
    );

  const dirty = EDITABLE.filter((k) => (form[k] ?? "") !== (contact[k] ?? ""));
  const saveDetails = () => {
    const input: UpdatePartnerContactInput = {};
    for (const k of dirty) (input as Record<string, string | null>)[k] = form[k]?.trim() || null;
    if (input.fullName === null) {
      toast({ variant: "error", title: "Name can't be empty" });
      return;
    }
    save(input, "Contact updated");
  };

  const doPromote = () =>
    promote.mutate(
      { id: contact.id, partnerType: promoteType },
      {
        onSuccess: () => toast({ variant: "success", title: "Promoted to a partner lead", description: "It's now in Partner leads, and the team has been emailed to assign it." }),
        onError: (err) => toast({ variant: "error", title: "Couldn't promote", description: err.messages.join(" · ") }),
      },
    );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={CONTACT_STATUS_TONE[contact.status]} icon={false}>
          {CONTACT_STATUS_LABEL[contact.status]}
        </Badge>
        <Badge tone="outline" icon={false}>
          {contactSourceLabel(contact.source)}
        </Badge>
        {contact.promotedLeadId ? (
          <Badge tone="success" icon={Handshake}>
            Partner lead
          </Badge>
        ) : null}
      </div>

      <LinkToOrganization contactId={contact.id} />

      {/* Contact actions */}
      <div className="flex flex-wrap gap-2">
        {contact.email ? (
          <a href={`mailto:${contact.email}?subject=${encodeURIComponent("Innowi partner program")}`} className={`${LINK_BTN} ${LINK_PRIMARY}`}>
            <Mail /> {contact.email}
          </a>
        ) : null}
        {contact.phone ? (
          <a href={`tel:${contact.phone}`} className={`${LINK_BTN} ${LINK_OUTLINE}`}>
            <Phone /> {contact.phone}
          </a>
        ) : null}
        {contact.website ? (
          <a
            href={/^https?:\/\//.test(contact.website) ? contact.website : `https://${contact.website}`}
            target="_blank"
            rel="noopener noreferrer"
            className={`${LINK_BTN} ${LINK_OUTLINE}`}
          >
            <Globe /> {displayUrl(contact.website)}
          </a>
        ) : null}
        {contact.address ? (
          <span className={`${LINK_BTN} ${LINK_OUTLINE} cursor-default`}>
            <MapPin /> {contact.address}
          </span>
        ) : null}
      </div>

      {/* Promote */}
      {contact.promotedLeadId ? (
        <div className="rounded-lg border border-border bg-muted px-3 py-2.5 text-table text-foreground">
          Promoted to a partner lead{contact.promotedBy ? ` by ${contact.promotedBy}` : ""}
          {contact.promotedAt ? ` on ${formatDateTime(contact.promotedAt)}` : ""}.{" "}
          <a href={`/partners?lead=${contact.promotedLeadId}`} className="font-medium underline underline-offset-4">
            Open the lead
          </a>
        </div>
      ) : canEdit ? (
        <div className="flex flex-col gap-2 rounded-lg border border-border px-3 py-3">
          <p className="text-xs font-semibold text-foreground">Is this a partner prospect?</p>
          <p className="text-xs text-muted-foreground">
            Promoting creates a partner lead with these details and e-mails the team to assign an owner. Needs an e-mail address.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Partner type">
              <Select value={promoteType} onChange={(e) => setPromoteType(e.target.value)} aria-label="Partner type for the lead" className="w-[260px]">
                {PARTNER_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </Field>
            <Button size="sm" variant="default" onClick={doPromote} loading={promote.isPending} disabled={!contact.email}>
              <Handshake className="size-4" />
              Promote to partner lead
            </Button>
          </div>
        </div>
      ) : null}

      {/* Status + partner type */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Status">
          <Select
            value={contact.status}
            disabled={!canEdit || update.isPending}
            onChange={(e) => {
              const status = e.target.value as PartnerContactStatus;
              save({ status }, `Marked as ${CONTACT_STATUS_LABEL[status]}`);
            }}
            aria-label="Contact status"
          >
            {PARTNER_CONTACT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {CONTACT_STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Partner type (if any)">
          <Select
            value={contact.partnerType ?? ""}
            disabled={!canEdit || update.isPending}
            onChange={(e) => save({ partnerType: e.target.value || null }, "Partner type updated")}
            aria-label="Partner type"
          >
            <option value="">Not set</option>
            {PARTNER_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {/* Details (editable) */}
      <div>
        <p className="mb-2 text-xs font-semibold text-foreground">Details</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {EDITABLE.map((k) => (
            <Field key={k} label={LABEL[k]}>
              <Input
                value={form[k] ?? ""}
                disabled={!canEdit}
                onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}
                aria-label={LABEL[k]}
              />
            </Field>
          ))}
        </div>
        {canEdit && dirty.length > 0 ? (
          <div className="mt-2 flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setForm(pick(contact))}>
              Discard
            </Button>
            <Button size="sm" variant="default" onClick={saveDetails} loading={update.isPending}>
              Save changes
            </Button>
          </div>
        ) : null}
      </div>

      {contact.otherText ? (
        <div>
          <p className="mb-1.5 text-xs font-semibold text-foreground">Also on the card</p>
          <p className="whitespace-pre-wrap rounded-lg bg-muted px-3 py-2.5 text-table text-foreground">{contact.otherText}</p>
        </div>
      ) : null}

      {/* Notes */}
      <div>
        <p className="mb-2 text-xs font-semibold text-foreground">Notes</p>
        <Textarea
          value={notes}
          disabled={!canEdit}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="What you talked about, next step…"
          maxLength={8000}
          aria-label="Notes"
        />
        {canEdit && notes !== (contact.notes ?? "") ? (
          <div className="mt-2 flex justify-end">
            <Button size="sm" variant="default" onClick={() => save({ notes: notes.trim() || null }, "Notes saved")} loading={update.isPending}>
              Save notes
            </Button>
          </div>
        ) : null}
      </div>

      <p className="text-xs text-muted-foreground">
        {contact.scannedBy ? `Added by ${contact.scannedBy} · ` : ""}
        {contact.cardId ? `card ${contact.cardId} · ` : ""}
        updated {formatDateTime(contact.updatedAt)}
      </p>
    </div>
  );
}

function pick(c: PartnerContact): Editable {
  return {
    fullName: c.fullName,
    title: c.title,
    company: c.company,
    email: c.email,
    phone: c.phone,
    website: c.website,
    address: c.address,
    metAt: c.metAt,
  };
}
