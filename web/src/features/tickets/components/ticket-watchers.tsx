"use client";

import { Eye, EyeOff, X } from "lucide-react";
import { Button, Card, CardBody, Select, useToast } from "@/components/ui";
import { useAuth } from "@/features/auth/auth-context";
import { useTicketPeople, useWatchers } from "../api";
import type { TicketDetail } from "../types";

/** Who follows the ticket. Watchers hear about comments, status changes and
 *  SLA alerts (bell, and Teams / e-mail as each person chose in Settings → Notifications).
 *  Anyone can watch; ticket managers can add or remove other people. */
export function TicketWatchers({ ticket }: { ticket: TicketDetail }) {
  const { user } = useAuth();
  const people = useTicketPeople();
  const { watch, unwatch } = useWatchers(ticket.key);
  const { toast } = useToast();
  const watchers = ticket.watchers ?? [];
  const watching = !!ticket.viewer.watching;
  const canManage = ticket.viewer.canManage;
  const others = (people.data ?? []).filter((p) => !watchers.some((w) => w.id === p.id));
  const fail = (e: { messages?: string[]; message: string }) => toast({ variant: "error", title: "Couldn't update watchers", description: e.messages?.[0] ?? e.message });

  return (
    <Card>
      <CardBody className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <h2 className="flex-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Watchers · {watchers.length}</h2>
          <Button
            size="sm"
            variant={watching ? "outline" : "default"}
            loading={watch.isPending || unwatch.isPending}
            onClick={() =>
              watching
                ? unwatch.mutate(undefined, { onSuccess: () => toast({ title: `Stopped watching ${ticket.key}` }), onError: fail })
                : watch.mutate(undefined, { onSuccess: () => toast({ title: `Watching ${ticket.key}`, description: "You'll hear about comments, status changes and SLA alerts." }), onError: fail })
            }
          >
            {watching ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            {watching ? "Unwatch" : "Watch"}
          </Button>
        </div>
        {watchers.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nobody is watching this ticket.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {watchers.map((w) => (
              <li key={w.id} className="flex items-center gap-2 text-sm">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
                  {w.name
                    .split(/\s+/)
                    .slice(0, 2)
                    .map((x) => x[0]?.toUpperCase())
                    .join("")}
                </span>
                <span className="flex-1 truncate text-foreground">
                  {w.name}
                  {w.id === user?.id ? <span className="text-muted-foreground"> (you)</span> : null}
                </span>
                {canManage && w.id !== user?.id ? (
                  <Button size="icon-xs" variant="ghost" aria-label={`Remove ${w.name}`} onClick={() => unwatch.mutate(w.id, { onError: fail })}>
                    <X />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {canManage && others.length > 0 ? (
          <Select
            aria-label="Add a watcher"
            value=""
            onChange={(e) => e.target.value && watch.mutate(e.target.value, { onError: fail })}
          >
            <option value="">Add a watcher…</option>
            {others.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        ) : null}
      </CardBody>
    </Card>
  );
}
