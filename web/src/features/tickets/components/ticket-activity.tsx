"use client";

import { useMemo, useRef, useState } from "react";
import { Lock, Store } from "lucide-react";
import { Button, Skeleton, Textarea, useToast } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils/cn";
import { useAddComment, useTicketActivity, useTicketPeople } from "../api";
import { PRIORITY_LABEL, STATUS_LABEL, formatDueDate } from "../labels";
import type { ActivityItem, CommentVisibility, PersonRef, TicketPriority, TicketStatus } from "../types";
import { Avatar } from "./ticket-bits";

type Ref = { name?: string } | null | undefined;

/** One sentence per change event, e.g. "changed status from New to In Progress". */
function describe(item: ActivityItem): string {
  const d = (item.data ?? {}) as Record<string, unknown>;
  const name = (r: unknown) => (r as Ref)?.name ?? "nobody";
  const status = (s: unknown) => STATUS_LABEL[s as TicketStatus] ?? String(s);
  const priority = (p: unknown) => PRIORITY_LABEL[p as TicketPriority] ?? String(p);
  const due = (v: unknown) => (v ? formatDueDate(v as string) : null);
  switch (item.event) {
    case "CREATED":
      return `created this ticket and assigned it to ${name(d.assignee)}`;
    case "STATUS_CHANGED":
      return `changed the status from ${status(d.from)} to ${status(d.to)}`;
    case "ASSIGNED":
      return d.from ? `reassigned it from ${name(d.from)} to ${name(d.to)}` : `assigned it to ${name(d.to)}`;
    case "PRIORITY_CHANGED":
      return `changed the priority from ${priority(d.from)} to ${priority(d.to)}`;
    case "DUE_DATE_CHANGED":
      if (!d.to) return `removed the due date (was ${due(d.from)})`;
      return d.from ? `moved the due date from ${due(d.from)} to ${due(d.to)}` : `set the due date to ${due(d.to)}`;
    case "UPDATED": {
      const fields = (d.fields as string[] | undefined) ?? [];
      return fields.length ? `updated the ${fields.join(", ")}` : "updated the ticket";
    }
    case "SUBTASK_ADDED":
      return `added the sub-task “${d.title}”`;
    case "SUBTASK_COMPLETED":
      return `completed “${d.title}”`;
    case "SUBTASK_REOPENED":
      return `reopened “${d.title}”`;
    case "SUBTASK_REMOVED":
      return `removed the sub-task “${d.title}”`;
    case "ATTACHMENT_ADDED":
      return `attached “${d.name}”`;
    case "ATTACHMENT_REMOVED":
      return `removed the attachment “${d.name}”`;
    default:
      return "changed the ticket";
  }
}

