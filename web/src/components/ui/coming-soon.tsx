import type { LucideIcon } from "lucide-react";
import { Construction } from "lucide-react";
import { Card } from "./card";

/**
 * Placeholder shown for any module/section that exists in the product design
 * (sidebar nav, merchant workspace module tabs) but hasn't been built yet.
 * Only the Merchant Profiling module — and its Profile / Contacts / Locations /
 * Services / Documents / Connections sub-tabs — has real screens today.
 */
export function ComingSoon({
  title,
  description = "This section is currently being worked on. Check back soon.",
  icon: Icon = Construction,
}: {
  title: string;
  description?: string;
  icon?: LucideIcon;
}) {
  return (
    <Card>
      <div className="flex flex-col items-center px-5 py-16 text-center">
        <div className="mb-3.5 grid size-12 place-items-center rounded-[13px] bg-muted text-muted-foreground">
          <Icon className="size-6" />
        </div>
        <p className="text-base font-semibold text-foreground">{title}</p>
        <p className="mt-1 max-w-md text-table text-muted-foreground">{description}</p>
      </div>
    </Card>
  );
}
