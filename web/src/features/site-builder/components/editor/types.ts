// Shared editor types. This folder is copied verbatim into generated zips —
// keep every import relative (no "@/...").

export type PageSummary = {
  path: string;
  title: string;
  description?: string;
  updatedAt?: string;
};

export type PageRecord = {
  path: string;
  title: string;
  description?: string;
  html: string;
  css?: string;
};

/** Server-side dry run of a CSV import (see content-api POST { csv, dryRun }). */
export type CsvPreview = {
  mapping: Record<string, string | null>;
  rowCount: number;
  pages: Array<{ path: string; title: string; exists: boolean }>;
};

export type Device = "desktop" | "tablet" | "mobile";

export const DEVICES: Array<{ id: Device; label: string; width: number | null; maxWidth: number | null }> = [
  { id: "desktop", label: "Desktop", width: null, maxWidth: null },
  { id: "tablet", label: "Tablet", width: 1024, maxWidth: 1024 },
  { id: "mobile", label: "Mobile", width: 390, maxWidth: 767 },
];

/** A Popup/Toast/Snackbar panel currently on the page — something a link or
 * button elsewhere can be pointed at via its "Opens" field. */
export type FeedbackTarget = { id: string; label: string; kind: "popup" | "toast" | "snackbar" };

/** A clickable element or form on the page that a Toast/Snackbar can listen
 * on for its "click"/"submit" trigger. */
export type TriggerCandidate = { id: string; label: string; kind: "click" | "submit" };

/** What opens a Popup/Toast/Snackbar (data-sb-trigger). "none" = only via
 * another element's "Opens" field (data-sb-toggle), independent of this. */
export type FeedbackTrigger = "load" | "click" | "submit" | "none";

/** data-sb-* behavior read off a selected Popup/Toast/Snackbar panel. */
export type FeedbackBehavior = {
  kind: "popup" | "toast" | "snackbar";
  trigger: FeedbackTrigger;
  /** @deprecated use `trigger === "load"`. Kept so existing call sites still compile; set from trigger. */
  autoOpen: boolean;
  /** id of the button/link ("click") or form ("submit") this listens on (data-sb-trigger-target, "#" stripped). Only meaningful for those two triggers. */
  triggerTargetId?: string;
  /** submit trigger only: stop the form's own reload so the toast stays visible (data-sb-prevent-default). */
  preventFormReload: boolean;
  /** Seconds to wait before auto-opening (data-sb-delay, ms on the element). Applies to load, click and submit triggers alike. */
  delaySec: number;
  /** "once" (per browser session) or "always" (every time the trigger fires). */
  frequency: "once" | "always";
  /** Seconds before it auto-closes itself once open; 0 = stays open (data-sb-autodismiss). */
  autoDismissSec: number;
  /** Placement class, Toast/Snackbar only (data-sb-position). */
  position: string;
  /** Toast/Snackbar only: status color + auto icon (data-sb-variant). */
  variant?: "neutral" | "success" | "error" | "warning" | "info" | "delete";
  /** true when the icon still follows `variant` automatically (the .sb-icon
   * element carries data-sb-icon-auto and has no hand-typed text yet). */
  iconAuto: boolean;
  /** The icon's current text content, editable directly when iconAuto is false. */
  iconText: string;
};

export type Selection = {
  id: string;
  tag: string;
  label: string;
  kind: "image" | "link" | "text" | "video" | "element";
  text: string;
  src?: string;
  alt?: string;
  href?: string;
  widget?: string;
  editable: boolean;
  /** Comes from the merchant Profile — edits are kept on this website only (see isProfileField). */
  locked?: boolean;
  hasParent: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  /** Ancestors from outermost to the element itself (for the breadcrumb). */
  path: Array<{ id: string; label: string }>;
  /** Present when this element is a Popup/Toast/Snackbar panel. */
  feedback?: FeedbackBehavior;
  /** For a link/button (kind "link"): the id of the panel it opens, if any (data-sb-toggle, "#" stripped). */
  opensTarget?: string;
};

/**
 * Site-wide design tokens set from the editor's Theme panel — mirrors
 * SiteTheme in server/content-store.ts (duplicated here since this folder's
 * imports must stay relative; see the header comment). Every field is
 * optional: unset means "use the built-in default".
 */
export type SiteTheme = {
  colors?: {
    background?: string;
    surface?: string;
    foreground?: string;
    muted?: string;
    accent?: string;
    accentForeground?: string;
    border?: string;
    linkColor?: string;
    linkHoverColor?: string;
  };
  typography?: {
    bodyFont?: string;
    headingFont?: string;
    baseSize?: number;
    bodyLineHeight?: number;
    headingLineHeight?: number;
    headingLetterSpacing?: string;
    headingWeight?: number;
    bodyWeight?: number;
    h1Size?: string;
    h2Size?: string;
    h3Size?: string;
    h4Size?: string;
    h5Size?: string;
    h6Size?: string;
  };
  buttons?: {
    radius?: string;
    paddingBlock?: string;
    paddingInline?: string;
    fontWeight?: number;
    textTransform?: "none" | "uppercase" | "capitalize" | "lowercase";
    background?: string;
    foreground?: string;
    borderWidth?: string;
  };
  surfaces?: {
    radius?: string;
    shadow?: string;
    maxWidth?: string;
  };
};

export type Snapshot = { html: string; css: string };

export type StatusMessage = { text: string; kind?: "error" | "ok" } | null;

/** A drop position computed while dragging over the canvas. */
export type DropTarget = {
  ref: HTMLElement;
  where: "before" | "after" | "inside";
};

export type DragPayload =
  | { type: "move"; id: string }
  | { type: "widget"; widget: string };
