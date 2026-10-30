"use client";

import { useMemo, useState } from "react";
import { MessageSquare, MoreHorizontal, Pencil, Pin, PinOff, SquarePen, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useChats, useDeleteChat, useRenameChat } from "../api";
import type { ChatBrief } from "../types";
import { relativeDay } from "../utils";

const ORDER = ["Pinned", "Today", "Yesterday", "Previous 7 days", "Older"] as const;

export function ChatHistory({
  activeId,
  onSelect,
  onNew,
  onDeleted,
}: {
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDeleted: (id: string) => void;
}) {
  const { data, isPending, isError } = useChats();
  const groups = useMemo(() => {
    const map = new Map<string, ChatBrief[]>();
    for (const c of data ?? []) {
      const key = c.pinned ? "Pinned" : relativeDay(c.updatedAt);
      map.set(key, [...(map.get(key) ?? []), c]);
    }
    return ORDER.filter((k) => map.has(k)).map((k) => [k, map.get(k)!] as const);
  }, [data]);

  return (
    <nav aria-label="Your conversations" className="flex h-full flex-col">
      <div className="p-3">
        <button
          type="button"
          onClick={onNew}
          className="flex w-full items-center gap-2 rounded-[var(--radius-lg)] border border-border bg-card px-3 py-2 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted"
        >
          <SquarePen className="size-4 text-primary" aria-hidden />
          New chat
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {isPending && (
          <div className="space-y-2 px-2 pt-1">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-7 animate-pulse rounded-md bg-muted" />
            ))}
          </div>
        )}
        {isError && <p className="px-3 text-xs text-muted-foreground">Couldn&apos;t load your chats.</p>}
        {!isPending && !isError && groups.length === 0 && (
          <p className="px-3 pt-2 text-xs leading-5 text-muted-foreground">
            Your conversations show up here. Only you can see them.
          </p>
        )}
        {groups.map(([label, chats]) => (
          <div key={label} className="mt-3 first:mt-1">
            <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
            <ul>
              {chats.map((c) => (
                <ChatRow key={c.id} chat={c} active={c.id === activeId} onSelect={onSelect} onDeleted={onDeleted} />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}

function ChatRow({
  chat,
  active,
  onSelect,
  onDeleted,
}: {
  chat: ChatBrief;
  active: boolean;
  onSelect: (id: string) => void;
  onDeleted: (id: string) => void;
}) {
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(chat.title);
  const [confirming, setConfirming] = useState(false);
  const rename = useRenameChat();
  const remove = useDeleteChat();

  if (editing) {
    return (
      <li className="px-1 py-0.5">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim()) rename.mutate({ id: chat.id, title: title.trim() });
            setEditing(false);
          }}
        >
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => setEditing(false)}
            onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
            maxLength={120}
            aria-label="Chat name"
            className="w-full rounded-md border border-primary-border bg-card px-2 py-1.5 text-sm outline-none"
          />
        </form>
      </li>
    );
  }

  return (
    <li className="group/row relative">
      <button
        type="button"
        onClick={() => onSelect(chat.id)}
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-3 py-1.5 pr-8 text-left text-sm transition-colors",
          active ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground" : "text-foreground hover:bg-muted",
        )}
        aria-current={active ? "page" : undefined}
      >
        <MessageSquare className="size-3.5 shrink-0 opacity-50" aria-hidden />
        <span className="truncate">{chat.title}</span>
      </button>
      <button
        type="button"
        aria-label={`Options for ${chat.title}`}
        onClick={() => {
          setMenu((m) => !m);
          setConfirming(false);
        }}
        className={cn(
          "absolute right-1 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:bg-background hover:text-foreground",
          menu ? "opacity-100" : "opacity-0 focus:opacity-100 group-hover/row:opacity-100",
        )}
      >
        <MoreHorizontal className="size-4" />
      </button>
      {menu && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setMenu(false)} aria-hidden />
          <div className="absolute right-1 top-8 z-30 w-44 overflow-hidden rounded-[var(--radius-lg)] border border-border bg-popover p-1 text-sm shadow-lg">
            <MenuItem
              icon={chat.pinned ? PinOff : Pin}
              label={chat.pinned ? "Unpin" : "Pin"}
              onClick={() => {
                rename.mutate({ id: chat.id, pinned: !chat.pinned });
                setMenu(false);
              }}
            />
            <MenuItem
              icon={Pencil}
              label="Rename"
              onClick={() => {
                setTitle(chat.title);
                setEditing(true);
                setMenu(false);
              }}
            />
            {confirming ? (
              <MenuItem
                icon={Trash2}
                label="Click again to delete"
                danger
                onClick={() => {
                  remove.mutate(chat.id, { onSuccess: () => onDeleted(chat.id) });
                  setMenu(false);
                }}
              />
            ) : (
              <MenuItem icon={Trash2} label="Delete" danger onClick={() => setConfirming(true)} />
            )}
          </div>
        </>
      )}
    </li>
  );
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
  danger,
}: {
  icon: typeof Pin;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left hover:bg-muted",
        danger ? "text-text-destructive" : "text-foreground",
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {label}
    </button>
  );
}
