"use client";

import { useRouter } from "next/navigation";
import { Lightbulb, Target, ChartLine, Clock } from "lucide-react";
import { Button } from "@/components/ui";
import type { Recommendation } from "../data/command-center.mock";
import { cn } from "@/lib/utils/cn";

/*
 * 7 · Recommendation card (Figma node 21:616): bulb + "Recommended action ·
 * merchant" 12/16 semibold Signal Blue · confidence pill · title 16/24
 * semibold · three meta rows (110px label column) · actions: primary
 * "Open in module" · outline "Log a change" · ghost "Snooze" (28px).
 */
export function RecommendationCard({ item }: { item: Recommendation }) {
  const router = useRouter();
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card px-4 py-3.5">
      <div className="flex items-center gap-[7px]">
        <Lightbulb className="size-4 text-primary" aria-hidden />
        <span className="whitespace-pre text-xs font-semibold leading-4 text-primary">{`Recommended action  ·  ${item.merchant}`}</span>
        <span className="ml-2.5 inline-flex items-center rounded-full bg-muted py-[3px] pl-2 pr-2.5 text-xs font-medium leading-4 text-muted-foreground">
          <span className="whitespace-pre">{`Confidence  ${item.confidence}`}</span>
        </span>
      </div>
      <h3 className="text-base font-semibold leading-6 text-foreground">{item.title}</h3>
      <dl className="flex flex-col gap-1.5 text-xs leading-4">
        <MetaRow icon={Target} label="Expected impact" value={item.expectedImpact} />
        <MetaRow icon={ChartLine} label="Measured on" value={item.measuredOn} />
        <MetaRow icon={Clock} label="Window" value={item.window} valueClassName={item.blocking ? "text-text-destructive" : undefined} />
      </dl>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="default" onClick={() => router.push(item.href)}>
          {item.cta ?? "Open in module"}
        </Button>
        <Button size="sm" variant="outline">
          Log a change
        </Button>
        <Button size="sm" variant="ghost">
          Snooze
        </Button>
      </div>
    </div>
  );
}

function MetaRow({
  icon: Icon,
  label,
  value,
  valueClassName,
}: {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="flex items-center gap-[7px]">
      <Icon className="size-4 text-muted-foreground" aria-hidden />
      <dt className="w-[110px] shrink-0 text-muted-foreground">{label}</dt>
      <dd className={cn("min-w-0 flex-1 whitespace-pre-wrap font-medium text-foreground", valueClassName)}>{value}</dd>
    </div>
  );
}
