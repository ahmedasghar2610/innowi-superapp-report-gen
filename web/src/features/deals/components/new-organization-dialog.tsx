"use client";

import { useEffect, useState } from "react";
import { CircleAlert } from "lucide-react";
import { Button, Dialog, Field, Input, Select, useToast } from "@/components/ui";
import { ORG_KIND_LABEL } from "../labels";
import { useCreateOrganization } from "../queries";
import { ORGANIZATION_KINDS, type CameFrom, type OrganizationDetail, type OrganizationKind } from "../types";
import { CameFromSelect } from "./partner-ui";

const EMPTY = { name: "", kind: "PARTNER_ISO" as OrganizationKind, cameFrom: "" as CameFrom | "", cameFromDetail: "", website: "", phone: "", email: "", city: "", state: "", contactName: "", contactRole: "", contactEmail: "", contactPhone: "" };

export function NewOrganizationDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated?: (o: OrganizationDetail) => void }) {
  const { toast } = useToast();
  const create = useCreateOrganization();
  const [f, setF] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setF(EMPTY);
      setError(null);
    }
  }, [open]);
  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  const submit = () => {
    setError(null);
    if (!f.name.trim()) return setError("Add the organization's name.");
    const contact = f.contactName.trim()
      ? [{ name: f.contactName.trim(), role: f.contactRole.trim() || undefined, email: f.contactEmail.trim() || undefined, phone: f.contactPhone.trim() || undefined, isPrimary: true }]
      : [];
    create.mutate(
      {
        name: f.name.trim(),
        kind: f.kind,
        cameFrom: f.cameFrom || undefined,
        cameFromDetail: f.cameFromDetail.trim() || undefined,
        website: f.website.trim() || undefined,
        phone: f.phone.trim() || undefined,
        email: f.email.trim() || undefined,
        city: f.city.trim() || undefined,
        state: f.state.trim() || undefined,
        contacts: contact,
      },
      {
        onSuccess: (o) => {
          toast({ variant: "success", title: `${o.name} added` });
          onClose();
          onCreated?.(o);
        },
        onError: (err) => setError(err.messages.join(" · ")),
      },
    );
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New organization"
      description="A partner who brings us restaurants, or a contractor who installs for us."
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="default" size="sm" onClick={submit} loading={create.isPending} data-testid="create-organization">
            Add organization
          </Button>
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" htmlFor="no-name" required>
          <Input id="no-name" value={f.name} onChange={set("name")} required />
        </Field>
        <Field label="Kind" htmlFor="no-kind">
          <Select id="no-kind" value={f.kind} onChange={set("kind")}>
            {ORGANIZATION_KINDS.map((k) => (
              <option key={k} value={k}>
                {ORG_KIND_LABEL[k]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Came from" htmlFor="no-came">
          <CameFromSelect id="no-came" value={f.cameFrom} onChange={(v) => setF({ ...f, cameFrom: v })} />
        </Field>
        <Field label="Introduced by / event" htmlFor="no-came-detail">
          <Input id="no-came-detail" value={f.cameFromDetail} onChange={set("cameFromDetail")} placeholder="Gustavo Ponce, WSAA 2026…" />
        </Field>
        <Field label="Website" htmlFor="no-web">
          <Input id="no-web" value={f.website} onChange={set("website")} placeholder="https://" />
        </Field>
        <Field label="Main e-mail" htmlFor="no-email">
          <Input id="no-email" type="email" value={f.email} onChange={set("email")} />
        </Field>
        <Field label="Main phone" htmlFor="no-phone">
          <Input id="no-phone" type="tel" value={f.phone} onChange={set("phone")} />
        </Field>
        <Field label="City, state" htmlFor="no-city">
          <div className="flex gap-2">
            <Input id="no-city" value={f.city} onChange={set("city")} placeholder="City" />
            <Input value={f.state} onChange={set("state")} placeholder="CA" className="w-20" aria-label="State" />
          </div>
        </Field>
        <p className="text-xs font-semibold text-foreground sm:col-span-2">Primary contact (optional)</p>
        <Field label="Name" htmlFor="no-cname">
          <Input id="no-cname" value={f.contactName} onChange={set("contactName")} />
        </Field>
        <Field label="Role" htmlFor="no-crole">
          <Input id="no-crole" value={f.contactRole} onChange={set("contactRole")} placeholder="Owner, sales lead…" />
        </Field>
        <Field label="E-mail" htmlFor="no-cemail">
          <Input id="no-cemail" type="email" value={f.contactEmail} onChange={set("contactEmail")} />
        </Field>
        <Field label="Phone" htmlFor="no-cphone">
          <Input id="no-cphone" type="tel" value={f.contactPhone} onChange={set("contactPhone")} />
        </Field>
        {error ? (
          <p className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-text-destructive sm:col-span-2" role="alert">
            <CircleAlert className="mt-0.5 size-4 shrink-0" />
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
