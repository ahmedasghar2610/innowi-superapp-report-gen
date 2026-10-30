"use client";

import { useEffect } from "react";
import { Mic, MicOff, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Orb, type OrbState } from "./orb";

const CAPTION: Record<OrbState, string> = {
  idle: "Tap the mic to talk",
  listening: "Listening…",
  thinking: "Looking that up…",
  speaking: "Speaking…",
};

/**
 * Hands-free mode: talk, hear the answer, and it listens again. The full
 * answer (tables, charts) still lands in the conversation behind this sheet.
 */
export function VoiceOverlay({
  phase,
  transcript,
  caption,
  error,
  onMic,
  onClose,
}: {
  phase: OrbState;
  transcript: string;
  caption?: string | null;
  error?: string | null;
  onMic: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Voice conversation"
      className="fixed inset-0 z-[60] flex flex-col items-center justify-between bg-background/85 px-6 py-10 backdrop-blur-xl"
    >
      <div className="assistant-glow pointer-events-none absolute inset-0" aria-hidden />
      <div className="relative flex w-full justify-end">
        <button
          type="button"
          onClick={onClose}
          aria-label="End voice conversation"
          className="grid size-10 place-items-center rounded-full border border-border bg-card text-foreground shadow-sm hover:bg-muted"
        >
          <X className="size-5" />
        </button>
      </div>

      <div className="relative flex flex-col items-center gap-8 text-center">
        <Orb state={phase} size={168} />
        <div aria-live="polite" className="min-h-[5.5rem] max-w-xl">
          <div className="text-sm font-medium uppercase tracking-[0.14em] text-muted-foreground">
            {caption ?? CAPTION[phase]}
          </div>
          {transcript && <p className="mt-3 text-xl font-medium leading-8 text-foreground">“{transcript}”</p>}
          {error && <p className="mt-3 text-sm text-text-destructive">{error}</p>}
        </div>
      </div>

      <div className="relative flex flex-col items-center gap-3">
        <button
          type="button"
          onClick={onMic}
          aria-label={phase === "listening" ? "Pause listening" : "Talk"}
          className={cn(
            "grid size-16 place-items-center rounded-full shadow-lg transition-transform hover:scale-105",
            phase === "listening" ? "bg-primary text-primary-foreground" : "bg-card text-foreground ring-1 ring-border",
          )}
        >
          {phase === "listening" ? <Mic className="size-7" /> : <MicOff className="size-7" />}
        </button>
        <p className="text-xs text-muted-foreground">
          {phase === "speaking" ? "Tap to interrupt and talk" : "Press Esc or ✕ to end"}
        </p>
      </div>
    </div>
  );
}
