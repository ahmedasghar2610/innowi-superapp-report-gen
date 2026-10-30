import { Clock, CircleCheck, Eye, ArrowUpRight, type LucideIcon } from "lucide-react";
import { Badge, type BadgeTone } from "@/components/ui";
import type { ChangeItem, ChangeStatus } from "../data/command-center.mock";

/*
 * 5 · Change card (Figma node 20:436): title 14/20 semibold + status pill ·
 * "owner · date · module" 12/16 muted · outcome row: Expected → Result.
 */
const STATUS: Record<ChangeStatus, { tone: BadgeTone; icon: LucideIcon }> = {
  Measuring: { tone: "accent", icon: Clock },
  Confirmed: { tone: "success", icon: CircleCheck },
  Review: { tone: "accent", icon: Eye },
};

export function ChangeCard({ item }: { item: ChangeItem }) {
  const s = STATUS[item.status];
  return (
    <div className="flex flex-col gap-[9px] rounded-lg border border-border bg-card px-4 py-3.5">
      <div className="flex items-start gap-[7px]">
        <h3 className="min-w-0 flex-1 text-sm font-semibold leading-5 text-foreground">{item.title}</h3>
        <Badge tone={s.tone} icon={s.icon}>
          {item.status}
        </Badge>
      </div>
      <p className="whitespace-pre text-xs leading-4 text-muted-foreground">{`${item.owner}  ·  ${item.date}  ·  ${item.module}`}</p>
      <div className="flex flex-wrap items-center gap-1.5 text-xs leading-4">
        <span className="whitespace-pre text-muted-foreground">{`Expected  ${item.expected}`}</span>
        <ArrowUpRight className="size-4 text-muted-foreground" aria-hidden />
        <span className="whitespace-pre font-medium text-foreground">{`Result  ${item.result}`}</span>
      </div>
    </div>
  );
}
