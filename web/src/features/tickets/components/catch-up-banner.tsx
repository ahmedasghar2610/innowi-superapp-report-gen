"use client";

import { useState } from "react";
import Link from "next/link";
import { AlarmClock, AtSign, CalendarDays, ClipboardList, Copy, RefreshCw, Sun, UserCheck, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button, Card, CardBody, Dialog, Textarea, useToast } from "@/components/ui";
import { useCatchUp, useDismissCatchUp, useHandover } from "../api";
import type { CatchUpItem } from "../types";

const KIND: Record<CatchUpItem["kind"], { icon: LucideIcon; tone: string }> = {
  assigned: { icon: UserCheck, tone: "text-primary" },
  urgent: { icon: AlarmClock, tone: "text-text-destructive" },
  mention: { icon: AtSign, tone: "text-primary" },
  changed: { icon: RefreshCw, tone: "text-muted-foreground" },
  meeting: { icon: CalendarDays, tone: "text-muted-foreground" },
};

function sinceLabel(iso: string) {
  const h = Math.round((Date.now() - new Date(iso).getTime()) / 3_600_000);
  if (h < 1) return "the last hour";
  if (h < 24) return `the last ${h}h`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `the last ${d} days`;
}

/** "While you were out" — what's new for me since I last dismissed it. */
export function CatchUpBanner() {
  const { data } = useCatchUp();
  const dismiss = useDismissCatchUp();
  const [open, setOpen] = useState(false);
  const [handover, setHandover] = useState(false);

  if (!data || data.items.length === 0) return null;
  const c = data.counts;
  const parts = [
    c.assigned && `${c.assigned} new for you`,
    c.urgent && `${c.urgent} urgent`,
    c.mentions && `${c.mentions} mention${c.mentions === 1 ? "" : "s"}`,
    c.changed && `${c.changed} updated`,
    c.meetings && `${c.meetings} meeting${c.meetings === 1 ? "" : "s"} (${c.actionItems} action item${c.actionItems === 1 ? "" : "s"})`,
  ].filter(Boolean);

  return (
    <Card className="border-primary/30 bg-accent/40">
      <CardBody className="flex flex-col gap-3 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <Sun className="size-5 shrink-0 text-primary" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">While you were out</p>
            <p className="text-sm text-muted-foreground">
              In {sinceLabel(data.since)}: {parts.join(" · ")}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
              {open ? "Hide" : "Read catch-up"}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setHandover(true)}>
              Handover note
            </Button>
            <Button variant="ghost" size="sm" aria-label="Dismiss catch-up" onClick={() => dismiss.mutate()} loading={dismiss.isPending}>
              <X className="size-4" />
            </Button>
          </div>
        </div>
        {open ? (
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-card">
            {data.items.map((i, n) => {
              const k = KIND[i.kind];
              return (
                <li key={`${i.href}-${i.kind}-${n}`}>
                  <Link href={i.href} className="flex gap-2.5 px-3 py-2 hover:bg-muted">
                    <k.icon className={`mt-0.5 size-4 shrink-0 ${k.tone}`} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-foreground">{i.title}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {i.text}
                        {i.by ? ` · ${i.by}` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {new Date(i.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : null}
      </CardBody>
      <HandoverDialog open={handover} onClose={() => setHandover(false)} />
    </Card>
  );
}

/** Header button that opens the handover note. */
export function HandoverButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <ClipboardList className="size-4" />
        Handover
      </Button>
      <HandoverDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}

/** Plain-text end-of-day handover. Copy works now; posting to Teams / email waits on Microsoft 365. */
export function HandoverDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const q = useHandover(open);
  const [text, setText] = useState<string | null>(null);
  const value = text ?? q.data?.text ?? "";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      toast({ variant: "success", title: "Handover copied" });
    } catch {
      toast({ variant: "error", title: "Couldn't copy", description: "Select the text and copy it manually." });
    }
  };

  return (
    <Dialog
      open={open}
      onClose={() => {
        setText(null);
        onClose();
      }}
      size="xl"
      title="Handover note"
      description="Urgent tickets, your open work and what changed today. Edit before you copy."
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">Post to Teams / email needs Microsoft 365 to be connected.</span>
          <div className="flex gap-2">
            <Button variant="outline" disabled title="Needs Microsoft 365">
              Post to Teams
            </Button>
            <Button variant="default" onClick={copy} disabled={!value}>
              <Copy className="size-4" />
              Copy
            </Button>
          </div>
        </div>
      }
    >
      <label htmlFor="handover-text" className="sr-only">
        Handover note
      </label>
      <Textarea
        id="handover-text"
        rows={16}
        className="font-mono text-xs"
        value={q.isPending ? "Loading…" : value}
        onChange={(e) => setText(e.target.value)}
      />
    </Dialog>
  );
}
