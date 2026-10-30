"use client";

import { Users, Plus, Pencil, Trash2, Mail, Phone } from "lucide-react";
import { Badge, Button, Card, EmptyState, ErrorState, Skeleton } from "@/components/ui";
import { useContacts } from "@/features/merchants/api";
import { useCrudManager } from "@/features/merchants/hooks/use-crud-manager";
import { humanize } from "@/lib/format";
import type { Contact } from "@/features/merchants/types";
import { ContactFormDrawer } from "./contact-form-drawer";
import { DeleteContactDialog } from "./delete-contact-dialog";

function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "");
}

/**
 * Contacts tab (route: /merchants/[merchantId]/contacts). Lists the merchant's
 * contacts with create / edit / delete, live against the contacts API.
 *
 * Rendered as a card list (one row per contact inside a bordered Card) rather
 * than a data table — better suited to a handful of rich, mixed-length fields
 * (name, role, two contact channels, preferences) than a rigid grid.
 */
export function ContactsPanel({ merchantId }: { merchantId: string }) {
  const { data: rows, isPending, isError, error, refetch } = useContacts(merchantId);

  const { formOpen, editing, deleting, openCreate, openEdit, closeForm, requestDelete, cancelDelete } =
    useCrudManager<Contact>();

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold leading-6 text-foreground">Contacts</h2>
          <p className="mt-0.5 text-xs leading-4 text-muted-foreground">People tied to this merchant and how to reach them.</p>
        </div>
        <Button variant="default" size="sm" onClick={openCreate}>
          <Plus className="size-4" />
          New contact
        </Button>
      </div>

      {isError ? (
        <Card>
          <ErrorState title="Couldn't load contacts" error={error} onRetry={() => refetch()} />
        </Card>
      ) : isPending ? (
        <ContactsSkeleton />
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={Users}
            title="No contacts yet"
            description="Add the owner, marketing lead, billing contact and anyone else tied to this merchant."
            action={
              <Button variant="default" size="sm" onClick={openCreate}>
                <Plus className="size-4" />
                New contact
              </Button>
            }
          />
        </Card>
      ) : (
        <Card>
          <div className="divide-y divide-border">
            {rows.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center gap-4 p-4">
                <div className="grid size-10 shrink-0 place-items-center rounded-full bg-accent text-table font-semibold text-primary-hover">
                  {c.name ? initials(c.name).toUpperCase() : <Users className="size-5" />}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">
                      {c.name ?? <span className="text-muted-foreground">Unnamed</span>}
                    </span>
                    <Badge tone="accent">{humanize(c.role)}</Badge>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-table text-muted-foreground">
                    {c.email && (
                      <a href={`mailto:${c.email}`} className="inline-flex items-center gap-1.5 text-primary hover:underline">
                        <Mail className="size-4" /> {c.email}
                      </a>
                    )}
                    {c.phone && (
                      <span className="inline-flex items-center gap-1.5">
                        <Phone className="size-4" /> {c.phone}
                      </span>
                    )}
                    {c.preferredChannel && <span>Prefers {humanize(c.preferredChannel)}</span>}
                    {c.language && <span>{c.language}</span>}
                    {c.responsiveness && <span>{humanize(c.responsiveness)} responsiveness</span>}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <Button variant="ghost" size="icon-sm" aria-label={`Edit ${c.name ?? humanize(c.role)}`} onClick={() => openEdit(c)}>
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Delete ${c.name ?? humanize(c.role)}`}
                    className="text-muted-foreground hover:text-text-destructive"
                    onClick={() => requestDelete(c)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <ContactFormDrawer merchantId={merchantId} open={formOpen} onClose={closeForm} contact={editing} />
      <DeleteContactDialog merchantId={merchantId} contact={deleting} onClose={cancelDelete} />
    </div>
  );
}

function ContactsSkeleton() {
  return (
    <Card>
      <div className="divide-y divide-border">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 p-4">
            <Skeleton className="size-10 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1">
              <Skeleton className="h-3.5 w-32" />
              <Skeleton className="mt-2 h-3 w-56" />
            </div>
            <Skeleton className="h-7 w-16 shrink-0" />
          </div>
        ))}
      </div>
    </Card>
  );
}
