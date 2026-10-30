import type { LucideIcon } from "lucide-react";
import { Inbox } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icon = Inbox, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center px-5 py-12 text-center text-muted-foreground", className)}>
      <div className="mb-3.5 grid size-12 place-items-center rounded-[13px] bg-muted text-muted-foreground">
        <Icon className="size-6" aria-hidden />
      </div>
      <p className="text-base font-semibold text-foreground">{title}</p>
      {description ? <p className="mt-1 max-w-sm text-table">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
