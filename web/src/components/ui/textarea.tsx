import { forwardRef } from "react";
import { cn } from "@/lib/utils/cn";

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, rows = 3, ...props }, ref) => (
  <textarea
    ref={ref}
    rows={rows}
    className={cn(
      // DS "Textarea" (node 1984:1853): min-h 64 · px-2.5 (10) · py-2 (8) ·
      // radius-lg (10) · 14/20 regular · 1px --border.
      "min-h-16 w-full resize-y rounded-lg border border-border bg-card px-2.5 py-2 text-sm leading-5 text-foreground transition-colors",
      "placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent disabled:opacity-60",
      "aria-[invalid=true]:border-destructive aria-[invalid=true]:focus-visible:ring-destructive-subtle",
      className,
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";