/** Comment text with @mentions highlighted. */
function CommentBody({ text, mentions }: { text: string; mentions: PersonRef[] }) {
  if (!mentions.length) return <>{text}</>;
  const names = mentions.map((m) => m.name).sort((a, b) => b.length - a.length);
  const re = new RegExp(`(@(?:${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")}))`, "g");
  return (
    <>
      {text.split(re).map((part, i) =>
        part.startsWith("@") && names.includes(part.slice(1)) ? (
          <span key={i} className="rounded bg-accent px-0.5 font-medium text-primary-subtle-foreground">
            {part}
          </span>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

type Filter = "all" | "comment" | "merchant" | "event";

/** Comments and change history, oldest first, with a comment box at the end.
 *  Comments are internal (team only) unless marked merchant-visible; type @
 *  to mention someone — they get a notification. */
export function TicketActivity({ ticketKey, hasMerchant = false }: { ticketKey: string; hasMerchant?: boolean }) {
  const { data, isPending } = useTicketActivity(ticketKey);
  const addComment = useAddComment(ticketKey);
  const people = useTicketPeople();
  const { toast } = useToast();
  const [body, setBody] = useState("");
  const [visibility, setVisibility] = useState<CommentVisibility>("INTERNAL");
  const [mentioned, setMentioned] = useState<PersonRef[]>([]);
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [filter, setFilter] = useState<Filter>("all");
  const box = useRef<HTMLTextAreaElement>(null);

  const items = (data ?? []).filter(
    (i) => filter === "all" || (filter === "merchant" ? i.kind === "comment" && i.visibility === "MERCHANT" : i.kind === filter),
  );
  const matches = useMemo(() => {
    if (query === null) return [];
    const q = query.toLowerCase();
    return (people.data ?? []).filter((p) => p.name.toLowerCase().includes(q) || p.email.toLowerCase().startsWith(q)).slice(0, 6);
  }, [people.data, query]);

  const onType = (value: string, caret: number) => {
    setBody(value);
    const m = /(^|\s)@([\w.'-]{0,30})$/.exec(value.slice(0, caret));
    setQuery(m ? m[2] : null);
    setActive(0);
  };

  const pick = (p: PersonRef) => {
    const el = box.current;
    const caret = el?.selectionStart ?? body.length;
    const before = body.slice(0, caret).replace(/@([\w.'-]{0,30})$/, `@${p.name} `);
    const next = before + body.slice(caret);
    setBody(next);
    setMentioned((m) => (m.some((x) => x.id === p.id) ? m : [...m, p]));
    setQuery(null);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(before.length, before.length);
    });
  };

  const post = () => {
    const text = body.trim();
    if (!text) return;
    const mentions = mentioned.filter((m) => text.includes(`@${m.name}`)).map((m) => m.id);
    addComment.mutate(
      { body: text, visibility, mentions },
      {
        onSuccess: () => {
          setBody("");
          setMentioned([]);
          setVisibility("INTERNAL");
          if (mentions.length) toast({ title: `Notified ${mentions.length} ${mentions.length === 1 ? "person" : "people"}` });
        },
        onError: (e) => toast({ variant: "error", title: "Comment not posted", description: e.messages?.[0] ?? e.message }),
      },
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 text-sm">
        {(
          [
            ["all", "All"],
            ["comment", "Comments"],
            ["merchant", "Merchant-visible"],
            ["event", "Changes"],
          ] as const
        ).map(([v, label]) => (
          <button
            key={v}
            type="button"
            onClick={() => setFilter(v)}
            aria-pressed={filter === v}
            className={
              filter === v
                ? "border-b-2 border-foreground pb-0.5 font-medium text-foreground"
                : "pb-0.5 text-muted-foreground hover:text-foreground"
            }
          >
            {label}
          </button>
        ))}
      </div>

      {isPending ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{filter === "event" || filter === "all" ? "Nothing here yet." : "No comments here yet."}</p>
      ) : (
        <ol className="flex flex-col gap-3.5">
          {items.map((item) =>
            item.kind === "comment" ? (
              <li key={item.id} className="flex gap-3">
                <Avatar name={item.actor?.name ?? "?"} size="md" />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-x-1.5 text-sm">
                    <span className="font-medium text-foreground">{item.actor?.name ?? "Deleted user"}</span>
                    <span className="text-muted-foreground">· {formatDateTime(item.createdAt)} ·</span>
                    {item.visibility === "MERCHANT" ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
                        <Store className="size-3" aria-hidden /> merchant-visible
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Lock className="size-3" aria-hidden /> internal
                      </span>
                    )}
                  </p>
                  <p
                    className={cn(
                      "mt-1 whitespace-pre-wrap break-words rounded-md text-sm leading-relaxed text-foreground",
                      item.visibility === "MERCHANT" ? "border border-border bg-card px-2.5 py-1.5" : "bg-warning-soft/60 px-2.5 py-1.5",
                    )}
                  >
                    <CommentBody text={item.body ?? ""} mentions={item.mentions ?? []} />
                  </p>
                </div>
              </li>
            ) : (
              <li key={item.id} className="pl-11 text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{item.actor?.name ?? "Someone"}</span> {describe(item)} ·{" "}
                {formatDateTime(item.createdAt)}
              </li>
            ),
          )}
        </ol>
      )}

      <div className="flex flex-col gap-2 border-t border-border pt-3">
        <div className="relative flex items-start gap-2">
          <label htmlFor="ticket-comment" className="sr-only">
            Write a comment
          </label>
          <Textarea
            id="ticket-comment"
            ref={box}
            rows={2}
            maxLength={5000}
            value={body}
            onChange={(e) => onType(e.target.value, e.target.selectionStart ?? e.target.value.length)}
            onKeyDown={(e) => {
              if (query !== null && matches.length) {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActive((a) => (a + 1) % matches.length);
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive((a) => (a - 1 + matches.length) % matches.length);
                  return;
                }
                if (e.key === "Enter" || e.key === "Tab") {
                  e.preventDefault();
                  pick(matches[active]);
                  return;
                }
                if (e.key === "Escape") {
                  setQuery(null);
                  return;
                }
              }
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) post();
            }}
            onBlur={() => setTimeout(() => setQuery(null), 150)}
            placeholder={visibility === "MERCHANT" ? "Write what the merchant is told… (Ctrl+Enter to post)" : "Write a comment… type @ to mention someone (Ctrl+Enter to post)"}
            className={cn("flex-1", visibility === "MERCHANT" && "border-primary")}
            aria-autocomplete="list"
            aria-expanded={query !== null && matches.length > 0}
          />
          <Button variant="default" onClick={post} loading={addComment.isPending} disabled={!body.trim()}>
            Post
          </Button>
          {query !== null && matches.length > 0 && (
            <ul role="listbox" aria-label="Mention someone" className="absolute bottom-full left-0 z-20 mb-1 w-64 overflow-hidden rounded-lg border border-border bg-card shadow-lg">
              {matches.map((p, i) => (
                <li key={p.id} role="option" aria-selected={i === active}>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      pick(p);
                    }}
                    className={cn("flex w-full flex-col px-3 py-1.5 text-left text-sm", i === active ? "bg-accent" : "hover:bg-muted")}
                  >
                    <span className="font-medium text-foreground">{p.name}</span>
                    <span className="text-xs text-muted-foreground">{p.email}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <div className="flex gap-0.5 rounded-md bg-muted p-0.5" role="radiogroup" aria-label="Who can see this comment">
            {(
              [
                ["INTERNAL", "Internal", Lock],
                ["MERCHANT", "Merchant-visible", Store],
              ] as const
            ).map(([v, label, Icon]) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={visibility === v}
                disabled={v === "MERCHANT" && !hasMerchant}
                title={v === "MERCHANT" && !hasMerchant ? "This ticket has no merchant" : undefined}
                onClick={() => setVisibility(v)}
                className={cn(
                  "inline-flex items-center gap-1 rounded px-2 py-1 font-medium disabled:opacity-50",
                  visibility === v ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-3" aria-hidden />
                {label}
              </button>
            ))}
          </div>
          <span className="text-muted-foreground">
            {visibility === "MERCHANT"
              ? "Records what was shared with the merchant (sent by email once Outlook is connected)."
              : "Only the team sees internal comments."}
          </span>
        </div>
      </div>
    </div>
  );
}
