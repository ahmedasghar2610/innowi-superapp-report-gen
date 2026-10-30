import { forwardRef } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * Native select styled to match the design system. The chevron comes from the
 * `ds-select-chevron` class in globals.css (a Tailwind arbitrary value can't
 * hold the SVG: class names split on its spaces, so it was never generated).
 */
export const Select = forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      "h-8 w-full appearance-none rounded-lg border border-border bg-card pl-2.5 pr-8 text-sm text-foreground transition-colors",
      "focus-visible:border-primary focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent disabled:opacity-60 disabled:bg-muted",
      "aria-[invalid=true]:border-destructive aria-[invalid=true]:focus-visible:ring-destructive-subtle",
      "ds-select-chevron",
      className,
    )}
    {...props}
  >
    {children}
  </select>
));
Select.displayName = "Select";
