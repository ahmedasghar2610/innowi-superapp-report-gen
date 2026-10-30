"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Building, Plus } from "lucide-react";
import { Button, Input, useToast } from "@/components/ui";
import { useCan } from "@/features/auth/use-can";
import { ORG_KIND_LABEL } from "../labels";
import { useOrganizationFromCard, useOrganizationFromLead, useOrganizationLinks, useOrganizationList } from "../queries";

/**
 * The partner ladder's last rung, shown on a partner lead and on a business card:
 * the organization this person belongs to — or a button to make it, or to add
 * them to one that already exists (e.g. a second person at Paysafe).
 */
export function LinkToOrganization({ leadId, contactId }: { leadId?: string; contactId?: string }) {
  const can = useCan();
  const { toast } = useToast();
  const links = useOrganizationLinks(leadId ? [leadId] : [], contactId ? [contactId] : []);
  const fromLead = useOrganizationFromLead();
  const fromCard = useOrganizationFromCard();
  const [picking, setPicking] = useState(false);
  const [term, setTerm] = useState("");
  const [search, setSearch] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const found = useOrganizationList({ search: search || undefined, limit: 8, topLevel: true }, { enabled: picking && search.length >= 2 });

  const linked = leadId ? links.data?.leads[leadId] : contactId ? links.data?.cards[contactId] : undefined;
  const busy = fromLead.isPending || fromCard.isPending;
  const run = (organizationId?: string) => {
    const done = {
      onSuccess: (o: { name: string }) => {
        toast({ variant: "success", title: organizationId ? `Added to ${o.name}` : `${o.name} created` });
        setPicking(false);
      },
      onError: (e: { messages: string[] }) => toast({ variant: "error", title: "Couldn't link", description: e.messages.join(" · ") }),
    };
    if (leadId) fromLead.mutate({ leadId, organizationId }, done);
    else if (contactId) fromCard.mutate({ contactId, organizationId }, done);
  };

  return (
    <div className="rounded-lg border border-border p-3" data-testid="link-to-organization">
      <p className="mb-1 text-xs font-semibold text-foreground">Organization</p>
      {links.isPending ? (
        <p className="text-table text-muted-foreground">Checking…</p>
      ) : linked ? (
        <Link href={`/organizations/${linked.id}`} className="inline-flex items-center gap-1.5 text-table font-medium text-foreground underline underline-offset-4" data-testid="linked-organization">
          <Building className="size-4" aria-hidden /> {linked.name}
          <span className="text-xs font-normal text-muted-foreground no-underline">({ORG_KIND_LABEL[linked.kind]})</span>
        </Link>
      ) : (
        <>
          <p className="mb-2 text-table text-muted-foreground">
            Not on Organizations yet. Make it the partner&apos;s record, or add this person to one that already exists.
          </p>
          {can("organizations.manage") ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="default" size="sm" onClick={() => run()} loading={busy && !picking} data-testid="create-organization-from">
                <Plus className="size-3.5" /> Create organization
              </Button>
              <Button variant="outline" size="sm" onClick={() => setPicking((v) => !v)}>
                Add to existing…
              </Button>
            </div>
          ) : null}
          {picking ? (
            <div className="mt-2 flex flex-col gap-1.5">
              <Input
                autoFocus
                value={term}
                onChange={(e) => {
                  const v = e.target.value;
                  setTerm(v);
                  if (timer.current) clearTimeout(timer.current);
                  timer.current = setTimeout(() => setSearch(v.trim()), 250);
                }}
                placeholder="Type the company name…"
                aria-label="Find an organization"
              />
              <ul className="flex flex-col gap-1">
                {(found.data?.data ?? []).map((o) => (
                  <li key={o.id}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => run(o.id)}
                      className="w-full rounded-md border border-border px-2.5 py-1.5 text-left text-table text-foreground hover:border-primary"
                    >
                      {o.name} <span className="text-xs text-muted-foreground">{ORG_KIND_LABEL[o.kind]}</span>
                    </button>
                  </li>
                ))}
                {search.length >= 2 && found.data && found.data.data.length === 0 ? (
                  <li className="text-xs text-muted-foreground">No organization by that name.</li>
                ) : null}
              </ul>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
