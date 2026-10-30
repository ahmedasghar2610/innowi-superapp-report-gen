import { forwardRef } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export type ButtonVariant = "default" | "outline" | "secondary" | "ghost" | "destructive" | "link";
export type ButtonSize = "xs" | "sm" | "default" | "lg";
export type IconButtonSize = "icon-xs" | "icon-sm" | "icon" | "icon-lg";

const variants: Record<ButtonVariant, string> = {
  default:
    "bg-primary text-primary-foreground border border-transparent hover:bg-primary-hover active:bg-primary-active focus-visible:border-primary",
  outline:
    "bg-card text-foreground border border-border hover:bg-accent focus-visible:border-primary",
  secondary:
    "bg-secondary text-secondary-foreground border border-transparent hover:bg-accent focus-visible:border-primary",
  ghost:
    "bg-transparent text-foreground border border-transparent hover:bg-accent focus-visible:border-primary",
  destructive:
    "bg-destructive text-destructive-foreground border border-transparent hover:opacity-90 focus-visible:border-destructive",
  link: "bg-transparent text-primary border border-transparent underline-offset-4 hover:underline p-0! h-auto!",
};

/*
 * Read off the DS "Button" page (node 72:2719) via get_design_context on the
 * Variant=Default variants for each size:
 *
 *   xs       h-6 (24) · px-2  (8)  · radius-sm (6)  · 12/16 · icon 12
 *   sm       h-7 (28) · px-2.5(10) · radius-sm (6)  · 12/16 · icon 16
 *   default  h-8 (32) · px-2.5(10) · radius-lg (10) · 14/20 · icon 16
 *   lg       h-9 (36) · px-2.5(10) · radius-lg (10) · 14/20 · icon 16
 *
 * Two things were off: default/lg used radius-md (8px) rather than the
 * specified radius-lg (10px), and every size forced 16px icons via a single
 * base rule — xs is specified at 12px. Icon sizing therefore moved out of the
 * base class and onto each size, so the exception is expressible at all.
 */
const sizes: Record<ButtonSize, string> = {
  xs: "h-6 px-2 text-xs rounded-sm gap-1 [&_svg]:size-4",
  sm: "h-7 px-2.5 text-xs rounded-sm gap-1 [&_svg]:size-4",
  default: "h-8 px-2.5 text-sm rounded-lg gap-1 [&_svg]:size-4",
  lg: "h-9 px-2.5 text-sm rounded-lg gap-1 [&_svg]:size-4",
};

/** Icon-only buttons mirror the radius and glyph size of the size they match. */
const iconSizes: Record<IconButtonSize, string> = {
  "icon-xs": "size-6 rounded-sm [&_svg]:size-4",
  "icon-sm": "size-7 rounded-sm [&_svg]:size-4",
  icon: "size-8 rounded-lg [&_svg]:size-4",
  "icon-lg": "size-9 rounded-lg [&_svg]:size-4",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize | IconButtonSize;
  /** Shows a spinner and disables the button. */
  loading?: boolean;
}

function isIconSize(size: ButtonSize | IconButtonSize): size is IconButtonSize {
  return size.startsWith("icon");
}

/** Primary action control. For icon-only buttons, use size="icon" / "icon-xs" / "icon-sm" / "icon-lg". */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "outline", size = "default", type = "button", loading, disabled, children, ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex select-none items-center justify-center whitespace-nowrap font-medium transition-colors",
        "focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50",
        "[&_svg]:shrink-0",
        variants[variant],
        isIconSize(size) ? iconSizes[size] : sizes[size],
        className,
      )}
      {...props}
    >
      {loading && <Loader2 className="animate-spin" aria-hidden />}
      {children}
    </button>
  ),
);
Button.displayName = "Button";
