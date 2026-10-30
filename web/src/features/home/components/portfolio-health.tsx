"use client";

import { useState } from "react";
import Link from "next/link";
import { CircleCheck, TriangleAlert, CircleAlert, ChevronRight } from "lucide-react";
import type { CollapsedSection, ModuleHealth } from "../data/command-center.mock";
import { cn } from "@/lib/utils/cn";

/*
 * 8 · Portfolio detail (Figma node 21:894): 4-up health matrix — module name
 * 14/20 medium · three status rows (icon + count + label, 12/16) — followed by
 * collapsible summary rows (chevron · title 14/20 medium · summary 12/16)
 * that open to a short list of figures.
 */
export function PortfolioHealth({ data, collapsed }: { data: ModuleHealth[]; collapsed: CollapsedSection[] }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {data.map((m) => {
          const [ok, warn, bad] = m.labels ?? ["healthy", "need attention", "critical"];
          const body = (
            <>
              <div className="text-sm font-medium leading-5 text-foreground">{m.module}</div>
              <HealthRow icon={CircleCheck} count={m.healthy} label={ok} className="text-success" />
              <HealthRow icon={TriangleAlert} count={m.needAttention} label={warn} className="text-warning" />
              <HealthRow icon={CircleAlert} count={m.critical} label={bad} className="text-destructive" />
            </>
          );
          const cls = "flex flex-col gap-2 rounded-lg border border-border bg-card px-3.5 py-3";
          return m.href ? (
            <Link key={m.module} href={m.href} className={cn(cls, "transition-colors hover:border-primary-border")}>
              {body}
            </Link>
          ) : (
            <div key={m.module} className={cls}>
              {body}
            </div>
          );
        })}
      </div>
      {collapsed.map((row) => (
        <CollapsedRow key={row.key} row={row} />
      ))}
    </div>
  );
}

function HealthRow({
  icon: Icon,
  count,
  label,
  className,
}: {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  count: number;
  label: string;
  className: string;
}) {
  return (
    <div className="flex items-center gap-1.5 text-xs leading-4">
      <Icon className={cn("size-4", className)} aria-hidden />
      <span className={cn("font-semibold tabular-nums", className)}>{count}</span>
      <span className="text-muted-foreground">{label}</span>
    </div>
  );
}

function CollapsedRow({ row }: { row: CollapsedSection }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-border bg-card">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 px-3.5 py-3 text-left"
      >
        <ChevronRight className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-90")} aria-hidden />
        <span className="text-sm font-medium leading-5 text-foreground">{row.title}</span>
        <span className="ml-2.5 min-w-0 flex-1 truncate whitespace-pre text-xs leading-4 text-muted-foreground">{row.summary}</span>
      </button>
      {open && (
        <div className="border-t border-border px-3.5 py-2">
          {row.items?.length ? (
            <ul className="divide-y divide-border">
              {row.items.map((i) => (
                <li key={i.label} className="flex items-center gap-3 py-1.5 text-xs leading-4">
                  {i.href ? (
                    <Link href={i.href} className="min-w-0 flex-1 truncate text-foreground hover:text-primary hover:underline">
                      {i.label}
                    </Link>
                  ) : (
                    <span className="min-w-0 flex-1 truncate text-foreground">{i.label}</span>
                  )}
                  <span className="font-semibold tabular-nums text-foreground">{i.value}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-1 text-xs leading-4 text-muted-foreground">Nothing to show yet.</p>
          )}
        </div>
      )}
    </div>
  );
}
