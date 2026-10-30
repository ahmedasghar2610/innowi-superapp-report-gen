"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { FileText, KeyRound, Plus, Search } from "lucide-react";
import { Button, Card, Skeleton } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import { useCan } from "@/features/auth/use-can";
import { useLibraryTree } from "../api";
import { SECTION_LABEL, SECTION_ORDER, type LibraryPageSummary } from "../types";
import { NewPageDialog } from "./new-page-dialog";

/** Library layout: the page tree on the left, the open page on the right. */
export function LibraryShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { data: pages, isPending } = useLibraryTree();
  const [filter, setFilter] = useState("");
  const [creating, setCreating] = useState(false);
  const can = useCan();

  const term = filter.trim().toLowerCase();
  const visible = (pages ?? []).filter(
    (p) => !term || p.title.toLowerCase().includes(term) || p.merchant?.name.toLowerCase().includes(term),
  );
  const top = (section: string) => visible.filter((p) => p.section === section && !p.parentId);
  const children_ = (id: string) => visible.filter((p) => p.parentId === id);

  const item = (p: LibraryPageSummary, nested = false) => {
    const href = `/ops/library/${p.id}`;
    const active = pathname === href;
    return (
      <Link
        key={p.id}
        href={href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
          nested && "pl-7",
          active ? "bg-accent font-medium text-primary-subtle-foreground" : "text-foreground hover:bg-muted",
        )}
      >
        <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="truncate">{p.section === "MERCHANT" && p.merchant ? `${p.merchant.name} · ${p.title}` : p.title}</span>
      </Link>
    );
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-[-0.011em] text-foreground">Library</h1>
          <p className="mt-1 text-table text-muted-foreground">
            Guidelines, processes, templates and each merchant&apos;s brand notes — plus the logins the team holds.
          </p>
        </div>
        {can("library.edit") && (
          <Button variant="default" size="sm" onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            New page
          </Button>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <Card className="self-start p-2">
          <label className="relative mb-1 block">
            <span className="sr-only">Filter pages</span>
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter pages"
              className="h-8 w-full rounded-md border border-border bg-card pl-8 pr-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-none"
            />
          </label>
          <nav aria-label="Library pages" className="flex flex-col">
            {isPending ? (
              <div className="flex flex-col gap-2 p-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            ) : (
              SECTION_ORDER.map((section) => {
                const rows = top(section);
                return (
                  <div key={section} className="mt-2">
                    <div className="px-2 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {SECTION_LABEL[section]}
                    </div>
                    {rows.length === 0 ? (
                      <p className="px-2 py-1 text-xs text-muted-foreground">No pages yet</p>
                    ) : (
                      rows.map((p) => (
                        <div key={p.id}>
                          {item(p)}
                          {children_(p.id).map((c) => item(c, true))}
                        </div>
                      ))
                    )}
                  </div>
                );
              })
            )}
            {can("credentials.view") && (
            <div className="mt-2">
              <div className="px-2 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Restricted</div>
              <Link
                href="/ops/library/credentials"
                aria-current={pathname === "/ops/library/credentials" ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                  pathname === "/ops/library/credentials"
                    ? "bg-accent font-medium text-primary-subtle-foreground"
                    : "text-foreground hover:bg-muted",
                )}
              >
                <KeyRound className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                Credentials vault
              </Link>
            </div>
            )}
          </nav>
        </Card>
        <div className="min-w-0">{children}</div>
      </div>

      <NewPageDialog open={creating} onClose={() => setCreating(false)} pages={pages ?? []} />
    </div>
  );
}
