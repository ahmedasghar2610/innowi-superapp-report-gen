import { FileInput } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { sourceLabel, sourceText } from "./labels";

/**
 * Small grey "where this record came from" chip: Churn workbook, Marketing import,
 * Added by hand… The file, slug or deal behind it shows on hover.
 */
export function SourceBadge({
  source,
  detail,
  className,
}: {
  source: string | null | undefined;
  detail?: string | null;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-md border border-border bg-muted px-1.5 py-0.5 text-xs leading-4 text-muted-foreground",
        className,
      )}
      title={`Added via: ${sourceText(source, detail)}`}
    >
      <FileInput className="size-3 shrink-0" aria-hidden />
      <span className="truncate">{sourceLabel(source)}</span>
    </span>
  );
}
