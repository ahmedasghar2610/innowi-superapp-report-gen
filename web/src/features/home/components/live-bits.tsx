import Link from "next/link";
import { FlaskConical, Plug } from "lucide-react";
import { Skeleton } from "@/components/ui";
import { shortDay } from "../live/range";
import type { CommandCenter } from "../live/use-command-center";

/** Grey placeholder grid while the module reads are in flight. */
export function CardsSkeleton({ count, height = "h-[150px]", cols = "lg:grid-cols-2" }: { count: number; height?: string; cols?: string }) {
  return (
    <div className={`grid gap-3 ${cols}`}>
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className={`${height} w-full rounded-lg`} />
      ))}
    </div>
  );
}

/** Dashed box used when a section has no source yet. */
export function EmptyNote({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-dashed border-border bg-card px-4 py-5 text-sm leading-5 text-muted-foreground">{children}</div>;
}

/** "Connect Google Business Profile / Google Ads" call to action. */
export function ConnectNote({ cc }: { cc: CommandCenter }) {
  const missing = [!cc.connected.gbp && { label: "Google Business Profile", href: "/web/gbp" }, !cc.connected.ads && { label: "Google Ads", href: "/ads" }].filter(Boolean) as {
    label: string;
    href: string;
  }[];
  if (!missing.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-primary-border bg-primary-subtle px-4 py-3 text-sm leading-5 text-primary-subtle-foreground">
      <Plug className="size-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">
        Connect {missing.map((m) => m.label).join(" and ")} (or load their sample data) to fill this page with real numbers.
      </span>
      {missing.map((m) => (
        <Link key={m.href} href={m.href} className="text-xs font-semibold underline underline-offset-2">
          Open {m.label}
        </Link>
      ))}
    </div>
  );
}

/** One notice per page instead of a tag on every card. */
export function SampleNote({ cc }: { cc: CommandCenter }) {
  const which = [cc.sample.gbp && "Google Business Profile", cc.sample.ads && "Google Ads"].filter(Boolean) as string[];
  if (!which.length) return null;
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-muted px-4 py-2.5 text-xs leading-4 text-muted-foreground">
      <FlaskConical className="size-4 shrink-0" aria-hidden />
      <span>
        {which.join(" and ")} {which.length > 1 ? "are" : "is"} showing <b className="font-semibold text-foreground">sample data</b>. Real numbers replace it after the
        Google account is connected and the first sync runs.
      </span>
    </div>
  );
}

/** At most `perKind` cards of the same rule, so one widespread problem doesn't fill the section. */
export function varied<T extends { code?: string }>(items: T[], max: number, perKind = 2): T[] {
  const seen = new Map<string, number>();
  const out: T[] = [];
  for (const i of items) {
    const k = i.code ?? "";
    const n = seen.get(k) ?? 0;
    if (n >= perKind) continue;
    seen.set(k, n + 1);
    out.push(i);
    if (out.length === max) break;
  }
  return out;
}

/** "GBP data through 5 Oct · Ads through 7 Oct" */
export function DataThrough({ cc }: { cc: CommandCenter }) {
  const parts = [cc.windows.gbp && `GBP through ${shortDay(cc.windows.gbp.end)}`, cc.windows.ads && `Ads through ${shortDay(cc.windows.ads.end)}`].filter(Boolean);
  if (!parts.length) return null;
  return <span className="text-xs leading-4 text-muted-foreground">{parts.join("  ·  ")}</span>;
}
