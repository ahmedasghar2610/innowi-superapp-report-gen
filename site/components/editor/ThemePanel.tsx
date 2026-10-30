"use client";

// COPIED from innowi-superapp-web/src/features/site-builder/components/editor/ThemePanel.tsx by scripts/sync-editor.cjs.
// Edit it there, then run `npm run sync-editor`.
// Site-wide design tokens (colors, typography, buttons, surfaces) that apply
// as defaults across every page of the site — the app-wide "background,
// foreground, H1, button" style panel, as opposed to Style (one selected
// element) or Page (this page only). Edits preview live in the canvas via
// onChange; nothing is written to content/site.json until Save is pressed,
// so a half-finished theme never gets picked up by the real site.
import { useState } from "react";
import type React from "react";
import type { SiteTheme } from "./types";

type Props = {
  theme: SiteTheme;
  dirty: boolean;
  saving: boolean;
  detecting: boolean;
  onChange: (next: SiteTheme) => void;
  onSave: () => void;
  onResetAll: () => void;
  onDetect: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  /** Throw away unsaved edits (back to the last saved theme). */
  onDiscard: () => void;
};

const FONTS = [
  "",
  "system-ui, sans-serif",
  "Georgia, serif",
  "'Times New Roman', serif",
  "Arial, Helvetica, sans-serif",
  "Verdana, sans-serif",
  "'Trebuchet MS', sans-serif",
  "'Courier New', monospace",
  "Inter, sans-serif",
  "Roboto, sans-serif",
  "'Open Sans', sans-serif",
  "Lato, sans-serif",
  "Montserrat, sans-serif",
  "Poppins, sans-serif",
  "'Playfair Display', serif",
  "Merriweather, serif",
];

function rgbToHex(value: string): string {
  const m = value.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (m) return `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("")}`;
  return /^#[0-9a-f]{6}$/i.test(value) ? value : "#000000";
}

function Section({
  title,
  hint,
  open,
  onToggle,
  children,
}: {
  title: string;
  hint?: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="sbve-section">
      <h3>
        {title}
        <button type="button" className="caret" onClick={onToggle} aria-label={open ? "Collapse" : "Expand"}>
          {open ? "▾" : "▸"}
        </button>
      </h3>
      {open ? (
        <>
          {hint ? (
            <p className="sbve-hint" style={{ marginTop: 0 }}>
              {hint}
            </p>
          ) : null}
          {children}
        </>
      ) : null}
    </section>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | undefined;
  onChange: (v: string) => void;
}) {
  const v = value || "";
  const shown = v || "#ffffff";
  return (
    <label className={`sbve-field${v ? " set" : ""}`}>
      <span>{label}</span>
      <div className="sbve-color">
        <input type="color" value={rgbToHex(shown)} onChange={(e) => onChange(e.target.value)} aria-label={`${label} picker`} />
        <input className="sbve-input" value={v} placeholder="Default" onChange={(e) => onChange(e.target.value)} />
        <button type="button" className="sbve-clear" onClick={() => onChange("")} title="Reset">
          ✕
        </button>
      </div>
    </label>
  );
}

