"use client";

import { createContext, useCallback, useContext, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";

interface MiaContextValue {
  /** Open the assistant, optionally with a question about `contextLabel` (a merchant name) ready to send. */
  openMia: (contextLabel?: string) => void;
}

const MiaContext = createContext<MiaContextValue | null>(null);

/**
 * "Ask MIA" (PRD §30/§12.2: ⌘J anywhere, or "Ask MIA about this merchant"
 * from the workspace header). MIA is now the real assistant on the home
 * screen (features/assistant), so opening MIA goes there; a merchant context
 * becomes a ready-to-send question. The old preview panel with example
 * answers (mia-panel.tsx) is no longer mounted.
 */
export function MiaProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  const openMia = useCallback(
    (contextLabel?: string) => {
      const ask = contextLabel && contextLabel !== "Portfolio" ? `Tell me about ${contextLabel}` : "";
      router.push(ask ? `/?ask=${encodeURIComponent(ask)}` : "/");
    },
    [router],
  );

  // ⌘J / Ctrl+J opens the assistant from anywhere.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        openMia();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openMia]);

  const value = useMemo(() => ({ openMia }), [openMia]);
  return <MiaContext.Provider value={value}>{children}</MiaContext.Provider>;
}

export function useMia(): MiaContextValue {
  const ctx = useContext(MiaContext);
  if (!ctx) throw new Error("useMia must be used within a MiaProvider");
  return ctx;
}
