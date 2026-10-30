import { forwardRef } from "react";
import { cn } from "@/lib/utils/cn";

const base =
  // DS "Input" (node 1928:3989): h-8 (32) · px-2.5 (10) · radius-lg (10) ·
  // 14/20 regular · 1px --border. Was rounded-md + text-table; 13px is not a
  // step on the scale, and select.tsx was already on radius-lg + text-sm, so
  // the three form controls disagreed with each other as well as with the DS.
  "w-full rounded-lg border border-border bg-card px-2.5 text-sm text-foreground transition-colors " +
  "placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-none " +
  "focus-visible:ring-4 focus-visible:ring-accent disabled:opacity-60 " +
  "aria-[invalid=true]:border-destructive aria-[invalid=true]:focus-visible:ring-destructive-subtle";

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={cn(base, "h-8", className)} {...props} />
  ),
);
Input.displayName = "Input";
