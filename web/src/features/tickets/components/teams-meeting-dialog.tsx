"use client";

import { useEffect, useMemo, useState } from "react";
import { Video } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Dialog, Field, Input, Select, Textarea, useToast } from "@/components/ui";
import { useAuth } from "@/features/auth/auth-context";
import { useTeamsMeeting, useTeamsStatus } from "@/features/settings/teams-api";
import { queryKeys } from "@/lib/query/query-keys";
import { useTicketPeople } from "../api";
import type { TicketDetail } from "../types";

const errorText = (e: unknown) =>
  (e as { messages?: string[]; message?: string })?.messages?.[0] ?? (e as Error)?.message ?? "Something went wrong";

const DURATIONS = [15, 30, 45, 60, 90];

function tomorrowAt10(): { date: string; time: string } {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: "10:00" };
}

/** "Teams meeting" on a ticket: books a Teams meeting through the Power Automate
 *  flow; everyone picked gets an Outlook invite with the Join link. Shown to the
 *  assignee and ticket managers once Teams is connected. */
export function TeamsMeetingButton({ ticket }: { ticket: TicketDetail }) {
  const status = useTeamsStatus();
  const [open, setOpen] = useState(false);
  if (!status.data?.configured || !ticket.viewer.canWork) return null;
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Video className="size-4" />
        Teams meeting
      </Button>
      {open ? <TeamsMeetingDialog ticket={ticket} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function TeamsMeetingDialog({ ticket, onClose }: { ticket: TicketDetail; onClose: () => void }) {
  const { user } = useAuth();
  const people = useTicketPeople();
  const book = useTeamsMeeting();
  const qc = useQueryClient();
  const { toast } = useToast();
  const initial = useMemo(() => tomorrowAt10(), []);
  const [subject, setSubject] = useState(`${ticket.key}: ${ticket.title}`.slice(0, 250));
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [duration, setDuration] = useState(30);
  const [note, setNote] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());

  // Start with the assignee and the watchers (not me).
  useEffect(() => {
    const ids = [ticket.assignee?.id, ...(ticket.watchers ?? []).map((w) => w.id)].filter(
      (id): id is string => !!id && id !== user?.id,
    );
    setPicked(new Set(ids));
  }, [ticket, user?.id]);

  const toggle = (id: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const start = new Date(`${date}T${time}`);
  const valid = subject.trim() && !Number.isNaN(start.getTime()) && start.getTime() > Date.now() && picked.size > 0;

  const submit = () =>
    book.mutate(
      {
        subject: subject.trim(),
        text: note.trim() || undefined,
        start: start.toISOString(),
        durationMinutes: duration,
        attendeeIds: [...picked],
        ticketKey: ticket.key,
      },
      {
        onSuccess: (r) => {
          toast({ title: r.ok ? "Teams meeting booked" : "Not booked", description: r.detail, variant: r.ok ? "success" : "error" });
          if (r.ok) {
            void qc.invalidateQueries({ queryKey: queryKeys.tickets.activity(ticket.key) });
            onClose();
          }
        },
        onError: (e) => toast({ title: "Not booked", description: errorText(e), variant: "error" }),
      },
    );

  const others = (people.data ?? []).filter((p) => p.id !== user?.id);

  return (
    <Dialog
      open
      onClose={onClose}
      title="Book a Teams meeting"
      description="Everyone you pick gets an Outlook invite with a Join Teams meeting link."
      icon={<Video className="size-5" />}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="default" disabled={!valid} loading={book.isPending} onClick={submit}>
            Send invites
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Subject" htmlFor="tm-subject">
          <Input id="tm-subject" value={subject} maxLength={250} onChange={(e) => setSubject(e.target.value)} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Date" htmlFor="tm-date">
            <Input id="tm-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Start" htmlFor="tm-time" hint="Your local time">
            <Input id="tm-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
          <Field label="Length" htmlFor="tm-len">
            <Select id="tm-len" value={String(duration)} onChange={(e) => setDuration(Number(e.target.value))}>
              {DURATIONS.map((d) => (
                <option key={d} value={d}>
                  {d} min
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div>
          <div className="mb-1.5 text-sm font-medium text-foreground">Invite</div>
          <div className="max-h-48 overflow-y-auto rounded-lg border border-border p-2">
            {others.length === 0 ? (
              <p className="px-1 py-2 text-sm text-muted-foreground">Loading people…</p>
            ) : (
              others.map((p) => (
                <label key={p.id} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-muted">
                  <input
                    type="checkbox"
                    className="size-4 accent-[var(--color-primary)]"
                    checked={picked.has(p.id)}
                    onChange={() => toggle(p.id)}
                  />
                  <span className="flex-1">{p.name}</span>
                  <span className="text-xs text-muted-foreground">{p.email}</span>
                </label>
              ))
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {picked.size} selected. Invites go to each person&apos;s Teams address (Settings → Profile).
          </p>
        </div>
        <Field label="Note (optional)" htmlFor="tm-note" hint="Added to the invite with a link to this ticket.">
          <Textarea id="tm-note" rows={3} maxLength={4000} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}
