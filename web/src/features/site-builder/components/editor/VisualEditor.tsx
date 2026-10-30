"use client";

// Shared between Site Builder (/studio/[id]) and generated sites (/admin/edit).
// The whole components/editor folder is copied verbatim into zips — keep
// every import relative (no "@/...") and all styles self-contained.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import A11yPanel from "./A11yPanel";
import { applyFix, auditRoot, type FixKind, type Issue } from "./a11y-audit";
import ContentPanel from "./ContentPanel";
import LayersPanel from "./LayersPanel";
import PagesPanel from "./PagesPanel";
import StylePanel from "./StylePanel";
import ThemePanel from "./ThemePanel";
import WidgetsPanel from "./WidgetsPanel";
import { EDITOR_STYLE_ID, HOVER_ATTR, ID_ATTR, PAGE_STYLE_ID, SEL_ATTR, THEME_STYLE_ID } from "./constants";
import { useToast } from "@/components/ui/toast";
import { computeDropTarget, hideIndicator, showIndicator } from "./dnd";
import {
  byId,
  describe,
  duplicate as duplicateNode,
  ensureId,
  insertAt,
  isTextEditable,
  moveDown as moveNodeDown,
  moveUp as moveNodeUp,
  parseFragment,
  pickTarget,
  feedbackShellHost,
  feedbackHostOf,
  insideTarget,
  serializeRoot,
  summarizeText,
} from "./dom";
import { EDITOR_CSS, IFRAME_CSS } from "./editor-css";
import { History } from "./history";
import {
  copyStyles,
  emptyStyles,
  parsePageCss,
  pruneStyles,
  serializePageCss,
  setDecls,
  type PageStyles,
} from "./styles";
import { serializeThemeCss } from "./theme-css";
import { DEVICES, type CsvPreview, type Device, type DragPayload, type DropTarget, type FeedbackTarget, type PageRecord, type PageSummary, type Selection, type SiteTheme, type Snapshot, type StatusMessage, type TriggerCandidate } from "./types";
import { findWidget } from "./widgets";

export type VisualEditorProps = {
  /** API prefix with /pages and /upload endpoints. */
  apiBase: string;
  /** If set, the preview iframe loads `${previewBase}${encodeURIComponent(path)}`; otherwise it loads the path directly. */
  previewBase?: string;
  /** Prefix that public assets are served under in the preview (Builder: /api/studio/<id>/public). */
  assetPrefix?: string;
  initialPath?: string;
  siteName?: string;
  downloadHref?: string;
  exitHref?: string;
  exitLabel?: string;
};

type LeftTab = "widgets" | "layers" | "pages";
type RightTab = "content" | "style" | "page" | "theme" | "a11y";

type DragState = {
  payload: DragPayload;
  label: string;
  active: boolean; // moved past the threshold
  x: number;
  y: number;
};

type EffectsRuntime = { init: (root?: Element | null) => void; refresh: () => void };

