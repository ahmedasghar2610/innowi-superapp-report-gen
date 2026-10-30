"use client";

import { useEffect, useRef, useState } from "react";
import { LogOut, User } from "lucide-react";
import { useAuth } from "@/features/auth/auth-context";
import { ROLE_LABELS, userInitials, userDisplayName } from "@/features/auth/types";
import { cn } from "@/lib/utils/cn";

/**
 * Account avatar + dropdown in the Topbar. Shows the signed-in user (from
 * AuthProvider, hydrated via GET /auth/me) and exposes sign out. A skeleton
 * avatar renders while the user is still resolving on first load.
 */
export function AccountMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (user === undefined) {
    return <div className="size-6 animate-pulse rounded-full bg-accent" aria-hidden />;
  }

  if (!user) return null;

  const fullName = userDisplayName(user);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Account menu"
        aria-expanded={open}
        title={`${fullName} · ${ROLE_LABELS[user.role]}`}
        className="grid size-6 place-items-center rounded-full bg-accent text-xs font-semibold text-primary-hover hover:brightness-95"
      >
        {userInitials(user)}
      </button>

      {open ? (
        <div
          role="menu"
          className={cn(
            "absolute right-0 top-[calc(100%+6px)] z-50 w-56 overflow-hidden rounded-md border border-border bg-card shadow-lg",
          )}
        >
          <div className="flex items-center gap-2.5 border-b border-border px-3 py-2.5">
            <div className="grid size-8 flex-shrink-0 place-items-center rounded-full bg-accent text-xs font-semibold text-primary-hover">
              {userInitials(user)}
            </div>
            <div className="min-w-0">
              <p className="truncate text-table font-semibold text-foreground">{fullName}</p>
              <p className="truncate text-xs text-muted-foreground">{ROLE_LABELS[user.role]}</p>
            </div>
          </div>
          <div className="p-1">
            <div className="flex items-center gap-2 px-2.5 py-1.5 text-xs text-muted-foreground">
              <User className="size-4" />
              <span className="truncate">{user.email}</span>
            </div>
            <button
              type="button"
              role="menuitem"
              disabled={signingOut}
              onClick={async () => {
                setSigningOut(true);
                await logout();
              }}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-table font-medium text-foreground hover:bg-secondary hover:text-foreground disabled:opacity-60"
            >
              <LogOut className="size-4" />
              {signingOut ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
