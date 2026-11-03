/**
 * Shared motion and focus classes for the review sidebar's buttons.
 *
 * Every effect is wrapped in `motion-safe:`, so a reader who has asked their
 * system for reduced motion gets the plain button with no lift, no scale and
 * no icon movement. Every effect is also guarded by `enabled:`, so a disabled
 * control never lifts or shifts — the Button primitive additionally sets
 * `disabled:pointer-events-none`, so hover cannot fire there at all.
 *
 * These are class strings rather than components so the existing Button
 * primitive, its variants and its disabled logic stay exactly as they are.
 */

/** Lift on hover, press on click, and a visible focus ring. */
export const BTN = [
  "motion-safe:transition-all motion-safe:duration-150 motion-safe:ease-out",
  "focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card",
  "motion-safe:enabled:hover:-translate-y-px enabled:hover:shadow-sm",
  "motion-safe:enabled:active:translate-y-0 motion-safe:enabled:active:scale-[0.98]",
  "disabled:translate-y-0 disabled:shadow-none",
  // every icon inside a sidebar button animates from the same baseline
  "motion-safe:[&_svg]:transition-transform motion-safe:[&_svg]:duration-150 motion-safe:[&_svg]:ease-out",
].join(" ");

/** The primary action: a soft top-to-bottom gradient that brightens on hover. */
export const BTN_PRIMARY = [
  "bg-gradient-to-b from-primary to-primary-hover",
  "enabled:hover:brightness-110 enabled:hover:shadow-md",
  "motion-safe:enabled:hover:[&_svg]:scale-110",
].join(" ");

/** Send: the paper plane lifts away to the top right. */
export const ICON_SEND = "motion-safe:enabled:hover:[&_svg]:translate-x-0.5 motion-safe:enabled:hover:[&_svg]:-translate-y-0.5";

/** PDF / DOCX: the download arrow nudges down. */
export const ICON_DOWN = "motion-safe:enabled:hover:[&_svg]:translate-y-0.5";

/** Delete: the bin tips over, and the button takes a destructive tint. */
export const BTN_DELETE = [
  "enabled:hover:bg-destructive-subtle enabled:hover:text-text-destructive",
  "motion-safe:enabled:hover:[&_svg]:-rotate-[8deg]",
].join(" ");
