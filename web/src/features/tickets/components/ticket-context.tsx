"use client";

import { useState } from "react";
import Link from "next/link";
import { BookOpen, Mail, Phone, Store, X } from "lucide-react";
import { Badge, Card, CardBody, Select, useToast } from "@/components/ui";
import { useLibraryTree } from "@/features/library/api";
import { useLibraryLinks } from "../api";
import type { TicketDetail } from "../types";

const SECTION_LABEL: Record<string, string> = {
  COMPANY: "Company",
  PROCESS: "Process",
  TEMPLATE: "Template",
  MERCHANT: "Merchant",
};

/** Merchant contact, plan and services — so nobody has to leave the ticket. */
export function TicketMerchantCard({ ticket }: { ticket: TicketDetail }) {
  const info = ticket.merchantInfo;
  if (!ticket.merchant || !info) return null;
  const c = info.contact;
  return (
    <Card>
      <CardBody className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Store className="size-4 text-muted-foreground" aria-hidden />
          <Link href={`/merchants/${ticket.merchant.id}/overview`} className="min-w-0 flex-1 truncate text-sm font-semibold text-primary hover:underline">
            {ticket.merchant.name}
          </Link>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Contact</span>
          {c ? (
            <>
              <span className="text-sm text-foreground">
                {c.name ?? "—"} <span className="text-xs text-muted-foreground">· {c.role}</span>
              </span>
              {c.email ? (
                <a href={`mailto:${c.email}`} className="flex min-w-0 items-center gap-1.5 text-sm text-primary hover:underline">
                  <Mail className="size-3.5 shrink-0" aria-hidden />
                  <span className="truncate">{c.email}</span>
                </a>
              ) : null}
              {c.phone ? (
                <a href={`tel:${c.phone}`} className="flex items-center gap-1.5 text-sm text-primary hover:underline">
                  <Phone className="size-3.5 shrink-0" aria-hidden />
                  {c.phone}
                </a>
              ) : null}
            </>
          ) : (
            <span className="text-sm text-muted-foreground">No contact on file.</span>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Plan</span>
          {info.plan ? (
            <span className="text-sm text-foreground">
              {info.plan.name} <span className="text-xs text-muted-foreground">· {info.plan.status.toLowerCase().replace(/_/g, " ")}</span>
            </span>
          ) : (
            <span className="text-sm text-muted-foreground">No active plan.</span>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Services</span>
          {info.services.length ? (
            <div className="flex flex-wrap gap-1.5">
              {info.services.map((s) => (
                <Badge key={s} tone="neutral" icon={false}>
                  {s}
                </Badge>
              ))}
            </div>
          ) : (
            <span className="text-sm text-muted-foreground">None active.</span>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

/** Library pages linked to this ticket (brand guide, process, template…). */
export function TicketLibraryCard({ ticket }: { ticket: TicketDetail }) {
  const { toast } = useToast();
  const { link, unlink } = useLibraryLinks(ticket.key);
  const canEdit = ticket.viewer.canWork || ticket.viewer.canManage;
  const [picking, setPicking] = useState(false);
  const tree = useLibraryTree();
  const links = ticket.libraryLinks ?? [];
  const suggestions = ticket.librarySuggestions ?? [];
  const linked = new Set(links.map((l) => l.id));
  const suggested = new Set(suggestions.map((s) => s.id));
  const others = (tree.data ?? []).filter((p) => !linked.has(p.id) && !suggested.has(p.id));

  const onPick = (pageId: string) => {
    if (!pageId) return;
    link.mutate(pageId, {
      onSuccess: () => setPicking(false),
      onError: (e) => toast({ variant: "error", title: "Page not linked", description: e.message }),
    });
  };

  if (!canEdit && links.length === 0) return null;

  return (
    <Card>
      <CardBody className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Library</span>
          {canEdit && !picking ? (
            <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={() => setPicking(true)}>
              Link a page
            </button>
          ) : null}
        </div>
        {links.length ? (
          <ul className="flex flex-col gap-1">
            {links.map((l) => (
              <li key={l.id} className="group flex items-center gap-2 rounded-md px-1 py-1 hover:bg-muted">
                <BookOpen className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <Link href={`/ops/library/${l.id}`} className="min-w-0 flex-1 truncate text-sm text-primary hover:underline">
                  {l.title}
                </Link>
                <span className="shrink-0 text-[11px] text-muted-foreground">{SECTION_LABEL[l.section] ?? l.section}</span>
                {canEdit ? (
                  <button
                    type="button"
                    aria-label={`Unlink ${l.title}`}
                    onClick={() => unlink.mutate(l.id)}
                    className="grid size-5 shrink-0 place-items-center rounded text-muted-foreground opacity-0 hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    <X className="size-3" />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No pages linked yet.</p>
        )}
        {picking ? (
          <div className="flex items-center gap-2">
            <label htmlFor="link-page" className="sr-only">
              Library page
            </label>
            <Select id="link-page" autoFocus defaultValue="" disabled={link.isPending} onChange={(e) => onPick(e.target.value)}>
              <option value="">Choose a page…</option>
              {suggestions.length ? (
                <optgroup label={ticket.merchant ? `${ticket.merchant.name} pages` : "Suggested"}>
                  {suggestions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {others.length ? (
                <optgroup label="All pages">
                  {others.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                      {p.merchant ? ` · ${p.merchant.name}` : ""}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </Select>
            <button type="button" className="text-xs text-muted-foreground hover:underline" onClick={() => setPicking(false)}>
              Cancel
            </button>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
