"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import { Bell, Building2, Plug, Ticket, UserRound, Users, Workflow } from "lucide-react";
import { Card } from "@/components/ui";
import { useCan } from "@/features/auth/use-can";
import type { Capability } from "@/features/auth/capabilities";
import { cn } from "@/lib/utils/cn";

interface Item {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Needed to see the page at all. */
  capability?: Capability;
}

const GROUPS: { label: string; items: Item[] }[] = [
  {
    label: "You",
    items: [
      { href: "/settings/profile", label: "Profile & security", icon: UserRound },
      { href: "/settings/notifications", label: "Notifications", icon: Bell },
    ],
  },
  {
    label: "Workspace",
    items: [
      { href: "/team-members", label: "Team & access", icon: Users, capability: "users.manage" },
      { href: "/settings/ops-crm", label: "Ops CRM", icon: Ticket },
      { href: "/settings/workspace", label: "Workspace", icon: Building2 },
      { href: "/settings/integrations", label: "Integrations", icon: Plug },
      { href: "/settings/data-setup", label: "Data setup", icon: Workflow, capability: "settings.manage" },
    ],
  },
];

/** /settings/* — section list on the left, the open section on the right. */
export function SettingsShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const can = useCan();

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-[-0.011em] text-foreground">Settings</h1>
        <p className="mt-1 text-table text-muted-foreground">
          Your profile and notifications, and how the workspace and Ops CRM are set up.
        </p>
      </div>
      <div className="grid gap-5 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <Card className="self-start p-2">
          <nav aria-label="Settings sections" className="flex flex-col">
            {GROUPS.map((g) => (
              <div key={g.label} className="mt-1 first:mt-0">
                <div className="px-2 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{g.label}</div>
                {g.items
                  .filter((i) => !i.capability || can(i.capability))
                  .map((i) => {
                    const active = pathname === i.href || pathname.startsWith(`${i.href}/`);
                    return (
                      <Link
                        key={i.href}
                        href={i.href}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                          active ? "bg-accent font-medium text-primary-subtle-foreground" : "text-foreground hover:bg-muted",
                        )}
                      >
                        <i.icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                        {i.label}
                      </Link>
                    );
                  })}
              </div>
            ))}
          </nav>
        </Card>
        <div className="flex min-w-0 flex-col gap-5">{children}</div>
      </div>
    </div>
  );
}

/** A titled card used for every settings block. */
export function SettingsCard({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      <div className="flex flex-wrap items-start gap-3 border-b border-border px-[18px] py-[13px]">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold leading-6 text-foreground">{title}</h2>
          {description && <p className="mt-0.5 text-xs leading-4 text-muted-foreground">{description}</p>}
        </div>
        {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
      </div>
      <div className="p-[18px]">{children}</div>
    </Card>
  );
}

/** "Only admins can change this" strip for read-only viewers. */
export function ViewOnlyNote({ children = "Only an Admin or Super Admin can change these settings." }: { children?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">{children}</div>
  );
}

/** Small label for things that are shown but not wired up yet. */
export function PreviewTag({ children = "Preview" }: { children?: React.ReactNode }) {
  return (
    <span className="inline-flex h-5 items-center rounded-full border border-dashed border-border px-2 text-[11px] font-medium text-muted-foreground">
      {children}
    </span>
  );
}
