import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui";

/**
 * Placeholder for a workspace tab whose content ships in a later phase.
 * The shell (header, summary, tab navigation) is complete; each section's
 * table/form is built next.
 */
export function TabPlaceholder({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <Card>
      <div className="flex flex-col items-center px-5 py-14 text-center">
        <div className="mb-3.5 grid size-12 place-items-center rounded-[13px] bg-primary text-primary-hover">
          <Icon className="size-6" />
        </div>
        <p className="text-base font-semibold text-foreground">{title}</p>
        <p className="mt-1 max-w-md text-table text-muted-foreground">{description}</p>
      </div>
    </Card>
  );
}
