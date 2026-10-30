"use client";

import { useId } from "react";
import { X } from "lucide-react";
import { Overlay } from "./overlay";
import { cn } from "@/lib/utils/cn";

const widthClasses = {
  sm: "sm:max-w-sm",
  md: "sm:max-w-md",
  lg: "sm:max-w-lg",
  xl: "sm:max-w-xl",
  "2xl": "sm:max-w-2xl",
  "3xl": "sm:max-w-3xl",
} as const;

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  side?: "right" | "left";
  size?: keyof typeof widthClasses;
  dismissible?: boolean;
  footer?: React.ReactNode;
  children?: React.ReactNode;
  hideClose?: boolean;
}

/**
 * Side sheet (drawer). Slides in from the right by default — the module's forms
 * (create/edit merchant, field editor, child-entity forms) render inside one.
 */
export function Drawer({
  open,
  onClose,
  title,
  description,
  side = "right",
  size = "md",
  dismissible = true,
  footer,
  children,
  hideClose,
}: DrawerProps) {
  const titleId = useId();
  const descId = useId();
  const closed = side === "right" ? "translate-x-full" : "-translate-x-full";

  return (
    <Overlay
      open={open}
      onClose={onClose}
      dismissible={dismissible}
      wrapClassName={side === "right" ? "justify-end" : "justify-start"}
    >
      {(visible) => (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={title ? titleId : undefined}
          aria-describedby={description ? descId : undefined}
          className={cn(
            "flex h-full w-full flex-col bg-card shadow-2xl transition-transform duration-200 ease-out",
            widthClasses[size],
            side === "right" ? "border-l border-border" : "border-r border-border",
            visible ? "translate-x-0" : closed,
          )}
        >
          <header className="flex items-start gap-3 border-b border-border p-4">
            <div className="min-w-0 flex-1">
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
            {!hideClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="-mr-1 grid size-7 shrink-0 place-items-center rounded-sm text-muted-foreground hover:bg-secondary hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            )}
          </header>

          <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>

          {footer && <footer className="flex justify-end gap-2 border-t border-border p-5">{footer}</footer>}
        </div>
      )}
    </Overlay>
  );
}
