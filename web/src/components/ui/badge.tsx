import type { LucideIcon } from "lucide-react";
import { CircleCheck, TriangleAlert, CircleX, Database, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export type BadgeTone =
  | "neutral"
  | "accent"
  | "success"
  | "warning"
  | "danger"
  | "dataq"
  | "primary"
  | "success-solid"
  | "warning-solid"
  | "danger-solid"
  | "dataq-solid"
  | "outline";

/*
 * DS "Badge" (node 72:2718). Across all five states — Default, Secondary,
 * Destructive, Outline, Ghost — and the semantic "Custom Colors" row, a badge
 * is a flat fill plus text. Only Outline carries a border. Every tone here
 * used to add one (a 1px ring, mostly a 35% color-mix of its own hue), which
 * no DS badge has.
 *
 * The fills and text colours already matched: the DS's semantic badges are a
 * 50-step fill with 700-step text, which is exactly what the `*-subtle` /
 * `*-subtle-foreground` token pairs resolve to. `danger` is now identical to
 * the DS Destructive state (destructive-subtle + text-destructive), and
 * `neutral` to Secondary.
 */
const tones: Record<BadgeTone, string> = {
  neutral: "bg-muted text-foreground",
  accent: "bg-accent text-primary-subtle-foreground",
  success: "bg-success-subtle text-success-subtle-foreground",
  warning: "bg-warning-soft text-warning-text",
  danger: "bg-destructive-subtle text-text-destructive",
  dataq: "bg-dataq-soft text-dataq-text",
  // The DS's "Default" state — solid --primary with --primary-foreground text.
  // Named `primary` here so `tone="default"` can't be misread as "the default
  // tone", which is neutral. Used by the "Open link" badge (node 2122:2443).
  primary: "bg-primary text-primary-foreground",
  // Brand Book "Solid" state fills — for the rare status that must dominate.
  "success-solid": "bg-success text-success-foreground",
  "warning-solid": "bg-warning text-warning-foreground",
  "danger-solid": "bg-destructive text-destructive-foreground",
  "dataq-solid": "bg-data-issue text-data-issue-foreground",
  outline: "border border-border bg-transparent text-foreground",
};

/*
 * Not added: the DS's Outline (1px --border, no fill) and Ghost (bare)
 * states. Nothing uses them yet, and widening BadgeTone forces every
 * `Record<BadgeTone, string>` elsewhere to carry an entry it never reads.
 */

/*
 * Brand Book: "A status icon never travels without its label" — status is
 * always icon + text, never colour alone. Status tones therefore render their
 * Brand Book icon automatically (Success → CircleCheck · Warning →
 * TriangleAlert · Destructive → CircleX · Data issue → Database). Pass
 * `icon={SomeIcon}` to use a different Lucide glyph, or `icon={false}` to
 * opt out for a non-status use of the tone.
 */
const STATUS_ICON: Partial<Record<BadgeTone, LucideIcon>> = {
  success: CircleCheck,
  "success-solid": CircleCheck,
  warning: TriangleAlert,
  "warning-solid": TriangleAlert,
  danger: CircleX,
  "danger-solid": CircleX,
  dataq: Database,
  "dataq-solid": Database,
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  /** Leading Lucide icon. Defaults to the Brand Book status icon for status tones; `false` suppresses it. */
  icon?: LucideIcon | false;
}

/**
 * Status chip. Per the Brand Book, status is always icon + text — pass an icon
 * as the first child when the badge represents a status.
 */
/** Shared badge box: DS "Badge" (node 2277:6620) — h 22 · px-2 · gap-1 · 12/16 medium · fully rounded. */
export function badgeClassName(tone: BadgeTone, className?: string) {
  return cn(
    "inline-flex h-[22px] items-center gap-1 whitespace-nowrap rounded-full px-2 text-xs font-medium leading-4",
    "[&_svg]:size-4 [&_svg]:shrink-0",
    tones[tone],
    className,
  );
}

export function Badge({ className, tone = "neutral", icon, children, ...props }: BadgeProps) {
  const Icon = icon === false ? undefined : (icon ?? STATUS_ICON[tone]);
  return (
    <span
      className={badgeClassName(tone, className)}
      {...props}
    >
      {Icon && <Icon aria-hidden />}
      {children}
    </span>
  );
}

export interface BadgeLinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  tone?: BadgeTone;
  /** Opens in a new tab with the safe rel; default true (the DS "Open link" case). */
  external?: boolean;
}

/**
 * DS "Badge" → "Link" (node 2122:2443): a badge rendered as an anchor. Solid
 * --primary fill, --primary-foreground 12/16 medium label, trailing Lucide
 * `arrow-up-right`. Used for "Open link" style actions such as a merchant's
 * website.
 */
export function BadgeLink({
  className,
  tone = "primary",
  external = true,
  children = "Open link",
  ...props
}: BadgeLinkProps) {
  return (
    <a
      className={cn(badgeClassName(tone), "transition-colors hover:bg-primary-hover focus-visible:outline-none", className)}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      {...props}
    >
      {children}
      <ArrowUpRight aria-hidden />
    </a>
  );
}
