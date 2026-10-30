import Link from "next/link";
import { Info, CircleCheck, TriangleAlert, CircleAlert, ArrowRight, type LucideIcon } from "lucide-react";
import { Skeleton } from "./skeleton";
import { cn } from "@/lib/utils/cn";

export type StatTone = "ok" | "warning" | "danger" | "neutral";

const TONE: Record<StatTone, { className: string; icon: LucideIcon | null }> = {
  ok: { className: "text-success-subtle-foreground", icon: CircleCheck },
  warning: { className: "text-warning-text", icon: TriangleAlert },
  danger: { className: "text-text-destructive", icon: CircleAlert },
  neutral: { className: "text-muted-foreground", icon: null },
};

export interface StatTileProps {
  label: string;
  /** Optional leading icon beside the label (16px, muted). */
  icon?: LucideIcon;
  value: React.ReactNode;
  /** One-line status under the value; takes the tone's colour and status icon. */
  status?: string;
  tone?: StatTone;
  hint?: string;
  loading?: boolean;
  /** Makes the tile a link (Overview tiles deep-link to their section). */
  href?: string;
  scroll?: boolean;
  className?: string;
}

/**
 * Command Center "KPI card" (Figma Super-Admin-App · node 17:189) without the
 * sparkline: label 12/16 muted (+ info) · value 24/32 semibold · status row
 * 12/16 in the state colour, always icon + text (Brand Book).
 */
export function StatTile({ label, icon: Icon, value, status, tone = "neutral", hint, loading, href, scroll, className }: StatTileProps) {
  const t = TONE[tone];
  const StatusIcon = t.icon;
  const body = (
    <>
      <div className="flex items-center gap-1.5">
        {Icon && <Icon className="size-4 text-muted-foreground" aria-hidden />}
        <span className="min-w-0 flex-1 truncate text-xs font-medium leading-4 text-muted-foreground">{label}</span>
        {hint ? (
          <Info className="size-4 text-muted-foreground" aria-label={hint} />
        ) : href ? (
          <ArrowRight className="size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
        ) : null}
      </div>
      <div className="text-2xl font-semibold leading-8 tabular-nums text-foreground">
        {loading ? <Skeleton className="h-7 w-14" /> : value}
      </div>
      {status !== undefined && (
        <div className={cn("flex min-h-4 items-center gap-1 text-xs leading-4", t.className)}>
          {!loading && StatusIcon && <StatusIcon className="size-4 shrink-0" aria-hidden />}
          <span className="truncate">{loading ? "" : status}</span>
        </div>
      )}
    </>
  );
  const cls = cn(
    "group flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-card px-4 py-3.5",
    href && "transition-colors hover:border-primary-border focus-visible:outline-none",
    className,
  );
  return href ? (
    <Link href={href} scroll={scroll} className={cls} title={hint}>
      {body}
    </Link>
  ) : (
    <div className={cls} title={hint}>
      {body}
    </div>
  );
}