type Fns = {
  save: () => Promise<void>;
  undo: () => void;
  redo: () => void;
  removeSelected: () => void;
  dragMove: (x: number, y: number) => void;
  dragEnd: () => void;
  frameOffset: () => { left: number; top: number };
  applyStylesToFrame: (styles: PageStyles) => void;
  updateToolbar: () => void;
};

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}${path}`;
}

export default function VisualEditor({
  apiBase,
  previewBase = "",
  assetPrefix = "",
  initialPath = "/",
  siteName = "Site",
  downloadHref,
  exitHref,
  exitLabel = "Exit",
}: VisualEditorProps) {
  /* ---------- refs ---------- */
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const selectedRef = useRef<HTMLElement | null>(null);
  const hoverRef = useRef<HTMLElement | null>(null);
  const historyRef = useRef(new History());
  const navigateRef = useRef(false);
  const currentPathRef = useRef(initialPath);
  const titleRef = useRef("");
  const descriptionRef = useRef("");
  const stylesRef = useRef<PageStyles>(emptyStyles());
  const deviceRef = useRef<Device>("desktop");
  const dragRef = useRef<DragState | null>(null);
  const dropRef = useRef<DropTarget | null>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const observerRef = useRef<MutationObserver | null>(null);
  const treeTimerRef = useRef<number | null>(null);
  const fns = useRef<Fns>({
    save: async () => undefined,
    undo: () => undefined,
    redo: () => undefined,
    removeSelected: () => undefined,
    dragMove: () => undefined,
    dragEnd: () => undefined,
    frameOffset: () => ({ left: 0, top: 0 }),
    applyStylesToFrame: () => undefined,
    updateToolbar: () => undefined,
  });

  /* ---------- state ---------- */
  const [pages, setPages] = useState<PageSummary[]>([]);
  const [currentPath, setCurrentPath] = useState(initialPath);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<StatusMessage>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [selectedEl, setSelectedEl] = useState<HTMLElement | null>(null);
  const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false });
  const [navigateMode, setNavigateMode] = useState(false);
  const [frameKey, setFrameKey] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [device, setDevice] = useState<Device>("desktop");
  const [leftTab, setLeftTab] = useState<LeftTab | null>("widgets");
  const [rightTab, setRightTab] = useState<RightTab>("content");
  const [styles, setStyles] = useState<PageStyles>(emptyStyles());
  const [treeVersion, setTreeVersion] = useState(0);
  const [rootEl, setRootEl] = useState<HTMLElement | null>(null);
  const [toolbarPos, setToolbarPos] = useState<{ left: number; top: number } | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [embedHtml, setEmbedHtml] = useState("");
  const [newTab, setNewTab] = useState(false);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [scanning, setScanning] = useState(false);
  const [theme, setTheme] = useState<SiteTheme>({});
  const [themeDirty, setThemeDirty] = useState(false);
  const [themeSaving, setThemeSaving] = useState(false);
  const themeRef = useRef<SiteTheme>({});
  const savedThemeRef = useRef<SiteTheme>({});
  const themeHistoryRef = useRef<{ past: SiteTheme[]; future: SiteTheme[]; lastAt: number }>({ past: [], future: [], lastAt: 0 });
  const [themeHistory, setThemeHistory] = useState({ canUndo: false, canRedo: false });
  // Undo coalescing for attribute edits (Behavior fields, link URL, alt…).
  const attrHistoryRef = useRef<{ key: string; at: number } | null>(null);
  // Editor-only "Preview" of a Popup/Toast/Snackbar as a visitor would see it.
  const previewRef = useRef<{ el: HTMLElement; timer: number } | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const { toast } = useToast();

  useEffect(() => {
    currentPathRef.current = currentPath;
    navigateRef.current = navigateMode;
    titleRef.current = title;
    descriptionRef.current = description;
    deviceRef.current = device;
  });

  const previewUrl = useMemo(() => {
    const bust = `sbv=${frameKey}`;
    if (previewBase) return `${previewBase}${encodeURIComponent(currentPath)}&${bust}`;
    return `${currentPath}${currentPath.includes("?") ? "&" : "?"}${bust}`;
  }, [currentPath, previewBase, frameKey]);

  const api = useCallback(
    async <T,>(path: string, init?: RequestInit): Promise<T> => {
      const res = await fetch(joinUrl(apiBase, path), { ...init, cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as T & { error?: string };
      if (res.status === 401) {
        window.location.assign(new URL("/admin/login", window.location.origin).href);
        throw new Error("Signed out.");
      }
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      return data;
    },
    [apiBase],
  );

  async function refreshPages(): Promise<PageSummary[]> {
    const data = await api<{ pages: PageSummary[] }>("/pages");
    setPages(data.pages);
    return data.pages;
  }

  useEffect(() => {
    let cancelled = false;
    api<{ pages: PageSummary[] }>("/pages")
      .then((data) => {
        if (!cancelled) setPages(data.pages);
      })
      .catch((err: Error) => {
        if (!cancelled) {
          const text = err.message || String(err);
          setStatus({ text, kind: "error" });
          toast({ title: "Couldn't load pages", description: text, variant: "error" });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  useEffect(() => {
    let cancelled = false;
    api<{ site: { theme?: SiteTheme } }>("/site")
      .then((data) => {
        if (cancelled) return;
        const loaded = data.site?.theme || {};
        themeRef.current = loaded;
        savedThemeRef.current = loaded;
        setTheme(loaded);
        applyThemeToFrame(loaded);
      })
      .catch(() => {
        // No /site endpoint (older generated zip) or nothing saved yet —
        // the Theme panel still works, it just starts from built-in
        // defaults and Save will create content/site.json's theme field.
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty || themeDirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty, themeDirty]);

  /** Apply a theme to state + live preview. `record` (default true) adds an
   * undo step first; rapid edits (typing, dragging a color picker) within
   * 800ms are coalesced into one step. */
  function changeTheme(next: SiteTheme, record = true) {
    if (record) {
      const h = themeHistoryRef.current;
      const now = Date.now();
      if (now - h.lastAt > 800 || !h.past.length) {
        h.past.push(themeRef.current);
        if (h.past.length > 80) h.past.shift();
      }
      h.future = [];
      h.lastAt = now;
    }
    themeRef.current = next;
    setTheme(next);
    setThemeDirty(JSON.stringify(next) !== JSON.stringify(savedThemeRef.current));
    applyThemeToFrame(next);
    syncThemeHistory();
  }

  function syncThemeHistory() {
    const h = themeHistoryRef.current;
    setThemeHistory({ canUndo: h.past.length > 0, canRedo: h.future.length > 0 });
  }

  function undoTheme() {
    const h = themeHistoryRef.current;
    const prev = h.past.pop();
    if (!prev) return;
    h.future.push(themeRef.current);
    h.lastAt = 0;
    changeTheme(prev, false);
  }

  function redoTheme() {
    const h = themeHistoryRef.current;
    const next = h.future.pop();
    if (!next) return;
    h.past.push(themeRef.current);
    h.lastAt = 0;
    changeTheme(next, false);
  }

  function resetTheme() {
    changeTheme({});
  }

  /** Throw away unsaved theme edits (back to the last saved theme). Undoable. */
  function discardTheme() {
    changeTheme(savedThemeRef.current);
  }

  /** Deep-merge `detected` into the current theme, keeping every field the
   * user already set (or already detected once) and only filling gaps. */
  function mergeDetectedTheme(detected: SiteTheme): { theme: SiteTheme; filled: number } {
    const current = themeRef.current;
    let filled = 0;
    const groups = ["colors", "typography", "buttons", "surfaces"] as const;
    const next: SiteTheme = { ...current };
    for (const g of groups) {
      const currentGroup = (current[g] || {}) as Record<string, unknown>;
      const detectedGroup = (detected[g] || {}) as Record<string, unknown>;
      const mergedGroup: Record<string, unknown> = { ...currentGroup };
      for (const [k, v] of Object.entries(detectedGroup)) {
        if (v === undefined || v === "") continue;
        if (mergedGroup[k] !== undefined && mergedGroup[k] !== "") continue; // never overwrite a set field
        mergedGroup[k] = v;
        filled += 1;
      }
      next[g] = mergedGroup as never;
    }
    return { theme: next, filled };
  }

  const [detecting, setDetecting] = useState(false);

  async function detectTheme() {
    setDetecting(true);
    try {
      const res = await api<{ ok: boolean; theme: SiteTheme; foundCount: number }>("/site", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "detect" }),
      });
      const { theme: merged, filled } = mergeDetectedTheme(res.theme || {});
      changeTheme(merged);
      if (filled > 0) {
        toast({
          title: "Theme detected",
          description: `Filled ${filled} field${filled === 1 ? "" : "s"} from the cloned site. Review below, then Save theme.`,
          variant: "success",
        });
      } else {
        toast({
          title: "Nothing new to fill",
          description: "Couldn't find additional colors/fonts in this site's CSS, or every matching field is already set.",
          variant: "info",
        });
      }
    } catch (err) {
      const text = err instanceof Error ? err.message : "Detection failed";
      toast({ title: "Couldn't detect theme", description: text, variant: "error" });
    } finally {
      setDetecting(false);
    }
  }

  async function saveTheme() {
    setThemeSaving(true);
    try {
      await api("/site", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme: themeRef.current }),
      });
      savedThemeRef.current = themeRef.current;
      setThemeDirty(false);
      toast({ title: "Theme saved", description: "Applies across every page of this site.", variant: "success" });
    } catch (err) {
      const text = err instanceof Error ? err.message : "Save failed";
      toast({ title: "Couldn't save theme", description: text, variant: "error" });
    } finally {
      setThemeSaving(false);
    }
  }

  /* ---------- iframe helpers ---------- */

  function frameDoc(): Document | null {
    try {
      return iframeRef.current?.contentDocument ?? null;
    } catch {
      return null;
    }
  }

  function frameWin(): Window | null {
    try {
      return iframeRef.current?.contentWindow ?? null;
    } catch {
      return null;
    }
  }

  function root(): HTMLElement | null {
    return frameDoc()?.querySelector<HTMLElement>("#cloned-root") ?? null;
  }

  function effects(): EffectsRuntime | null {
    const win = frameWin() as (Window & { SBEffects?: EffectsRuntime }) | null;
    return win?.SBEffects ?? null;
  }

  function prefixCss(css: string): string {
    if (!assetPrefix) return css;
    return css.replace(/url\((['"]?)\/assets\//g, `url($1${assetPrefix}/assets/`);
  }

  function applyStylesToFrame(next: PageStyles) {
    const doc = frameDoc();
    if (!doc) return;
    let tag = doc.getElementById(PAGE_STYLE_ID);
    if (!tag) {
      tag = doc.createElement("style");
      tag.id = PAGE_STYLE_ID;
      doc.head.appendChild(tag);
    }
    tag.textContent = prefixCss(serializePageCss(next));
  }

  /** Live-preview the site-wide theme inside the iframe. Injected ahead of
   * PAGE_STYLE_ID in the DOM (see attach()) so a page's own Style-panel
   * rules — always !important — still win over theme defaults. */
  function applyThemeToFrame(next: SiteTheme) {
    const doc = frameDoc();
    if (!doc) return;
    let tag = doc.getElementById(THEME_STYLE_ID);
    if (!tag) {
      tag = doc.createElement("style");
      tag.id = THEME_STYLE_ID;
      // The page stylesheet isn't always in <head> — a generated site renders
      // it inside <body> with the page — so insert next to it wherever it is.
      const pageTag = doc.getElementById(PAGE_STYLE_ID);
      if (pageTag?.parentNode) pageTag.parentNode.insertBefore(tag, pageTag);
      else doc.head.appendChild(tag);
    }
    tag.textContent = serializeThemeCss(next);
  }

  // Load title / description / css for the current page. Lives after the
  // helpers above because it applies the stylesheet to the frame.
  useEffect(() => {
    let cancelled = false;
    api<PageRecord>(`/pages?path=${encodeURIComponent(currentPath)}`)
      .then((page) => {
        if (cancelled) return;
        setTitle(page.title || "");
        setDescription(page.description || "");
        const parsed = parsePageCss(page.css);
        stylesRef.current = parsed;
        setStyles(parsed);
        fns.current.applyStylesToFrame(parsed);
      })
      .catch((err: Error) => {
        if (!cancelled) {
          const text = err.message || String(err);
          setStatus({ text, kind: "error" });
          toast({ title: "Couldn't load page", description: text, variant: "error" });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [api, currentPath]);

  function snapshot(): Snapshot {
    const r = root();
    return { html: r ? serializeRoot(r) : "", css: serializePageCss(stylesRef.current) };
  }

  function syncHistory() {
    setHistoryState({ canUndo: historyRef.current.canUndo, canRedo: historyRef.current.canRedo });
  }

  function pushHistory() {
    if (!root()) return;
    historyRef.current.push(snapshot());
    syncHistory();
  }

  function bumpTree() {
    if (treeTimerRef.current) return;
    treeTimerRef.current = window.setTimeout(() => {
      treeTimerRef.current = null;
      setTreeVersion((v) => v + 1);
      updateToolbar();
    }, 80);
  }

  function markDirty() {
    setDirty(true);
    bumpTree();
  }

  /* ---------- selection ---------- */

  function clearSelection() {
    stopPreview();
    const prev = selectedRef.current;
    if (prev) {
      prev.removeAttribute(SEL_ATTR);
      prev.removeAttribute("contenteditable");
      prev.removeAttribute("spellcheck");
    }
    selectedRef.current = null;
    setSelectedEl(null);
    setSelection(null);
    setToolbarPos(null);
  }

  function refreshSelection() {
    const el = selectedRef.current;
    const r = root();
    if (!el || !r || !r.contains(el)) {
      if (el) clearSelection();
      return;
    }
    setSelection(describe(el, r));
    updateToolbar();
  }

  function select(el: HTMLElement, opts: { edit?: boolean; scroll?: boolean } = {}) {
    const r = root();
    if (!r) return;
    if (selectedRef.current !== el) {
      clearSelection();
      selectedRef.current = el;
      el.setAttribute(SEL_ATTR, "1");
      if (hoverRef.current === el) el.removeAttribute(HOVER_ATTR);
    }
    const editable = isTextEditable(el);
    if (editable && opts.edit !== false) {
      el.setAttribute("contenteditable", "true");
      el.setAttribute("spellcheck", "false");
    } else {
      el.removeAttribute("contenteditable");
    }
    ensureId(el);
    const desc = describe(el, r);
    setSelection(desc);
    setSelectedEl(el);
    setEmbedHtml(desc.kind === "element" || desc.widget === "embed" ? el.innerHTML : "");
    setNewTab(el.getAttribute("target") === "_blank");
    if (opts.scroll) el.scrollIntoView({ block: "center", behavior: "smooth" });
    updateToolbar();
  }

  function selectById(id: string) {
    const r = root();
    const el = r ? byId(r, id) : null;
    if (el) select(el, { scroll: true });
  }

  function updateToolbar() {
    const el = selectedRef.current;
    const frame = frameRef.current;
    if (!el || !frame || !el.isConnected) {
      setToolbarPos(null);
      return;
    }
    const rect = el.getBoundingClientRect();
    const height = frame.clientHeight;
    const width = frame.clientWidth;
    if (rect.bottom < 0 || rect.top > height) {
      setToolbarPos(null);
      return;
    }
    const top = rect.top > 34 ? rect.top - 4 : Math.min(rect.bottom + 30, height - 4);
    const left = Math.max(4, Math.min(rect.left, width - 260));
    setToolbarPos({ left, top });
  }

  /* ---------- attach to the iframe document ---------- */

  function attach(doc: Document) {
    if (!doc.getElementById(EDITOR_STYLE_ID)) {
      const style = doc.createElement("style");
      style.id = EDITOR_STYLE_ID;
      style.textContent = IFRAME_CSS;
      doc.head.appendChild(style);
    }
    doc.documentElement.toggleAttribute("data-sb-editing", !navigateRef.current);
    const r = doc.querySelector<HTMLElement>("#cloned-root");
    if (!r) return;
    setRootEl(r);
    applyStylesToFrame(stylesRef.current);
    applyThemeToFrame(themeRef.current);

    doc.addEventListener(
      "click",
      (e) => {
        if (dragRef.current) return;
        if (navigateRef.current) return;
        const el = pickTarget(e.target, r);
        e.preventDefault();
        e.stopPropagation();
        if (!el) {
          clearSelection();
          return;
        }
        // Clicking inside the already-selected editable element just moves the caret.
        if (selectedRef.current && selectedRef.current.contains(el) && selectedRef.current !== el && selectedRef.current.isContentEditable) {
          return;
        }
        select(el);
      },
      true,
    );
    doc.addEventListener("dblclick", (e) => {
      // Double-click drills into the literal clicked child (bypassing the
      // feedback-widget container redirect) so text/links inside a
      // Popup/Toast/Snackbar can still be edited directly.
      if (navigateRef.current) return;
      const el = pickTarget(e.target, r, { literal: true });
      if (el && el !== selectedRef.current) select(el);
    });
    doc.addEventListener("submit", (e) => e.preventDefault(), true);
    doc.addEventListener(
      "mouseover",
      (e) => {
        if (navigateRef.current || dragRef.current) return;
        const el = pickTarget(e.target, r);
        if (hoverRef.current && hoverRef.current !== el) hoverRef.current.removeAttribute(HOVER_ATTR);
        if (el && el !== selectedRef.current) {
          el.setAttribute(HOVER_ATTR, "1");
          hoverRef.current = el;
        }
      },
      true,
    );
    doc.addEventListener(
      "mouseout",
      (e) => {
        const el = e.target as HTMLElement | null;
        if (el?.removeAttribute) el.removeAttribute(HOVER_ATTR);
      },
      true,
    );
    doc.addEventListener(
      "input",
      () => {
        setDirty(true);
        bumpTree();
      },
      true,
    );
    doc.addEventListener(
      "keydown",
      (e) => {
        const mod = e.ctrlKey || e.metaKey;
        const active = doc.activeElement as HTMLElement | null;
        const typing = !!active && active.isContentEditable;
        if (mod && e.key.toLowerCase() === "s") {
          e.preventDefault();
          void fns.current.save();
          return;
        }
        if (e.key === "Escape") {
          clearSelection();
          return;
        }
        if (typing) return;
        if (mod && e.key.toLowerCase() === "z") {
          e.preventDefault();
          if (e.shiftKey) fns.current.redo();
          else fns.current.undo();
          return;
        }
        if (mod && e.key.toLowerCase() === "y") {
          e.preventDefault();
          fns.current.redo();
          return;
        }
        if ((e.key === "Delete" || e.key === "Backspace") && selectedRef.current) {
          e.preventDefault();
          fns.current.removeSelected();
        }
      },
      true,
    );
    doc.addEventListener("paste", (e) => {
      const target = e.target as HTMLElement | null;
      if (!target?.isContentEditable) return;
      e.preventDefault();
      const text = e.clipboardData?.getData("text/plain") ?? "";
      doc.execCommand("insertText", false, text);
    });
    doc.addEventListener("scroll", () => updateToolbar(), { passive: true });
    doc.defaultView?.addEventListener("resize", () => updateToolbar());

    observerRef.current?.disconnect();
    observerRef.current = new MutationObserver(() => bumpTree());
    observerRef.current.observe(r, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "src", "href"] });
  }

  function onFrameLoad() {
    const doc = frameDoc();
    if (!doc) return;
    if (doc.getElementById(EDITOR_STYLE_ID)) return; // already attached to this document
    selectedRef.current = null;
    hoverRef.current = null;
    setSelection(null);
    setSelectedEl(null);
    setToolbarPos(null);
    historyRef.current.clear();
    syncHistory();
    setDirty(false);
    attach(doc);
    bumpTree();

    try {
      const loc = doc.location;
      let path: string | null = null;
      if (previewBase) path = new URL(loc.href).searchParams.get("path");
      else path = loc.pathname;
      if (path && path !== currentPathRef.current) setCurrentPath(path);
    } catch {
      // ignore
    }
  }

  // Fallback when the iframe finishes loading before React attaches onLoad.
  const onFrameLoadRef = useRef(onFrameLoad);
  useEffect(() => {
    onFrameLoadRef.current = onFrameLoad;
  });
  useEffect(() => {
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      let doc: Document | null = null;
      try {
        doc = iframeRef.current?.contentDocument ?? null;
      } catch {
        doc = null;
      }
      const ready = !!doc && doc.readyState === "complete" && !!doc.querySelector("#cloned-root") && !doc.getElementById(EDITOR_STYLE_ID);
      if (ready) onFrameLoadRef.current();
      if (ready || attempts > 200) window.clearInterval(timer);
    }, 150);
    return () => window.clearInterval(timer);
  }, [previewUrl]);

  // Keep the floating toolbar aligned when the device frame resizes.
  useEffect(() => {
    const timer = window.setTimeout(() => fns.current.updateToolbar(), 250);
    return () => window.clearTimeout(timer);
  }, [device, leftTab]);

  /* ---------- accessibility audit ---------- */

  function runAudit() {
    const r = root();
    if (!r) {
      setIssues([]);
      return;
    }
    setScanning(true);
    try {
      setIssues(auditRoot(r));
    } finally {
      setScanning(false);
    }
  }

  // Audit on load and, debounced, after every canvas change (treeVersion
  // bumps from the MutationObserver / input events).
  useEffect(() => {
    if (!rootEl) return;
    const timer = window.setTimeout(() => {
      const r = rootEl.isConnected ? rootEl : null;
      if (!r) return;
      setIssues(auditRoot(r));
    }, 600);
    return () => window.clearTimeout(timer);
  }, [rootEl, treeVersion]);

  function fixIssue(issue: Issue, fix: FixKind, value?: string) {
    const r = root();
    const el = r && issue.sbId ? byId(r, issue.sbId) : null;
    if (!el) return;
    pushHistory();
    const next = applyFix(el, fix, value);
    if (next !== el && selectedRef.current === el) {
      selectedRef.current = null;
      select(next, { edit: false });
    }
    markDirty();
    refreshSelection();
    setStatus({ text: "Fixed — remember to save", kind: "ok" });
    toast({ title: "Accessibility fix applied", description: "Remember to save your changes.", variant: "success", duration: 3000 });
    window.setTimeout(() => runAudit(), 50);
  }

  /* ---------- actions ---------- */

  async function save() {
    const r = root();
    if (!r) {
      setStatus({ text: "Preview has not loaded yet.", kind: "error" });
      return;
    }
    const ids = new Set<string>();
    r.querySelectorAll(`[${ID_ATTR}]`).forEach((el) => ids.add(el.getAttribute(ID_ATTR) || ""));
    const pruned = pruneStyles(stylesRef.current, ids);
    stylesRef.current = pruned;
    setStyles(pruned);
    const html = serializeRoot(r, assetPrefix);
    const css = serializePageCss(pruned);
    setSaving(true);
    setStatus({ text: "Saving…" });
    try {
      await api("/pages", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: currentPathRef.current, title: titleRef.current, description: descriptionRef.current, html, css }),
      });
      setDirty(false);
      setStatus({ text: "Saved", kind: "ok" });
      toast({ title: "Page saved", description: currentPathRef.current, variant: "success" });
      await refreshPages();
    } catch (err) {
      const text = err instanceof Error ? err.message : "Save failed";
      setStatus({ text, kind: "error" });
      toast({ title: "Save failed", description: text, variant: "error" });
    } finally {
      setSaving(false);
    }
  }

  function restore(snap: Snapshot) {
    const r = root();
    if (!r) return;
    clearSelection();
    r.innerHTML = snap.html;
    const parsed = parsePageCss(snap.css);
    stylesRef.current = parsed;
    setStyles(parsed);
    applyStylesToFrame(parsed);
    effects()?.init(r);
    markDirty();
  }

  function undo() {
    const prev = historyRef.current.undo(snapshot());
    syncHistory();
    if (prev) restore(prev);
  }

  function redo() {
    const next = historyRef.current.redo(snapshot());
    syncHistory();
    if (next) restore(next);
  }

  function confirmDiscard(): boolean {
    return !dirty || window.confirm("You have unsaved changes. Discard them?");
  }

  function goTo(path: string) {
    if (path === currentPath) return;
    if (!confirmDiscard()) return;
    clearSelection();
    setCurrentPath(path);
  }

  function reloadFrame() {
    if (!confirmDiscard()) return;
    clearSelection();
    setFrameKey((k) => k + 1);
  }

  async function createPage(path: string, newTitle: string) {
    if (!confirmDiscard()) return;
    try {
      const res = await api<{ path: string }>("/pages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, title: newTitle, template: currentPath }),
      });
      await refreshPages();
      setStatus({ text: `Created ${res.path}`, kind: "ok" });
      toast({ title: "Page created", description: res.path, variant: "success" });
      clearSelection();
      setCurrentPath(res.path);
    } catch (err) {
      const text = err instanceof Error ? err.message : "Could not create page";
      setStatus({ text, kind: "error" });
      toast({ title: "Couldn't create page", description: text, variant: "error" });
    }
  }

  async function duplicatePage(path: string, newTitle: string) {
    if (!confirmDiscard()) return;
    try {
      const res = await api<{ path: string }>("/pages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, title: newTitle, duplicateOf: currentPath }),
      });
      await refreshPages();
      setStatus({ text: `Duplicated ${currentPath} → ${res.path}`, kind: "ok" });
      toast({ title: "Page duplicated", description: `${currentPath} → ${res.path}`, variant: "success" });
      clearSelection();
      setCurrentPath(res.path);
    } catch (err) {
      const text = err instanceof Error ? err.message : "Could not duplicate page";
      setStatus({ text, kind: "error" });
      toast({ title: "Couldn't duplicate page", description: text, variant: "error" });
    }
  }

  async function previewCsv(csv: string): Promise<CsvPreview | null> {
    try {
      const res = await api<CsvPreview>("/pages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv, template: currentPath, dryRun: true }),
      });
      setStatus({ text: `${res.pages.length} pages found in the CSV` });
      return res;
    } catch (err) {
      setStatus({ text: err instanceof Error ? err.message : "Could not read the CSV", kind: "error" });
      return null;
    }
  }

  async function importCsv(csv: string) {
    if (!confirmDiscard()) return;
    try {
      const res = await api<{ created: string[]; skipped: string[] }>("/pages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv, template: currentPath }),
      });
      await refreshPages();
      const skipped = res.skipped.length ? `, ${res.skipped.length} skipped` : "";
      const summary = `Imported ${res.created.length} ${res.created.length === 1 ? "page" : "pages"}${skipped}`;
      setStatus({ text: summary, kind: "ok" });
      toast({ title: "CSV import complete", description: summary, variant: res.created.length > 0 ? "success" : "warning" });
      if (res.created.length > 0) {
        clearSelection();
        setCurrentPath(res.created[0]);
      }
    } catch (err) {
      const text = err instanceof Error ? err.message : "Could not import the CSV";
      setStatus({ text, kind: "error" });
      toast({ title: "CSV import failed", description: text, variant: "error" });
    }
  }

  async function deletePage() {
    if (currentPath === "/") return;
    if (!window.confirm(`Delete ${currentPath}? This cannot be undone.`)) return;
    try {
      const deletedPath = currentPath;
      await api(`/pages?path=${encodeURIComponent(currentPath)}`, { method: "DELETE" });
      await refreshPages();
      setStatus({ text: `Deleted ${deletedPath}`, kind: "ok" });
      toast({ title: "Page deleted", description: `${deletedPath} — this cannot be undone.`, variant: "warning" });
      clearSelection();
      setDirty(false);
      setCurrentPath("/");
    } catch (err) {
      const text = err instanceof Error ? err.message : "Could not delete page";
      setStatus({ text, kind: "error" });
      toast({ title: "Couldn't delete page", description: text, variant: "error" });
    }
  }

  async function uploadFile(file: File): Promise<string | null> {
    setUploading(true);
    setStatus({ text: `Uploading ${file.name}…` });
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await api<{ url: string }>("/upload", { method: "POST", body: form });
      setStatus({ text: "Uploaded — remember to save", kind: "ok" });
      toast({ title: "File uploaded", description: `${file.name} — remember to save.`, variant: "success" });
      return res.url;
    } catch (err) {
      const text = err instanceof Error ? err.message : "Upload failed";
      setStatus({ text, kind: "error" });
      toast({ title: "Upload failed", description: text, variant: "error" });
      return null;
    } finally {
      setUploading(false);
    }
  }

  function applyImageSrc(url: string) {
    const el = selectedRef.current;
    if (!el || el.tagName.toLowerCase() !== "img") return;
    pushHistory();
    const img = el as HTMLImageElement;
    const display = url.startsWith("/") && assetPrefix ? `${assetPrefix}${url}` : url;
    img.setAttribute("src", display);
    ["srcset", "data-src", "data-lazy-src", "data-srcset", "data-lazy-srcset", "sizes", "loading"].forEach((attr) => img.removeAttribute(attr));
    img.closest("picture")?.querySelectorAll("source").forEach((s) => s.remove());
    markDirty();
    refreshSelection();
  }

  async function uploadImage(file: File) {
    const url = await uploadFile(file);
    if (url) applyImageSrc(url);
  }

  /** Add an undo step before an edit to `el`, coalescing rapid edits to the
   * same element (typing a URL, a Behavior field firing two attributes) into
   * one step so Ctrl+Z doesn't walk back one keystroke at a time. */
  function pushHistoryFor(el: HTMLElement) {
    const key = ensureId(el);
    const now = Date.now();
    const last = attrHistoryRef.current;
    if (!last || last.key !== key || now - last.at > 1000) pushHistory();
    attrHistoryRef.current = { key, at: now };
  }

  function setAttr(attr: string, value: string) {
    const el = selectedRef.current;
    if (!el) return;
    const current = el.getAttribute(attr);
    if (value ? current === value : current === null) return; // no-op: don't add an undo step
    pushHistoryFor(el);
    if (value) el.setAttribute(attr, value);
    else el.removeAttribute(attr);
    markDirty();
    refreshSelection();
  }

  /** Point the selected Toast/Snackbar's click/submit trigger at a button,
   * link or form. `key` is that element's real id, or "sbid:<data-sb-id>"
   * when it has none yet — in which case it's given a real, unique id so the
   * live site can find it (the runtime looks elements up by id). */
  function setTriggerTarget(key: string) {
    const host = selectedRef.current;
    const r = root();
    if (!host || !r) return;
    if (!key) {
      setAttr("data-sb-trigger-target", "");
      return;
    }
    const doc = r.ownerDocument;
    const target = key.startsWith("sbid:") ? byId(r, key.slice(5)) : doc.getElementById(key);
    if (!target) return;
    pushHistoryFor(host);
    if (!target.id) {
      let id = "";
      do id = `sb-trigger-${Math.random().toString(36).slice(2, 8)}`;
      while (doc.getElementById(id));
      target.id = id;
    }
    host.setAttribute("data-sb-trigger-target", `#${target.id}`);
    markDirty();
    refreshSelection();
  }

  function stopPreview() {
    const p = previewRef.current;
    if (!p) return;
    window.clearTimeout(p.timer);
    p.el.classList.remove("sb-preview", "sb-open", "sb-timed");
    p.el.style.removeProperty("--sb-life");
    previewRef.current = null;
    setPreviewing(false);
  }

  /** Show the selected Popup/Toast/Snackbar exactly as a visitor would (real
   * position, animation, progress bar) for a few seconds. Only toggles
   * classes that cleanRuntimeArtifacts strips, so nothing is saved. */
  function previewFeedback() {
    const el = selectedRef.current;
    if (!el || !el.matches(".sb-popup, .sb-toast, .sb-snackbar")) return;
    stopPreview();
    const ms = parseInt(el.getAttribute("data-sb-autodismiss") || "", 10);
    const isPopup = el.matches(".sb-popup");
    el.classList.add("sb-preview", "sb-open");
    if (ms > 0 && !isPopup) {
      el.style.setProperty("--sb-life", `${ms}ms`);
      el.classList.add("sb-timed");
    }
    const duration = ms > 0 ? Math.min(ms, 10000) : 4000;
    previewRef.current = { el, timer: window.setTimeout(stopPreview, duration) };
    setPreviewing(true);
  }

  /** Set (or clear back to automatic) the icon text of a selected Popup/
   * Toast/Snackbar's .sb-icon child. `null`/empty = go back to following
   * the Type/variant automatically (re-adds data-sb-icon-auto so
   * sb-widgets.css's CSS-content glyph shows again); any other string
   * becomes the icon's literal text and removes data-sb-icon-auto so the
   * CSS glyph no longer overrides it. */
  function setFeedbackIcon(text: string | null) {
    const el = selectedRef.current;
    const icon = el?.querySelector<HTMLElement>(".sb-icon");
    if (!el || !icon) return;
    const trimmed = (text || "").trim();
    const isAuto = icon.hasAttribute("data-sb-icon-auto");
    if (trimmed ? !isAuto && icon.textContent === trimmed : isAuto) return; // unchanged
    pushHistoryFor(el);
    if (trimmed) {
      icon.removeAttribute("data-sb-icon-auto");
      icon.textContent = trimmed;
    } else {
      icon.setAttribute("data-sb-icon-auto", "");
      icon.textContent = "";
    }
    markDirty();
    refreshSelection();
  }

  /** Every Popup/Toast/Snackbar panel currently on the page — what a link's
   * "Opens" dropdown offers. Re-read from the live DOM on each render (cheap;
   * these panels are always few) rather than cached, so it never goes stale
   * after an insert/remove. */
  function feedbackTargets(): FeedbackTarget[] {
    const r = root();
    if (!r) return [];
    const nodes = r.querySelectorAll<HTMLElement>('[data-sb-widget="popup"],[data-sb-widget="toast"],[data-sb-widget="snackbar"]');
    const out: FeedbackTarget[] = [];
    nodes.forEach((el) => {
      const id = el.id;
      const kind = el.getAttribute("data-sb-widget") as FeedbackTarget["kind"] | null;
      if (!id || !kind) return;
      const heading = el.querySelector(".sb-heading, .sb-text");
      const label = `${kind[0].toUpperCase()}${kind.slice(1)}${heading?.textContent ? ` — “${heading.textContent.trim().slice(0, 24)}”` : ""}`;
      out.push({ id, label, kind });
    });
    return out;
  }

  /** Buttons/links and forms on the page a Toast/Snackbar can trigger off
   * (its "click"/"submit" Behavior trigger). Excludes feedback widgets
   * themselves and their own internal buttons (dismiss/CTA), so the list
   * only offers real page content to listen on. */
  function triggerCandidates(): TriggerCandidate[] {
    const r = root();
    if (!r) return [];
    const out: TriggerCandidate[] = [];
    const isInsideFeedback = (el: Element) => !!el.closest('[data-sb-widget="popup"],[data-sb-widget="toast"],[data-sb-widget="snackbar"]');
    r.querySelectorAll<HTMLElement>("a, button").forEach((el) => {
      if (isInsideFeedback(el)) return;
      if (el.hasAttribute("data-sb-dismiss")) return;
      const id = el.id || `sbid:${ensureId(el)}`;
      const text = summarizeText(el, 28) || el.getAttribute("aria-label") || (el.tagName.toLowerCase() === "a" ? "Link" : "Button");
      out.push({ id, label: `${el.tagName.toLowerCase() === "a" ? "Link" : "Button"} — "${text}"`, kind: "click" });
    });
    r.querySelectorAll<HTMLElement>("form").forEach((el) => {
      if (isInsideFeedback(el)) return;
      const id = el.id || `sbid:${ensureId(el)}`;
      const heading = el.querySelector(".sb-heading, h1, h2, h3, legend");
      const label = `Form${heading?.textContent ? ` — "${heading.textContent.trim().slice(0, 24)}"` : ""}`;
      out.push({ id, label, kind: "submit" });
    });
    return out;
  }

  function setVideoSrc(src: string) {
    const el = selectedRef.current;
    if (!el) return;
    pushHistory();
    if (/\.(mp4|webm|ogg)(\?|$)/i.test(src) && el.tagName.toLowerCase() === "iframe") {
      const video = el.ownerDocument.createElement("video");
      video.src = src;
      video.controls = true;
      video.setAttribute("playsinline", "");
      el.replaceWith(video);
      select(video);
    } else {
      el.setAttribute("src", src);
    }
    markDirty();
    refreshSelection();
  }

  function setEmbed(html: string) {
    const el = selectedRef.current;
    if (!el) return;
    pushHistory();
    el.innerHTML = html;
    setEmbedHtml(html);
    effects()?.init(el);
    markDirty();
    refreshSelection();
  }

  function removeSelected() {
    const el = selectedRef.current;
    if (!el) return;
    pushHistory();
    const parent = el.parentElement;
    clearSelection();
    el.remove();
    markDirty();
    const r = root();
    if (parent && r && parent !== r && r.contains(parent)) select(parent, { edit: false });
  }

  function duplicateSelected() {
    const el = selectedRef.current;
    if (!el) return;
    pushHistory();
    const copy = duplicateNode(el);
    // Carry styles over to the fresh ids.
    let next = stylesRef.current;
    const nodes = [copy, ...Array.from(copy.querySelectorAll<HTMLElement>("[data-sb-copied-from]"))];
    for (const node of nodes) {
      const from = node.getAttribute("data-sb-copied-from");
      node.removeAttribute("data-sb-copied-from");
      if (from) next = copyStyles(next, from, ensureId(node));
    }
    stylesRef.current = next;
    setStyles(next);
    applyStylesToFrame(next);
    effects()?.init(copy);
    markDirty();
    select(copy, { edit: false, scroll: true });
  }

  function moveSelected(direction: "up" | "down") {
    const el = selectedRef.current;
    if (!el) return;
    pushHistory();
    const moved = direction === "up" ? moveNodeUp(el) : moveNodeDown(el);
    if (!moved) return;
    markDirty();
    select(el, { edit: false, scroll: true });
  }

  function selectParent() {
    const el = selectedRef.current;
    const r = root();
    if (!el || !r) return;
    const parent = el.parentElement;
    if (!parent || parent === r) return;
    // From a popup's heading/text/button, "Select parent" lands on the popup
    // itself (with its Behavior panel), not on its inner card wrapper.
    select(feedbackShellHost(parent) ?? parent, { edit: false });
  }

  /**
   * A Popup/Toast/Snackbar can't live inside another one (it would open on
   * top of itself). Dropping one there places it right after the outer
   * widget on the page instead.
   */
  function outsideFeedback(ref: HTMLElement, where: "before" | "after" | "inside"): { ref: HTMLElement; where: "before" | "after" | "inside" } {
    const host = feedbackHostOf(where === "inside" ? ref : ref.parentElement);
    return host ? { ref: host, where: "after" } : { ref, where };
  }

  function moveElement(el: HTMLElement, ref: HTMLElement, where: "before" | "after" | "inside") {
    if (el === ref || el.contains(ref)) return;
    if (el.matches(".sb-popup, .sb-toast, .sb-snackbar")) ({ ref, where } = outsideFeedback(ref, where));
    pushHistory();
    insertAt([el], ref, where);
    markDirty();
    effects()?.refresh();
    select(el, { edit: false, scroll: true });
  }

  function insertWidget(widgetId: string, target?: DropTarget | null): HTMLElement | null {
    const doc = frameDoc();
    const r = root();
    const widget = findWidget(widgetId);
    if (!doc || !r || !widget) return null;
    // Widgets whose markup links a trigger to a separate panel by id (e.g.
    // Popup's data-sb-toggle="#__SB_UID__") carry that placeholder so two
    // instances on the same page never collide.
    const html = widget.html.includes("__SB_UID__")
      ? widget.html.replace(/__SB_UID__/g, `sb-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`)
      : widget.html;
    const nodes = parseFragment(doc, html);
    if (!nodes.length) return null;
    // Where it goes: the drop point, else after the selection, else the end
    // of the page. With a Popup/Toast, a column or an empty box selected,
    // blocks go INSIDE it instead (see insideTarget in dom.ts).
    const sel = selectedRef.current && selectedRef.current !== r ? selectedRef.current : null;
    let place: { ref: HTMLElement; where: "before" | "after" | "inside" } | null = target
      ? { ref: target.ref, where: target.where }
      : sel
        ? insideTarget(sel)
          ? { ref: (insideTarget(sel) as { box: HTMLElement }).box, where: "inside" }
          : { ref: sel, where: "after" }
        : null;
    // …but never a Popup/Toast/Snackbar inside another one.
    if (place && widget.group === "feedback") place = outsideFeedback(place.ref, place.where);
    pushHistory();
    if (place) insertAt(nodes, place.ref, place.where);
    else r.append(...nodes);
    markDirty();
    effects()?.init(r);
    // A new Popup arrives with its "Open popup" trigger link first; select the
    // popup itself so its settings show and new blocks can go straight in.
    const first = nodes.find((n) => n.matches?.(".sb-popup")) ?? nodes[0];
    select(first, { edit: false, scroll: true });
    return first;
  }

  /* ---------- style panel bridge ---------- */

  function computedStyle(prop: string): string {
    const el = selectedRef.current;
    const win = frameWin();
    if (!el || !win) return "";
    return win.getComputedStyle(el).getPropertyValue(prop).trim();
  }

  function changeStyles(decls: Record<string, string>) {
    const el = selectedRef.current;
    if (!el) return;
    const id = ensureId(el);
    const next = setDecls(stylesRef.current, id, deviceRef.current, decls);
    stylesRef.current = next;
    setStyles(next);
    applyStylesToFrame(next);
    setDirty(true);
    updateToolbar();
  }

  /* ---------- browse mode ---------- */

  function toggleNavigate(on: boolean) {
    setNavigateMode(on);
    navigateRef.current = on;
    const doc = frameDoc();
    doc?.documentElement.toggleAttribute("data-sb-editing", !on);
    if (on) {
      clearSelection();
      effects()?.init(root());
    }
  }

  /* ---------- drag & drop (widgets and move handle) ---------- */

  function frameOffset(): { left: number; top: number } {
    const rect = iframeRef.current?.getBoundingClientRect();
    return { left: rect?.left ?? 0, top: rect?.top ?? 0 };
  }

  function beginDrag(e: React.PointerEvent, payload: DragPayload, label: string) {
    if (e.button !== 0) return;
    e.preventDefault();
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    dragRef.current = { payload, label, active: false, x: e.clientX, y: e.clientY };
    setDrag(dragRef.current);
    window.addEventListener("pointermove", onHostPointerMove);
    window.addEventListener("pointerup", onHostPointerUp, { once: true });
    const doc = frameDoc();
    doc?.addEventListener("pointermove", onFramePointerMove);
    doc?.addEventListener("pointerup", onFramePointerUp);
  }

  function endDragListeners() {
    window.removeEventListener("pointermove", onHostPointerMove);
    window.removeEventListener("pointerup", onHostPointerUp);
    const doc = frameDoc();
    doc?.removeEventListener("pointermove", onFramePointerMove);
    doc?.removeEventListener("pointerup", onFramePointerUp);
  }

  function dragMove(hostX: number, hostY: number) {
    const d = dragRef.current;
    if (!d) return;
    const start = dragStartRef.current;
    if (!d.active && start && Math.hypot(hostX - start.x, hostY - start.y) < 5) return;
    if (!d.active) {
      d.active = true;
      frameDoc()?.documentElement.setAttribute("data-sb-dragging", "");
      if (d.payload.type === "move") {
        const el = selectedRef.current;
        el?.removeAttribute("contenteditable");
      }
    }
    d.x = hostX;
    d.y = hostY;
    setDrag({ ...d });

    const doc = frameDoc();
    const r = root();
    const off = frameOffset();
    const fx = hostX - off.left;
    const fy = hostY - off.top;
    const frame = frameRef.current;
    if (!doc || !r || !frame || fx < 0 || fy < 0 || fx > frame.clientWidth || fy > frame.clientHeight) {
      dropRef.current = null;
      showIndicator(doc as Document, null);
      return;
    }
    // Auto-scroll near the edges.
    const win = doc.defaultView;
    if (win) {
      if (fy < 48) win.scrollBy(0, -14);
      else if (fy > frame.clientHeight - 48) win.scrollBy(0, 14);
    }
    const excluded = d.payload.type === "move" ? (byId(r, d.payload.id) ?? null) : null;
    const target = computeDropTarget(doc, r, fx, fy, excluded);
    dropRef.current = target;
    showIndicator(doc, target);
  }

  function dragEnd() {
    const d = dragRef.current;
    const target = dropRef.current;
    endDragListeners();
    const doc = frameDoc();
    doc?.documentElement.removeAttribute("data-sb-dragging");
    hideIndicator(doc);
    dragRef.current = null;
    dropRef.current = null;
    dragStartRef.current = null;
    setDrag(null);
    if (!d) return;
    if (!d.active) {
      // Plain click on a widget card: insert after the selection.
      if (d.payload.type === "widget") insertWidget(d.payload.widget);
      return;
    }
    if (!target) return;
    if (d.payload.type === "widget") {
      insertWidget(d.payload.widget, target);
    } else {
      const r = root();
      const el = r ? byId(r, d.payload.id) : null;
      if (el) moveElement(el, target.ref, target.where);
    }
  }

  const onHostPointerMove = useCallback((e: PointerEvent) => fns.current.dragMove(e.clientX, e.clientY), []);
  const onHostPointerUp = useCallback(() => fns.current.dragEnd(), []);
  const onFramePointerMove = useCallback((e: PointerEvent) => {
    const off = fns.current.frameOffset();
    fns.current.dragMove(e.clientX + off.left, e.clientY + off.top);
  }, []);
  const onFramePointerUp = useCallback(() => fns.current.dragEnd(), []);

  // Latest closures for listeners that are attached once (iframe document,
  // window) — refreshed after every render inside an effect.
  useEffect(() => {
    fns.current = { save, undo, redo, removeSelected, dragMove, dragEnd, frameOffset, applyStylesToFrame, updateToolbar };
  });

  /* ---------- render ---------- */

  const deviceInfo = DEVICES.find((d) => d.id === device)!;
  const { canUndo, canRedo } = historyState;

  return (
    <div className={`sbve${leftTab ? "" : " rail-collapsed"}`}>
      <style dangerouslySetInnerHTML={{ __html: EDITOR_CSS }} />

      <header className="sbve-top">
        <span className="sbve-brand" title={siteName}>{siteName}</span>
        <span className="sbve-path">{currentPath}</span>
        <div className="sbve-devices" role="tablist" aria-label="Preview device">
          {DEVICES.map((d) => (
            <button key={d.id} type="button" className={device === d.id ? "active" : ""} onClick={() => setDevice(d.id)} title={d.width ? `${d.width}px` : "Full width"}>
              {d.label}
            </button>
          ))}
        </div>
        <label className="sbve-toggle" title="Turn on to click links and browse the site (animations play) instead of editing">
          <input type="checkbox" checked={navigateMode} onChange={(e) => toggleNavigate(e.target.checked)} />
          Browse
        </label>
        <span className="sbve-spacer" />
        {status ? (
          <span className={`sbve-status ${status.kind === "error" ? "error" : ""}`}>{status.text}</span>
        ) : dirty ? (
          <span className="sbve-status dirty">Unsaved changes</span>
        ) : null}
        <button type="button" className="sbve-btn ghost icon" onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)">
          ↶
        </button>
        <button type="button" className="sbve-btn ghost icon" onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)">
          ↷
        </button>
        <button type="button" className="sbve-btn ghost" onClick={reloadFrame} title="Reload preview">
          Reload
        </button>
        <button type="button" className="sbve-btn primary" onClick={() => void save()} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
        {downloadHref ? (
          <a className="sbve-btn" href={downloadHref}>
            Download zip
          </a>
        ) : null}
        {exitHref ? (
          <a className="sbve-btn ghost" href={exitHref}>
            {exitLabel}
          </a>
        ) : null}
      </header>

      <nav className="sbve-rail" aria-label="Editor panels">
        {(
          [
            ["widgets", "＋", "Add"],
            ["layers", "☰", "Layers"],
            ["pages", "▤", "Pages"],
          ] as Array<[LeftTab, string, string]>
        ).map(([id, glyph, label]) => (
          <button key={id} type="button" className={leftTab === id ? "active" : ""} onClick={() => setLeftTab((t) => (t === id ? null : id))} title={label}>
            <span className="g">{glyph}</span>
            <span>{label}</span>
          </button>
        ))}
      </nav>

      <aside className="sbve-left" style={{ display: leftTab ? "flex" : "none" }}>
        {leftTab === "widgets" ? (
          <>
            <div className="sbve-panel-head">Add to page</div>
            <WidgetsPanel
              onInsert={(id) => insertWidget(id)}
              onDragStart={(e, id) => beginDrag(e, { type: "widget", widget: id }, findWidget(id)?.name || id)}
              insideWidget={selection && selectedRef.current ? insideTarget(selectedRef.current)?.label : undefined}
            />
          </>
        ) : null}
        {leftTab === "layers" ? (
          <>
            <div className="sbve-panel-head">Layers</div>
            <div className="sbve-panel-body">
              <LayersPanel
                root={rootEl}
                version={treeVersion}
                selected={selectedEl}
                onSelect={(el) => select(el, { edit: false, scroll: true })}
                onHover={(el) => {
                  if (hoverRef.current) hoverRef.current.removeAttribute(HOVER_ATTR);
                  hoverRef.current = el;
                  if (el && el !== selectedRef.current) el.setAttribute(HOVER_ATTR, "1");
                }}
                onMove={moveElement}
              />
            </div>
          </>
        ) : null}
        {leftTab === "pages" ? (
          <>
            <div className="sbve-panel-head">Pages</div>
            <PagesPanel
              pages={pages}
              currentPath={currentPath}
              currentTitle={title}
              onGoTo={goTo}
              onCreate={createPage}
              onDuplicate={duplicatePage}
              onCsvPreview={previewCsv}
              onCsvImport={importCsv}
              onDelete={deletePage}
            />
          </>
        ) : null}
      </aside>

      <main className="sbve-main">
        <div
          ref={frameRef}
          className={`sbve-frame${deviceInfo.width ? " device" : ""}${drag?.active ? " dragging" : ""}`}
          style={deviceInfo.width ? { width: deviceInfo.width, maxWidth: "100%" } : undefined}
        >
          <iframe key={frameKey} ref={iframeRef} src={previewUrl} title="Page preview" onLoad={onFrameLoad} />
          <div className="sbve-overlay">
            {selection && toolbarPos && !navigateMode ? (
              <div className="sbve-eltb" style={{ left: toolbarPos.left, top: toolbarPos.top }}>
                <span className="lb">{selection.label}</span>
                <button type="button" onClick={selectParent} disabled={!selection.hasParent} title="Select parent">
                  ↰
                </button>
                <button type="button" onClick={() => moveSelected("up")} disabled={!selection.canMoveUp} title="Move up">
                  ▲
                </button>
                <button type="button" onClick={() => moveSelected("down")} disabled={!selection.canMoveDown} title="Move down">
                  ▼
                </button>
                <button type="button" className="grab" onPointerDown={(e) => beginDrag(e, { type: "move", id: selection.id }, selection.label)} title="Drag to move">
                  ✥
                </button>
                <button type="button" onClick={duplicateSelected} title="Duplicate">
                  ⧉
                </button>
                <button type="button" className="danger" onClick={removeSelected} title="Delete">
                  ✕
                </button>
              </div>
            ) : null}
            {selection && !navigateMode ? (
              <div className="sbve-crumbs">
                {selection.path.map((node, i) => (
                  <button key={node.id} type="button" className={i === selection.path.length - 1 ? "current" : ""} onClick={() => selectById(node.id)}>
                    {node.label}
                    {i < selection.path.length - 1 ? " ›" : ""}
                  </button>
                ))}
              </div>
            ) : null}
            {drag?.active ? (
              <div className="sbve-placing">
                <span>{drag.payload.type === "widget" ? `Drop “${drag.label}” where the line shows` : `Moving “${drag.label}”`}</span>
              </div>
            ) : null}
          </div>
        </div>
      </main>

      <aside className="sbve-right">
        <div className="sbve-tabs">
          {(
            [
              ["content", "Content"],
              ["style", "Style"],
              ["page", "Page"],
              ["theme", "Theme"],
              ["a11y", "A11y"],
            ] as Array<[RightTab, string]>
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={rightTab === id ? "active" : ""}
              onClick={() => setRightTab(id)}
              aria-pressed={rightTab === id}
              title={id === "a11y" ? `Accessibility: ${issues.length} issue${issues.length === 1 ? "" : "s"}` : undefined}
              aria-label={id === "a11y" ? `Accessibility, ${issues.length} issue${issues.length === 1 ? "" : "s"}` : undefined}
            >
              {label}
              {id === "a11y" && rootEl ? <span className={`sbve-badge${issues.length === 0 ? " ok" : ""}`}>{issues.length === 0 ? "✓" : issues.length}</span> : null}
            </button>
          ))}
        </div>
        {rightTab === "a11y" ? (
          <A11yPanel issues={issues} scanning={scanning} selectedId={selection?.id ?? null} onRescan={runAudit} onSelect={selectById} onFix={fixIssue} />
        ) : null}
        {rightTab === "content" ? (
          <ContentPanel
            selection={selection}
            assetPrefix={assetPrefix}
            uploading={uploading}
            onUploadImage={(file) => void uploadImage(file)}
            onImageSrc={applyImageSrc}
            onAlt={(alt) => setAttr("alt", alt)}
            onHref={(href) => setAttr("href", href)}
            newTab={newTab}
            onNewTab={(on) => {
              setNewTab(on);
              setAttr("target", on ? "_blank" : "");
              if (on) setAttr("rel", "noopener");
            }}
            onVideoSrc={setVideoSrc}
            embedHtml={embedHtml}
            onEmbedHtml={setEmbed}
            onDone={clearSelection}
            onRemove={removeSelected}
            onDuplicate={duplicateSelected}
            onSelectParent={selectParent}
            onSetAttr={setAttr}
            feedbackTargets={feedbackTargets()}
            triggerCandidates={
              selection?.feedback && (selection.feedback.trigger === "click" || selection.feedback.trigger === "submit") ? triggerCandidates() : []
            }
            onSetFeedbackIcon={setFeedbackIcon}
            onSetTriggerTarget={setTriggerTarget}
            previewing={previewing}
            onPreview={() => (previewing ? stopPreview() : previewFeedback())}
          />
        ) : null}
        {rightTab === "style" ? (
          <StylePanel
            selection={selection}
            device={device}
            styles={styles}
            computed={computedStyle}
            onChange={changeStyles}
            onBegin={pushHistory}
            onUpload={uploadFile}
            onDeviceChange={setDevice}
          />
        ) : null}
        {rightTab === "page" ? (
          <div className="sbve-panel-body">
            <section className="sbve-section">
              <h3>SEO</h3>
              <label className="sbve-label" htmlFor="sbve-title">Title</label>
              <input
                id="sbve-title"
                className="sbve-input"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  setDirty(true);
                }}
              />
              <label className="sbve-label" htmlFor="sbve-desc">Meta description</label>
              <textarea
                id="sbve-desc"
                className="sbve-textarea"
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value);
                  setDirty(true);
                }}
              />
              <p className="sbve-hint">{description.length} characters</p>
            </section>
            <section className="sbve-section">
              <h3>Custom CSS</h3>
              <textarea
                className="sbve-textarea code"
                key={`extra-${currentPath}-${frameKey}`}
                defaultValue={styles.extra}
                spellCheck={false}
                placeholder={".my-class { color: red; }"}
                onBlur={(e) => {
                  if (e.target.value === stylesRef.current.extra) return;
                  pushHistory();
                  const next = { ...stylesRef.current, extra: e.target.value };
                  stylesRef.current = next;
                  setStyles(next);
                  applyStylesToFrame(next);
                  setDirty(true);
                }}
              />
              <p className="sbve-hint">Applies to this page only. Saved with the page.</p>
            </section>
            <section className="sbve-section">
              <h3>Page</h3>
              <p className="sbve-hint" style={{ marginTop: 0 }}>
                {pages.length} page{pages.length === 1 ? "" : "s"} on this site. Manage them from the Pages panel on the left.
              </p>
              {currentPath !== "/" ? (
                <div className="sbve-row">
                  <button type="button" className="sbve-btn small danger" onClick={deletePage}>
                    Delete this page
                  </button>
                </div>
              ) : null}
            </section>
          </div>
        ) : null}
        {rightTab === "theme" ? (
          <ThemePanel
            theme={theme}
            dirty={themeDirty}
            saving={themeSaving}
            detecting={detecting}
            onChange={changeTheme}
            onSave={() => void saveTheme()}
            onResetAll={resetTheme}
            onDetect={() => void detectTheme()}
            canUndo={themeHistory.canUndo}
            canRedo={themeHistory.canRedo}
            onUndo={undoTheme}
            onRedo={redoTheme}
            onDiscard={discardTheme}
          />
        ) : null}
      </aside>

      {drag?.active ? (
        <div className="sbve-drag-ghost" style={{ left: drag.x, top: drag.y }}>
          {drag.label}
        </div>
      ) : null}
    </div>
  );
}
