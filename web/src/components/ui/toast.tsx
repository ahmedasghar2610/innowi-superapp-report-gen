"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { CircleCheck, CircleX, TriangleAlert, Info, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export type ToastVariant = "info" | "success" | "warning" | "error";

export interface ToastOptions {
  title: string;
  description?: string;
  variant?: ToastVariant;
  /** Auto-dismiss after ms; 0 disables. Default 5000. */
  duration?: number;
  /** One inline action (e.g. Undo). */
  action?: { label: string; onClick: () => void };
}

interface ToastItem extends ToastOptions {
  id: number;
}

interface ToastCtx {
  toast: (opts: ToastOptions) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastCtx | null>(null);

/** Access the imperative toast API. Must be under <ToastProvider>. */
export function useToast(): ToastCtx {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}

const ICONS: Record<ToastVariant, typeof Info> = {
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  error: CircleX,
};

const ACCENT: Record<ToastVariant, string> = {
  info: "border-l-primary [&_.t-ico]:text-primary",
  success: "border-l-success [&_.t-ico]:text-success",
  warning: "border-l-warning [&_.t-ico]:text-warning",
  error: "border-l-destructive [&_.t-ico]:text-destructive",
};

let counter = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback((opts: ToastOptions) => {
    const id = ++counter;
    setToasts((list) => [...list, { id, variant: "info", duration: 5000, ...opts }]);
    return id;
  }, []);

  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

function ToastViewport({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: number) => void }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return createPortal(
    // z-index has to clear the Studio editor's full-screen canvas
    // (`.sbve` in features/site-builder/components/editor/editor-css.ts uses
    // z-index: 2147483000, since it isn't a React-rendered overlay this
    // provider can order itself above via mount order) — otherwise toasts
    // fired from inside the editor render into the DOM/portal correctly but
    // are visually buried underneath it. 2147483641 clears that, and stays
    // below the drag-ghost's 2147483647 so an in-progress drag still wins.
    <div className="pointer-events-none fixed bottom-5 right-5 z-[2147483641] flex w-[380px] max-w-[calc(100vw-2.5rem)] flex-col gap-2.5">
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>,
    document.body,
  );
}

function ToastCard({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: number) => void }) {
  const [visible, setVisible] = useState(false);
  const variant = toast.variant ?? "info";
  const Icon = ICONS[variant];

  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const close = useCallback(() => {
    setVisible(false);
    setTimeout(() => onDismiss(toast.id), 180);
  }, [onDismiss, toast.id]);

  useEffect(() => {
    if (!toast.duration) return;
    const t = setTimeout(close, toast.duration);
    return () => clearTimeout(t);
  }, [toast.duration, close]);

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "pointer-events-auto flex gap-3 rounded-2xl border border-border border-l-[3px] bg-card p-4 shadow-2xl transition-all duration-200",
        ACCENT[variant],
        visible ? "translate-x-0 opacity-100" : "translate-x-6 opacity-0",
      )}
    >
      <Icon className="t-ico mt-0.5 size-5 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-table font-semibold text-foreground">{toast.title}</div>
        {toast.description && <div className="mt-0.5 text-table text-muted-foreground">{toast.description}</div>}
        {toast.action && (
          <button
            type="button"
            onClick={() => {
              toast.action?.onClick();
              close();
            }}
            className="mt-1.5 text-table font-semibold text-primary hover:underline"
          >
            {toast.action.label}
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={close}
        aria-label="Dismiss"
        className="-mr-1 -mt-1 grid size-6 shrink-0 place-items-center rounded-sm text-muted-foreground hover:bg-secondary hover:text-foreground"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