function TextField({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string | undefined;
  placeholder?: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className={`sbve-field${value ? " set" : ""}`}>
      <span>{label}</span>
      <input className="sbve-input" value={value || ""} placeholder={placeholder ?? "Default"} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function NumberField({
  label,
  value,
  placeholder,
  step,
  onChange,
}: {
  label: string;
  value: number | undefined;
  placeholder?: string;
  step?: number;
  onChange: (v: number | undefined) => void;
}) {
  return (
    <label className={`sbve-field${value != null ? " set" : ""}`}>
      <span>{label}</span>
      <input
        className="sbve-input"
        type="number"
        step={step ?? 1}
        value={value ?? ""}
        placeholder={placeholder ?? "Default"}
        onChange={(e) => {
          const raw = e.target.value;
          onChange(raw === "" ? undefined : Number(raw));
        }}
      />
    </label>
  );
}

function FontField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | undefined;
  onChange: (v: string) => void;
}) {
  return (
    <label className={`sbve-field${value ? " set" : ""}`}>
      <span>{label}</span>
      <select className="sbve-select" value={FONTS.includes(value || "") ? value || "" : "__custom"} onChange={(e) => e.target.value !== "__custom" && onChange(e.target.value)}>
        <option value="">Default</option>
        {FONTS.filter(Boolean).map((f) => (
          <option key={f} value={f}>
            {f.split(",")[0].replace(/['"]/g, "")}
          </option>
        ))}
        <option value="__custom">Custom…</option>
      </select>
      <input
        className="sbve-input"
        style={{ marginTop: 6 }}
        value={value || ""}
        placeholder="e.g. 'Poppins', sans-serif"
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string | undefined;
  options: Array<[string, string]>;
  onChange: (v: string) => void;
}) {
  return (
    <label className={`sbve-field${value ? " set" : ""}`}>
      <span>{label}</span>
      <select className="sbve-select" value={value || ""} onChange={(e) => onChange(e.target.value)}>
        <option value="">Default</option>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function ThemePanel({
  theme,
  dirty,
  saving,
  detecting,
  onChange,
  onSave,
  onResetAll,
  onDetect,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onDiscard,
}: Props) {
  const [open, setOpen] = useState<Record<string, boolean>>({
    colors: true,
    typography: true,
    buttons: false,
    surfaces: false,
  });
  const toggle = (id: string) => setOpen((o) => ({ ...o, [id]: !o[id] }));

  const colors = theme.colors || {};
  const typography = theme.typography || {};
  const buttons = theme.buttons || {};
  const surfaces = theme.surfaces || {};

  const setColors = (patch: Partial<NonNullable<SiteTheme["colors"]>>) => onChange({ ...theme, colors: { ...colors, ...patch } });
  const setTypography = (patch: Partial<NonNullable<SiteTheme["typography"]>>) => onChange({ ...theme, typography: { ...typography, ...patch } });
  const setButtons = (patch: Partial<NonNullable<SiteTheme["buttons"]>>) => onChange({ ...theme, buttons: { ...buttons, ...patch } });
  const setSurfaces = (patch: Partial<NonNullable<SiteTheme["surfaces"]>>) => onChange({ ...theme, surfaces: { ...surfaces, ...patch } });

  return (
    <div className="sbve-panel-body">
      <section className="sbve-section" style={{ paddingBottom: 0 }}>
        <p className="sbve-hint" style={{ marginTop: 0 }}>
          Sets the default look for the whole site — every page, current and future. A specific element&rsquo;s own Style panel edits always take
          priority over these defaults.
        </p>
        <div className="sbve-row">
          <button type="button" className="sbve-btn" onClick={onDetect} disabled={detecting} title="Scan this site's own stylesheet and fill in empty fields below">
            {detecting ? "Detecting…" : "Detect from site"}
          </button>
        </div>
        <p className="sbve-hint" style={{ marginTop: 6 }}>
          Fills only the fields still on Default below — it never overwrites a value you&rsquo;ve already set. Best-effort: review the results, then
          adjust anything that doesn&rsquo;t look right before saving.
        </p>
        <div className="sbve-row">
          <button type="button" className="sbve-btn primary small" onClick={onSave} disabled={saving || !dirty}>
            {saving ? "Saving…" : dirty ? "Save theme" : "Saved"}
          </button>
          <button type="button" className="sbve-btn small" onClick={onUndo} disabled={!canUndo} title="Undo last theme change">
            Undo
          </button>
          <button type="button" className="sbve-btn small" onClick={onRedo} disabled={!canRedo} title="Redo">
            Redo
          </button>
        </div>
        <div className="sbve-row">
          <button type="button" className="sbve-btn small" onClick={onDiscard} disabled={!dirty} title="Go back to the last saved theme">
            Discard changes
          </button>
          <button type="button" className="sbve-btn small danger" onClick={onResetAll} title="Clear every field back to the site's own styling (undoable; takes effect when saved)">
            Reset all
          </button>
        </div>
      </section>

      <Section title="Colors" open={open.colors} onToggle={() => toggle("colors")}>
        <ColorField label="Background" value={colors.background} onChange={(v) => setColors({ background: v })} />
        <ColorField label="Surface (cards, sections)" value={colors.surface} onChange={(v) => setColors({ surface: v })} />
        <ColorField label="Text (foreground)" value={colors.foreground} onChange={(v) => setColors({ foreground: v })} />
        <ColorField label="Muted / secondary text" value={colors.muted} onChange={(v) => setColors({ muted: v })} />
        <ColorField label="Accent / brand color" value={colors.accent} onChange={(v) => setColors({ accent: v })} />
        <ColorField label="Text on accent" value={colors.accentForeground} onChange={(v) => setColors({ accentForeground: v })} />
        <ColorField label="Border" value={colors.border} onChange={(v) => setColors({ border: v })} />
        <ColorField label="Link" value={colors.linkColor} onChange={(v) => setColors({ linkColor: v })} />
        <ColorField label="Link (hover)" value={colors.linkHoverColor} onChange={(v) => setColors({ linkHoverColor: v })} />
      </Section>

      <Section title="Typography" open={open.typography} onToggle={() => toggle("typography")}>
        <FontField label="Body font" value={typography.bodyFont} onChange={(v) => setTypography({ bodyFont: v })} />
        <FontField label="Heading font" value={typography.headingFont} onChange={(v) => setTypography({ headingFont: v })} />
        <NumberField label="Base text size (px)" value={typography.baseSize} placeholder="16" onChange={(v) => setTypography({ baseSize: v })} />
        <NumberField label="Body line height" value={typography.bodyLineHeight} step={0.05} placeholder="1.6" onChange={(v) => setTypography({ bodyLineHeight: v })} />
        <NumberField label="Body weight" value={typography.bodyWeight} placeholder="400" onChange={(v) => setTypography({ bodyWeight: v })} />
        <NumberField label="Heading weight" value={typography.headingWeight} placeholder="700" onChange={(v) => setTypography({ headingWeight: v })} />
        <NumberField label="Heading line height" value={typography.headingLineHeight} step={0.05} placeholder="1.15" onChange={(v) => setTypography({ headingLineHeight: v })} />
        <TextField label="Heading letter spacing" value={typography.headingLetterSpacing} placeholder="-0.01em" onChange={(v) => setTypography({ headingLetterSpacing: v })} />
        <div className="sbve-box2">
          <TextField label="H1 size" value={typography.h1Size} placeholder="2.75rem" onChange={(v) => setTypography({ h1Size: v })} />
          <TextField label="H2 size" value={typography.h2Size} placeholder="2rem" onChange={(v) => setTypography({ h2Size: v })} />
          <TextField label="H3 size" value={typography.h3Size} placeholder="1.5rem" onChange={(v) => setTypography({ h3Size: v })} />
          <TextField label="H4 size" value={typography.h4Size} placeholder="1.25rem" onChange={(v) => setTypography({ h4Size: v })} />
          <TextField label="H5 size" value={typography.h5Size} placeholder="1.1rem" onChange={(v) => setTypography({ h5Size: v })} />
          <TextField label="H6 size" value={typography.h6Size} placeholder="1rem" onChange={(v) => setTypography({ h6Size: v })} />
        </div>
      </Section>

      <Section title="Buttons" open={open.buttons} onToggle={() => toggle("buttons")} hint="Applies to every .sb-button (widgets, CTAs, popup/toast actions).">
        <ColorField label="Background" value={buttons.background} onChange={(v) => setButtons({ background: v })} />
        <ColorField label="Text" value={buttons.foreground} onChange={(v) => setButtons({ foreground: v })} />
        <TextField label="Corner radius" value={buttons.radius} placeholder="999px (pill)" onChange={(v) => setButtons({ radius: v })} />
        <TextField label="Vertical padding" value={buttons.paddingBlock} placeholder="0.85em" onChange={(v) => setButtons({ paddingBlock: v })} />
        <TextField label="Horizontal padding" value={buttons.paddingInline} placeholder="1.6em" onChange={(v) => setButtons({ paddingInline: v })} />
        <TextField label="Border width" value={buttons.borderWidth} placeholder="2px" onChange={(v) => setButtons({ borderWidth: v })} />
        <NumberField label="Font weight" value={buttons.fontWeight} placeholder="600" onChange={(v) => setButtons({ fontWeight: v })} />
        <SelectField
          label="Text case"
          value={buttons.textTransform}
          options={[
            ["none", "As typed"],
            ["uppercase", "UPPERCASE"],
            ["capitalize", "Capitalize Each Word"],
            ["lowercase", "lowercase"],
          ]}
          onChange={(v) => setButtons({ textTransform: (v || undefined) as never })}
        />
      </Section>

      <Section
        title="Surfaces & spacing"
        open={open.surfaces}
        onToggle={() => toggle("surfaces")}
        hint="Corner radius and shadow used by cards, images, popups, toasts and form fields."
      >
        <TextField label="Corner radius" value={surfaces.radius} placeholder="10px" onChange={(v) => setSurfaces({ radius: v })} />
        <TextField label="Shadow" value={surfaces.shadow} placeholder="0 12px 32px rgba(0,0,0,.18)" onChange={(v) => setSurfaces({ shadow: v })} />
        <TextField label="Page content max width" value={surfaces.maxWidth} placeholder="1140px" onChange={(v) => setSurfaces({ maxWidth: v })} />
      </Section>
    </div>
  );
}
