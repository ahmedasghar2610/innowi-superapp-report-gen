"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { cn } from "@/lib/utils/cn";
import { Skeleton } from "@/components/ui";
import { useAuth } from "@/features/auth/auth-context";

function PageLoading() {
  return (
    <div className="flex flex-col gap-4 p-6" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-4 w-96 max-w-full" />
      <Skeleton className="h-64" />
    </div>
  );
}

/**
 * Application chrome: fixed left sidebar + top bar + scrollable content.
 * On large screens the sidebar is docked; below `lg` it becomes an off-canvas
 * drawer opened from the topbar hamburger.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // The assistant (/) is full-bleed and scrolls its own conversation.
  const fullBleed = usePathname() === "/";
  // Pages decide access from the signed-in user's role. Until the user has loaded, show a
  // placeholder instead of the page, so nobody sees "No access" for a moment on first load.
  const { user } = useAuth();
  const content = user === undefined ? <PageLoading /> : children;

  return (
    <div className="flex h-dvh overflow-hidden print:block print:h-auto print:overflow-visible">
      {/* Docked sidebar (lg+) */}
      <div className="hidden flex-shrink-0 border-r border-sidebar-border lg:block print:!hidden">
        <Sidebar />
      </div>

      {/* Off-canvas sidebar (< lg) */}
      <div
        className={cn(
          "fixed inset-y-0 left-0 z-50 border-r border-sidebar-border shadow-xl transition-transform duration-200 lg:hidden print:hidden",
          mobileNavOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <Sidebar onNavigate={() => setMobileNavOpen(false)} />
      </div>
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          onClick={() => setMobileNavOpen(false)}
          aria-hidden
        />
      )}

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col print:block">
        <div className="print:hidden">
          <Topbar onOpenNav={() => setMobileNavOpen(true)} />
        </div>
        {fullBleed ? (
          <main className="min-h-0 flex-1 overflow-hidden">{content}</main>
        ) : (
          <main className="flex-1 overflow-y-auto print:overflow-visible">
            <div className="mx-auto max-w-[1392px] px-6 pb-16 pt-6 print:max-w-none print:p-0">{content}</div>
          </main>
        )}
      </div>
    </div>
  );
}
