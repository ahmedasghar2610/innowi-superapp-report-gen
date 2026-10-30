import Link from "next/link";
import { CirclePlus, PencilLine, Trash2, type LucideIcon } from "lucide-react";
import { Badge, type BadgeTone } from "@/components/ui";
import type { LiveChange } from "../live/changes";

/*
 * 5 · Change card, live version (same frame as Figma node 20:436): title +
 * action pill · "who · when · module · merchant" 12/16 muted · up to three
 * "field: before → after" lines from the audit log.
 */
const ACTION: Record<LiveChange["action"], { label: string; tone: BadgeTone; icon: LucideIcon }> = {
  CREATE: { label: "Added", tone: "success", icon: CirclePlus },
  UPDATE: { label: "Updated", tone: "accent", icon: PencilLine },
  DELETE: { label: "Removed", tone: "neutral", icon: Trash2 },
};

export function whenText(iso: string): string {
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function LiveChangeCard({ item }: { item: LiveChange }) {
  const a = ACTION[item.action];
  const meta = [item.owner, whenText(item.when), item.module, item.merchant].filter(Boolean).join("  ·  ");
  const body = (
    <>
      <div className="flex items-start gap-[7px]">
        <h3 className="min-w-0 flex-1 text-sm font-semibold leading-5 text-foreground">{item.title}</h3>
        <Badge tone={a.tone} icon={a.icon}>
          {a.label}
        </Badge>
      </div>
      <p className="truncate whitespace-pre text-xs leading-4 text-muted-foreground" title={new Date(item.when).toLocaleString()}>
        {meta}
      </p>
      {item.details.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-xs leading-4 text-foreground">
          {item.details.map((d) => (
            <li key={d} className="truncate">
              {d}
            </li>
          ))}
        </ul>
      )}
    </>
  );
  const cls = "flex flex-col gap-[9px] rounded-lg border border-border bg-card px-4 py-3.5";
  return item.href ? (
    <Link href={item.href} className={`${cls} transition-colors hover:border-primary-border`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}
