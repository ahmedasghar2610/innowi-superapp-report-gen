"use client";

import { useEffect, useRef, useState } from "react";

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return true;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Counts from the previous value to `value` with an ease-out, so numbers
 * "roll" into place on first load and again when a manager switches person.
 * Reduced-motion users get the final number straight away.
 */
export function useCountUp(value: number, durationMs = 900): number {
  const [shown, setShown] = useState(0);
  const from = useRef(0);

  useEffect(() => {
    if (prefersReducedMotion()) {
      setShown(value);
      from.current = value;
      return;
    }
    const start = performance.now();
    const origin = from.current;
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(origin + (value - origin) * eased);
      if (t < 1) frame = requestAnimationFrame(tick);
      else from.current = value;
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      from.current = value;
    };
  }, [value, durationMs]);

  return shown;
}

export function AnimatedNumber({
  value,
  format,
  className,
}: {
  value: number;
  format: (n: number) => string;
  className?: string;
}) {
  const shown = useCountUp(value);
  return (
    <span className={className} aria-label={format(value)}>
      <span aria-hidden>{format(shown)}</span>
    </span>
  );
}

const compactUsd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});
const wholeNumber = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** $1.2K / $3.4M — headline money. */
export const fmtMoney = (n: number) => compactUsd.format(Math.round(n));
/** 1,234 */
export const fmtCount = (n: number) => wholeNumber.format(Math.round(n));
/** 64% */
export const fmtPercent = (n: number) => `${Math.round(n)}%`;
