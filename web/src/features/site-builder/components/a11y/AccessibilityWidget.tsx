"use client";

// WCAG-oriented accessibility widget: accessible trigger + modal dialog with
// focus trap, keyboard shortcuts (Ctrl+U / Alt+U), live announcements, EN/ES.
// Copied verbatim into generated zips — relative imports only.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { applySettings, jumpTo, pageStructure, type StructureItem } from "./apply";
import { LABELS, detectLang, type Lang, type Labels } from "./i18n";
import {
  DEFAULTS,
  PROFILES,
  isDefault,
  loadSettings,
  saveSettings,
  withProfile,
  type ProfileId,
  type Settings,
} from "./settings";
import { WIDGET_CSS } from "./widget-css";

type Props = {
  statementHref?: string;
  position?: "right" | "left";
  lang?: Lang;
};

const PROFILE_IDS = Object.keys(PROFILES) as ProfileId[];
const STYLE_ID = "sb-a11y-style";
const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export default function AccessibilityWidget({ statementHref, position = "right", lang: langProp }: Props) {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"settings" | "structure">("settings");
  const [lang, setLang] = useState<Lang>(langProp ?? "en");
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [announcement, setAnnouncement] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const t = LABELS[lang];

  // Mount: inject CSS, restore persisted settings, detect language.
  useEffect(() => {
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = WIDGET_CSS;
      document.head.appendChild(style);
    }
    const saved = loadSettings();
    // Deferred so the first client render matches the server markup.
    const id = window.setTimeout(() => {
      setSettings(saved);
      if (!langProp) setLang(detectLang());
      setMounted(true);
    }, 0);
    return () => window.clearTimeout(id);
  }, [langProp]);

  // Apply + persist whenever settings change.
  useEffect(() => {
    if (!mounted) return;
    applySettings(settings);
    saveSettings(settings);
  }, [settings, mounted]);

  const announce = useCallback((message: string) => {
    setAnnouncement("");
    window.setTimeout(() => setAnnouncement(message), 30);
  }, []);

  const update = useCallback(
    (patch: Partial<Settings>, label?: string) => {
      setSettings((prev) => {
        const next = { ...prev, ...patch, profile: "" as const };
        if (label) {
          const key = Object.keys(patch)[0] as keyof Settings;
          const value = next[key];
          const state =
            typeof value === "boolean" ? (value ? t.enabled : t.disabled) : value === "" || value === 0 ? t.disabled : String(value);
          announce(`${label}: ${state}`);
        }
        return next;
      });
    },
    [announce, t.disabled, t.enabled],
  );

  const toggle = useCallback(
    (key: keyof Settings, label: string) => {
      setSettings((prev) => {
        const value = !prev[key];
        announce(`${label} ${value ? t.enabled : t.disabled}`);
        return { ...prev, [key]: value, profile: "" };
      });
    },
    [announce, t.disabled, t.enabled],
  );

  const choose = useCallback(
    <K extends keyof Settings>(key: K, value: Settings[K], label: string) => {
      setSettings((prev) => {
        const next = prev[key] === value ? (DEFAULTS[key] as Settings[K]) : value;
        announce(`${label} ${next === DEFAULTS[key] ? t.disabled : t.enabled}`);
        return { ...prev, [key]: next, profile: "" };
      });
    },
    [announce, t.disabled, t.enabled],
  );

  const setProfile = useCallback(
    (id: ProfileId) => {
      setSettings((prev) => {
        const next = withProfile(prev, id);
        announce(`${t.profile[id]} ${next.profile ? t.enabled : t.disabled}`);
        return next;
      });
    },
    [announce, t],
  );

  const reset = useCallback(() => {
    setSettings({ ...DEFAULTS });
    announce(t.reset);
  }, [announce, t.reset]);

  const close = useCallback(() => {
    setOpen(false);
    setView("settings");
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  }, []);

  const openPanel = useCallback(() => {
    setOpen(true);
  }, []);

  // Focus first control when opened.
  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => {
      const first = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
      first?.focus();
    }, 0);
    return () => window.clearTimeout(id);
  }, [open, view]);

  // Global shortcut: Ctrl+U / Alt+U toggles; Escape closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.altKey) && !e.shiftKey && !e.metaKey && (e.key === "u" || e.key === "U")) {
        e.preventDefault();
        if (open) close();
        else openPanel();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close, openPanel]);

  // Focus trap + Escape inside the dialog.
  const onPanelKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (view === "structure") setView("settings");
      else close();
      return;
    }
    if (e.key !== "Tab" || !panelRef.current) return;
    const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (el) => el.offsetParent !== null,
    );
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  // Arrow-key navigation inside groups (grids/segments) — WAI-ARIA toolbar style.
  const onGroupKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (!["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("button:not([disabled])"));
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    e.preventDefault();
    let next = index;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (index + 1) % buttons.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (index - 1 + buttons.length) % buttons.length;
    else if (e.key === "Home") next = 0;
    else next = buttons.length - 1;
    buttons[next].focus();
  };

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
      setView("settings");
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const dirty = useMemo(() => !isDefault(settings), [settings]);

  return (
    <div className="sb-a11y" data-position={position} suppressHydrationWarning>
      <button
        ref={triggerRef}
        type="button"
        className="sb-a11y-trigger"
        aria-label={t.open}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="sb-a11y-dialog"
        title={`${t.open} (Ctrl+U)`}
        onClick={() => (open ? close() : openPanel())}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <circle cx="12" cy="4.2" r="2.2" />
          <path d="M20 8.3c-2.6.6-5.3.9-8 .9s-5.4-.3-8-.9l-.4 1.9c1.8.5 3.7.8 5.6.9L8.4 21h2.1l1.3-6.2h.4L13.5 21h2.1l-.8-9.9c1.9-.1 3.8-.4 5.6-.9L20 8.3z" />
        </svg>
      </button>
      <div className="sb-a11y-sr" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>

      {open && (
        <div
          id="sb-a11y-dialog"
          ref={panelRef}
          className="sb-a11y-panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby="sb-a11y-title"
          onKeyDown={onPanelKeyDown}
        >
          <div className="sb-a11y-head">
            <div>
              <h2 id="sb-a11y-title">{view === "structure" ? t.structureTitle : t.title}</h2>
              <small>{t.shortcut}</small>
            </div>
            <div className="sb-a11y-lang" role="group" aria-label={t.language}>
              {(["en", "es"] as Lang[]).map((code) => (
                <button key={code} type="button" aria-pressed={lang === code} lang={code} onClick={() => setLang(code)}>
                  {code.toUpperCase()}
                </button>
              ))}
            </div>
            <button type="button" className="sb-a11y-icon-btn" aria-label={t.close} onClick={close}>
              ×
            </button>
          </div>

          {view === "structure" ? (
            <StructureView t={t} onBack={() => setView("settings")} onJump={(el) => { close(); jumpTo(el); }} />
          ) : (
            <>
              <section className="sb-a11y-section" aria-labelledby="sb-a11y-profiles">
                <h3 id="sb-a11y-profiles">{t.profiles}</h3>
                <p className="sb-a11y-hint">{t.profileHint}</p>
                <div className="sb-a11y-grid" role="group" aria-label={t.profiles} onKeyDown={onGroupKeyDown}>
                  {PROFILE_IDS.map((id) => (
                    <button
                      key={id}
                      type="button"
                      className="sb-a11y-tile"
                      aria-pressed={settings.profile === id}
                      onClick={() => setProfile(id)}
                    >
                      {t.profile[id]}
                      <small>{t.profile[`${id}Desc`]}</small>
                    </button>
                  ))}
                </div>
              </section>

              <section className="sb-a11y-section" aria-labelledby="sb-a11y-content">
                <h3 id="sb-a11y-content">{t.content}</h3>
                <div className="sb-a11y-row">
                  <span id="sb-a11y-fs">{t.fontSize}</span>
                  <div className="sb-a11y-seg" role="group" aria-labelledby="sb-a11y-fs">
                    <button
                      type="button"
                      aria-label={t.decrease}
                      disabled={settings.fontSize <= 100}
                      onClick={() => update({ fontSize: Math.max(100, settings.fontSize - 10) }, t.fontSize)}
                    >
                      −
                    </button>
                    <span className="sb-a11y-value" aria-live="off">
                      {settings.fontSize}%
                    </span>
                    <button
                      type="button"
                      aria-label={t.increase}
                      disabled={settings.fontSize >= 200}
                      onClick={() => update({ fontSize: Math.min(200, settings.fontSize + 10) }, t.fontSize)}
                    >
                      +
                    </button>
                  </div>
                </div>
                <LevelRow id="lh" label={t.lineHeight} levels={t.levels} value={settings.lineHeight} onChange={(v) => update({ lineHeight: v }, t.lineHeight)} onKeyDown={onGroupKeyDown} />
                <LevelRow id="ls" label={t.letterSpacing} levels={t.levels} value={settings.letterSpacing} onChange={(v) => update({ letterSpacing: v }, t.letterSpacing)} onKeyDown={onGroupKeyDown} />
                <div className="sb-a11y-row">
                  <span id="sb-a11y-align">{t.textAlign}</span>
                  <div className="sb-a11y-seg" role="group" aria-labelledby="sb-a11y-align" onKeyDown={onGroupKeyDown}>
                    {(
                      [
                        ["left", t.alignLeft, "⇤"],
                        ["center", t.alignCenter, "☰"],
                        ["right", t.alignRight, "⇥"],
                      ] as const
                    ).map(([value, label, glyph]) => (
                      <button key={value} type="button" aria-label={label} aria-pressed={settings.textAlign === value} onClick={() => choose("textAlign", value, label)}>
                        <span aria-hidden="true">{glyph}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="sb-a11y-grid" role="group" aria-label={t.content} onKeyDown={onGroupKeyDown}>
                  <Tile label={t.fontReadable} pressed={settings.font === "readable"} onClick={() => choose("font", "readable", t.fontReadable)} />
                  <Tile label={t.fontDyslexic} pressed={settings.font === "dyslexic"} onClick={() => choose("font", "dyslexic", t.fontDyslexic)} />
                  <Switch label={t.highlightTitles} checked={settings.highlightTitles} onClick={() => toggle("highlightTitles", t.highlightTitles)} />
                  <Switch label={t.highlightLinks} checked={settings.highlightLinks} onClick={() => toggle("highlightLinks", t.highlightLinks)} />
                  <Switch label={t.focusHighlight} checked={settings.focusHighlight} onClick={() => toggle("focusHighlight", t.focusHighlight)} />
                </div>
              </section>

              <section className="sb-a11y-section" aria-labelledby="sb-a11y-color">
                <h3 id="sb-a11y-color">{t.color}</h3>
                <div className="sb-a11y-grid" role="group" aria-label={t.color} onKeyDown={onGroupKeyDown}>
                  <Tile label={t.contrastHigh} pressed={settings.contrast === "high"} onClick={() => choose("contrast", "high", t.contrastHigh)} />
                  <Tile label={t.contrastDark} pressed={settings.contrast === "dark"} onClick={() => choose("contrast", "dark", t.contrastDark)} />
                  <Tile label={t.contrastLight} pressed={settings.contrast === "light"} onClick={() => choose("contrast", "light", t.contrastLight)} />
                  <Switch label={t.monochrome} checked={settings.monochrome} onClick={() => toggle("monochrome", t.monochrome)} />
                  <Tile label={t.saturationLow} pressed={settings.saturation === "low"} onClick={() => choose("saturation", "low", t.saturationLow)} />
                  <Tile label={t.saturationHigh} pressed={settings.saturation === "high"} onClick={() => choose("saturation", "high", t.saturationHigh)} />
                  <Switch label={t.invert} checked={settings.invert} onClick={() => toggle("invert", t.invert)} />
                </div>
              </section>

              <section className="sb-a11y-section" aria-labelledby="sb-a11y-tools">
                <h3 id="sb-a11y-tools">{t.tools}</h3>
                <div className="sb-a11y-grid" role="group" aria-label={t.tools} onKeyDown={onGroupKeyDown}>
                  <Switch label={t.bigCursor} checked={settings.bigCursor} onClick={() => toggle("bigCursor", t.bigCursor)} />
                  <Switch label={t.readingGuide} checked={settings.readingGuide} onClick={() => toggle("readingGuide", t.readingGuide)} />
                  <Switch label={t.readingMask} checked={settings.readingMask} onClick={() => toggle("readingMask", t.readingMask)} />
                  <Switch label={t.stopAnimations} checked={settings.stopAnimations} onClick={() => toggle("stopAnimations", t.stopAnimations)} />
                  <Switch label={t.hideImages} checked={settings.hideImages} onClick={() => toggle("hideImages", t.hideImages)} />
                  <Switch label={t.muteSounds} checked={settings.muteSounds} onClick={() => toggle("muteSounds", t.muteSounds)} />
                  <button type="button" className="sb-a11y-tile" onClick={() => setView("structure")}>
                    {t.structure} <small>H1–H6 · {t.landmarks} · {t.links}</small>
                  </button>
                </div>
              </section>

              <div className="sb-a11y-footer">
                <button type="button" className="sb-a11y-btn primary" onClick={reset} disabled={!dirty} aria-disabled={!dirty}>
                  {t.reset}
                </button>
                {statementHref && (
                  <a className="sb-a11y-btn" href={statementHref}>
                    {t.statement}
                  </a>
                )}
                <p className="sb-a11y-credit">{t.version}</p>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Tile({ label, pressed, onClick }: { label: string; pressed: boolean; onClick: () => void }) {
  return (
    <button type="button" className="sb-a11y-tile" aria-pressed={pressed} onClick={onClick}>
      {label}
    </button>
  );
}

function Switch({ label, checked, onClick }: { label: string; checked: boolean; onClick: () => void }) {
  return (
    <button type="button" role="switch" className="sb-a11y-tile" aria-checked={checked} onClick={onClick}>
      {label}
    </button>
  );
}

function LevelRow({
  id,
  label,
  levels,
  value,
  onChange,
  onKeyDown,
}: {
  id: string;
  label: string;
  levels: string[];
  value: 0 | 1 | 2 | 3;
  onChange: (value: 0 | 1 | 2 | 3) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => void;
}) {
  return (
    <div className="sb-a11y-row">
      <span id={`sb-a11y-${id}`}>{label}</span>
      <div className="sb-a11y-seg" role="group" aria-labelledby={`sb-a11y-${id}`} onKeyDown={onKeyDown}>
        {([0, 1, 2, 3] as const).map((level) => (
          <button key={level} type="button" aria-label={levels[level]} aria-pressed={value === level} onClick={() => onChange(level)}>
            {level === 0 ? "A" : "A".padEnd(level + 1, "+")}
          </button>
        ))}
      </div>
    </div>
  );
}

function StructureView({ t, onBack, onJump }: { t: Labels; onBack: () => void; onJump: (el: HTMLElement) => void }) {
  const [tab, setTab] = useState<"headings" | "landmarks" | "links">("headings");
  const data = useMemo(() => pageStructure(), []);
  const items: StructureItem[] = data[tab];
  return (
    <section className="sb-a11y-section">
      <button type="button" className="sb-a11y-btn sb-a11y-back" onClick={onBack}>
        ← {t.structureBack}
      </button>
      <div className="sb-a11y-tabs" role="tablist" aria-label={t.structureTitle}>
        {(
          [
            ["headings", t.headings, data.headings.length],
            ["landmarks", t.landmarks, data.landmarks.length],
            ["links", t.links, data.links.length],
          ] as const
        ).map(([key, label, count]) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={`sb-a11y-tab-${key}`}
            aria-selected={tab === key}
            aria-controls="sb-a11y-structure-list"
            tabIndex={tab === key ? 0 : -1}
            onClick={() => setTab(key)}
            onKeyDown={(e) => {
              const order = ["headings", "landmarks", "links"] as const;
              const i = order.indexOf(tab);
              let next: (typeof order)[number];
              if (e.key === "ArrowRight") next = order[(i + 1) % 3];
              else if (e.key === "ArrowLeft") next = order[(i + 2) % 3];
              else return;
              e.preventDefault();
              setTab(next);
              window.setTimeout(() => document.getElementById(`sb-a11y-tab-${next}`)?.focus(), 0);
            }}
          >
            {label} ({count})
          </button>
        ))}
      </div>
      <ul id="sb-a11y-structure-list" className="sb-a11y-list" role="tabpanel" aria-labelledby={`sb-a11y-tab-${tab}`}>
        {items.length === 0 && <li className="sb-a11y-empty">{t.none}</li>}
        {items.map((item, i) => (
          <li key={i}>
            {/* Indent via a custom property: the shell CSS is !important and would override a plain inline padding. */}
            <button type="button" onClick={() => onJump(item.el)} style={{ "--sb-a11y-indent": item.level ? item.level - 1 : 0 } as React.CSSProperties}>
              {item.level ? <span className="lvl">H{item.level}</span> : null}
              <span className="txt">{item.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
