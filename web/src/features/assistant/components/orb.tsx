import { cn } from "@/lib/utils/cn";

export type OrbState = "idle" | "thinking" | "listening" | "speaking";

/**
 * The assistant's face: a soft, slowly turning Signal Blue sphere. It breathes
 * when idle, spins faster while thinking, ripples while listening and pulses
 * while speaking. Pure CSS (see .assistant-orb in globals.css); reduced-motion
 * users get a still sphere.
 */
export function Orb({ state = "idle", size = 40, className }: { state?: OrbState; size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("assistant-orb relative inline-block shrink-0", `assistant-orb--${state}`, className)}
      style={{ width: size, height: size }}
    >
      {state === "listening" && (
        <>
          <span className="assistant-orb-ring" />
          <span className="assistant-orb-ring" style={{ animationDelay: "0.6s" }} />
        </>
      )}
      <span className="assistant-orb-core" />
      <span className="assistant-orb-shine" />
    </span>
  );
}
