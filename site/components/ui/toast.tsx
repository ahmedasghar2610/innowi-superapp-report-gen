"use client";

/**
 * Minimal toast for the /admin editor. The editor is copied from the Super
 * App (scripts/sync-editor.cjs), where it imports the Super App's toast from
 * "@/components/ui/toast" — this file provides the same `useToast()` API here,
 * with inline styles because the editor page doesn't use the site's Tailwind
 * theme.
 */
import { createContext, useCallback, useContext, useState } from "react";
import type React from "react";

export type ToastVariant = "info" | "success" | "warning" | "error";
export type ToastOptions = { title: string; description?: string; variant?: ToastVariant; duration?: number };
type ToastItem = ToastOptions & { id: number };
type ToastCtx = { toast: (opts: ToastOptions) => void };

const ToastContext = createContext<ToastCtx | null>(null);
const ACCENT: Record<ToastVariant, string> = {
  info: "#2c67f5",
  success: "#12a150",
  warning: "#d98b06",
  error: "#d92d20",
};

let counter = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const toast = useCallback((opts: ToastOptions) => {
    const id = ++counter;
    setItems((list) => [...list, { ...opts, id }]);
    window.setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), opts.duration ?? 4500);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div
        aria-live="polite"
        style={{ position: "fixed", right: 16, bottom: 16, zIndex: 2147483647, display: "grid", gap: 8, width: 340 }}
      >
        {items.map((t) => (
          <div
            key={t.id}
            role="status"
            style={{
              background: "#fff",
              borderLeft: `4px solid ${ACCENT[t.variant ?? "info"]}`,
              borderRadius: 8,
              boxShadow: "0 8px 24px rgba(16,24,40,.14)",
              padding: "10px 12px",
              font: '13px/1.4 "Inter", system-ui, sans-serif',
              color: "#32425b",
            }}
          >
            <strong style={{ display: "block", fontSize: 13 }}>{t.title}</strong>
            {t.description ? <span style={{ color: "#6b7280" }}>{t.description}</span> : null}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastCtx {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}
