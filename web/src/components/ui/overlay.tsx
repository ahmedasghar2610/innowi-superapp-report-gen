"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils/cn";

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

export interface OverlayProps {
  open: boolean;
  onClose: () => void;
  /** Escape key and backdrop click close the overlay (default true). */
  dismissible?: boolean;
  /** Classes on the flex wrapper that positions the panel (e.g. centering vs. right-aligned). */
  wrapClassName?: string;
  /** Render-prop panel; `visible` drives enter/exit transitions. */
  children: (visible: boolean) => React.ReactNode;
}

/**
 * Low-level modal surface shared by Dialog and Drawer. Handles: portal to
 * <body>, backdrop, Escape to close, body scroll-lock, focus trap, and
 * focus restore on close, plus a mounted→visible flag for enter/exit
 * animation (the node stays mounted ~200ms after `open` flips to false).
 */
export function Overlay({ open, onClose, dismissible = true, wrapClassName, children }: OverlayProps) {
  const [mounted, setMounted] = useState(false);
  const [render, setRender] = useState(open);
  const [visible, setVisible] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const lastActive = useRef<HTMLElement | null>(null);
  // Latest onClose without re-running the focus effect: callers often pass a new
  // function every render, and re-running it moved focus back to the first
  // button (the ✕) on every keystroke inside the dialog.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => setMounted(true), []);

  // Enter / exit lifecycle.
  useEffect(() => {
    if (open) {
      lastActive.current = document.activeElement as HTMLElement | null;
      setRender(true);
      const id = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(id);
    }
    setVisible(false);
    const t = setTimeout(() => setRender(false), 200);
    return () => clearTimeout(t);
  }, [open]);

  // Scroll lock while rendered.
  useEffect(() => {
    if (!render) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [render]);

  // Escape + focus trap while rendered.
  useEffect(() => {
    if (!render) return;
    const wrap = wrapRef.current;
    const list = () =>
      Array.from(wrap?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(
        (el) => el.offsetParent !== null,
      );

    const focusId = requestAnimationFrame(() => {
      const items = list();
      // A field marked data-autofocus gets the focus first (e.g. a confirmation input).
      (items.find((el) => el.hasAttribute("data-autofocus")) ?? items[0] ?? wrap)?.focus();
    });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dismissible) {
        e.stopPropagation();
        onCloseRef.current();
      } else if (e.key === "Tab") {
        const items = list();
        if (items.length === 0) {
          e.preventDefault();
          return;
        }
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", onKey, true);
    return () => {
      cancelAnimationFrame(focusId);
      document.removeEventListener("keydown", onKey, true);
      lastActive.current?.focus?.();
    };
  }, [render, dismissible]);

  if (!mounted || !render) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100]">
      <div
        aria-hidden
        className={cn(
          "absolute inset-0 bg-black/45 backdrop-blur-[1px] transition-opacity duration-200",
          visible ? "opacity-100" : "opacity-0",
        )}
      />
      <div
        ref={wrapRef}
        tabIndex={-1}
        className={cn("absolute inset-0 flex outline-none", wrapClassName)}
        onMouseDown={(e) => {
          if (dismissible && e.target === e.currentTarget) onClose();
        }}
      >
        {children(visible)}
      </div>
    </div>,
    document.body,
  );
}
