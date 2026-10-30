"use client";

import { useId } from "react";
import { X } from "lucide-react";
import { Overlay } from "./overlay";
import { cn } from "@/lib/utils/cn";

type DialogTone = "default" | "primary" | "success" | "warning" | "danger";

const toneClasses: Record<DialogTone, string> = {
  default: "bg-muted text-muted-foreground",
  primary: "bg-accent text-primary-hover",
  success: "bg-success-subtle text-success-subtle-foreground",
  warning: "bg-warning-soft text-warning-text",
  danger: "bg-destructive-subtle text-text-destructive",
};

const sizeClasses = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-2xl",
  /** Wide dialogs for two-column forms (e.g. the website intake questionnaire). */
  "2xl": "max-w-3xl",
  "3xl": "max-w-4xl",
} as const;

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  /** Optional leading icon (e.g. a Lucide icon element). */
  icon?: React.ReactNode;
  tone?: DialogTone;
  size?: keyof typeof sizeClasses;
  /** Escape / backdrop click closes (default true). */
  dismissible?: boolean;
  /** Footer actions row (typically buttons). */
  footer?: React.ReactNode;
  /** Rule above the footer — for dialogs whose body scrolls. */
  footerBordered?: boolean;
  children?: React.ReactNode;
  /** Hide the top-right close button. */
  hideClose?: boolean;
}

/** Centered modal dialog. Controlled via `open` / `onClose`. */
export function Dialog({
  open,
  onClose,
  title,
  description,
  icon,
  tone = "default",
  size = "md",
  dismissible = true,
  footer,
  footerBordered,
  children,
  hideClose,
}: DialogProps) {
  const titleId = useId();
  const descId = useId();

  return (
    <Overlay open={open} onClose={onClose} dismissible={dismissible} wrapClassName="items-center justify-center p-4">
      {(visible) => (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={title ? titleId : undefined}
          aria-describedby={description ? descId : undefined}
          className={cn(
            "relative flex max-h-[calc(100dvh-2rem)] w-full flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl transition-all duration-200",
            sizeClasses[size],
            visible ? "scale-100 opacity-100" : "scale-95 opacity-0",
          )}
        >
          {!hideClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="absolute right-3 top-3 z-[3] grid size-7 place-items-center rounded-sm text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          )}

          {(icon || title || description) && (
            <div className="flex items-start gap-3 px-5 pb-1 pt-5 pr-12">
              {icon && (
                <div className={cn("grid size-9 shrink-0 place-items-center rounded-lg [&_svg]:size-5", toneClasses[tone])}>
                  {icon}
                </div>
              )}
              <div className="min-w-0">
                {title && (
                  <h2 id={titleId} className="text-base font-medium text-foreground">
                    {title}
                  </h2>
                )}
                {description && (
                  <p id={descId} className="mt-0.5 text-table text-muted-foreground">
                    {description}
                  </p>
                )}
              </div>
            </div>
          )}

          {children != null && <div className="overflow-y-auto px-5 py-3 text-sm text-foreground">{children}</div>}

          {footer && (
            <div className={cn("flex justify-end gap-2 p-4", footerBordered && "border-t border-border")}>{footer}</div>
          )}
        </div>
      )}
    </Overlay>
  );
}
