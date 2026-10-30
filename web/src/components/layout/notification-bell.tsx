"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlarmClock, AtSign, Bell, CircleAlert, Lightbulb, MessageSquare, RefreshCw, UserCheck } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useMarkNotificationsRead, useNotifications } from "@/features/tickets/api";
import type { AppNotification, NotificationKind } from "@/features/tickets/types";
import { cn } from "@/lib/utils/cn";

const ICON: Record<NotificationKind, { icon: LucideIcon; tone: string }> = {
  ASSIGNED: { icon: UserCheck, tone: "text-primary" },
  STATUS_CHANGED: { icon: RefreshCw, tone: "text-muted-foreground" },
  COMMENTED: { icon: MessageSquare, tone: "text-muted-foreground" },
  MENTIONED: { icon: AtSign, tone: "text-primary" },
  SLA_AT_RISK: { icon: AlarmClock, tone: "text-warning-text" },
  SLA_BREACHED: { icon: CircleAlert, tone: "text-text-destructive" },
  RESPONSE_OVERDUE: { icon: CircleAlert, tone: "text-text-destructive" },
  REQUEST_NEW: { icon: Lightbulb, tone: "text-primary" },
  REQUEST_UPDATED: { icon: Lightbulb, tone: "text-muted-foreground" },
};

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** Top-bar bell: assignments, activity on watched tickets and SLA alerts.
 *  Polls every minute; the API also runs the SLA check when it's opened. */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const { data } = useNotifications();
  const mark = useMarkNotificationsRead();
  const router = useRouter();
  const box = useRef<HTMLDivElement>(null);
  const unread = data?.unread ?? 0;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const go = (n: AppNotification) => {
    if (!n.read) mark.mutate({ ids: [n.id] });
    setOpen(false);
    if (n.ticketKey) router.push(`/ops/tickets/${n.ticketKey}`);
    else if (n.link?.startsWith("/")) router.push(n.link);
  };

  return (
    <div className="relative" ref={box}>
      <button
        type="button"
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="relative grid size-7 place-items-center rounded-sm text-foreground hover:bg-secondary"
      >
        <Bell className="size-4" />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 top-9 z-50 flex max-h-[32rem] w-[22rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-lg border border-border bg-card shadow-lg"
        >
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <span className="flex-1 text-sm font-semibold text-foreground">Notifications</span>
            {unread > 0 && (
              <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={() => mark.mutate({ all: true })}>
                Mark all read
              </button>
            )}
          </div>
          <ul className="flex-1 overflow-y-auto">
            {!data?.data.length ? (
              <li className="px-3 py-8 text-center text-sm text-muted-foreground">
                Nothing yet. You&apos;ll see assignments, comments on tickets you watch, SLA alerts and replies to your requests here.
              </li>
            ) : (
              data.data.map((n) => {
                const k = ICON[n.kind] ?? ICON.COMMENTED;
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => go(n)}
                      className={cn("flex w-full gap-2.5 border-b border-border px-3 py-2.5 text-left last:border-0 hover:bg-muted", !n.read && "bg-accent/40")}
                    >
                      <k.icon className={cn("mt-0.5 size-4 shrink-0", k.tone)} aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className={cn("block text-sm text-foreground", !n.read && "font-semibold")}>{n.title}</span>
                        {n.body && <span className="block truncate text-xs text-muted-foreground">{n.body}</span>}
                        <span className="block text-[11px] text-muted-foreground">{ago(n.createdAt)}</span>
                      </span>
                      {!n.read && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
          <div className="border-t border-border px-3 py-2 text-right">
            <Link href="/settings/notifications" onClick={() => setOpen(false)} className="text-xs font-medium text-primary hover:underline">
              Notification settings
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
