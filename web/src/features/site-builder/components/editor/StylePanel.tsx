"use client";

import { useRef, useState } from "react";
import type React from "react";
import { getDecl } from "./styles";
import type { PageStyles } from "./styles";
import type { Device, Selection } from "./types";

type Props = {
  selection: Selection | null;
  device: Device;
  styles: PageStyles;
  /** Computed style of the selected element (placeholder values). */
  computed: (prop: string) => string;
  /** Set declarations on the selected element for the current device. */
  onChange: (decls: Record<string, string>) => void;
  /** Called before a field starts changing (history snapshot). */
  onBegin: () => void;
  onUpload: (file: File) => Promise<string | null>;
  onDeviceChange: (device: Device) => void;
};

const UNITLESS = new Set(["line-height", "opacity", "font-weight", "z-index", "flex-grow", "flex-shrink", "order"]);

function normalize(prop: string, value: string): string {
  const v = value.trim();
  if (!v) return "";
  if (UNITLESS.has(prop)) return v;
  if (/^-?\d+(\.\d+)?$/.test(v)) return `${v}px`;
  return v;
}

function rgbToHex(value: string): string {
  const m = value.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (!m) return /^#[0-9a-f]{6}$/i.test(value) ? value : "#000000";
  return `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("")}`;
}

function shorten(value: string, max = 26): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

const FONTS = [
  "inherit",
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

/* ---------- controls (module level so inputs keep focus across renders) ---------- */

type Ctx = {
  get: (prop: string) => string;
  set: (prop: string, value: string) => void;
  computed: (prop: string) => string;
};

function Section({
  title,
  open,
  onToggle,
  children,
}: {
  title: string;
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
      {open ? children : null}
    </section>
  );
}

function Field({ ctx, prop, label, placeholder, list }: { ctx: Ctx; prop: string; label: string; placeholder?: string; list?: string }) {
  const value = ctx.get(prop);
  return (
    <label className={`sbve-field${value ? " set" : ""}`}>
      <span>{label}</span>
      <input
        className="sbve-input"
        type="text"
        list={list}
        value={value}
        placeholder={placeholder ?? shorten(ctx.computed(prop))}
        onChange={(e) => ctx.set(prop, e.target.value)}
      />
    </label>
  );
}

function Select({ ctx, prop, label, options }: { ctx: Ctx; prop: string; label: string; options: Array<[string, string]> }) {
  const value = ctx.get(prop);
  return (
    <label className={`sbve-field${value ? " set" : ""}`}>
      <span>{label}</span>
      <select className="sbve-select" value={value} onChange={(e) => ctx.set(prop, e.target.value)}>
        <option value="">Default ({shorten(ctx.computed(prop), 14)})</option>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

function Seg({ ctx, prop, label, options }: { ctx: Ctx; prop: string; label: string; options: Array<[string, string]> }) {
  const authored = ctx.get(prop);
  const value = authored || ctx.computed(prop);
  return (
    <div className={`sbve-field${authored ? " set" : ""}`}>
      <span>{label}</span>
      <div className="sbve-seg">
        {options.map(([v, l]) => (
          <button
            key={v}
            type="button"
            className={value === v ? "active" : ""}
            onClick={() => ctx.set(prop, authored === v ? "" : v)}
            title={v}
          >
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}

function Color({ ctx, prop, label }: { ctx: Ctx; prop: string; label: string }) {
  const value = ctx.get(prop);
  const shown = value || ctx.computed(prop);
  return (
    <div className={`sbve-field${value ? " set" : ""}`}>
      <span>{label}</span>
      <div className="sbve-color">
        <input type="color" value={rgbToHex(shown)} onChange={(e) => ctx.set(prop, e.target.value)} aria-label={`${label} picker`} />
        <input className="sbve-input" value={value} placeholder={shorten(shown, 18)} onChange={(e) => ctx.set(prop, e.target.value)} />
        <button type="button" className="sbve-clear" onClick={() => ctx.set(prop, "")} title="Reset">
          ✕
        </button>
      </div>
    </div>
  );
}

function Box({ ctx, base, label }: { ctx: Ctx; base: "margin" | "padding"; label: string }) {
  const sides = ["top", "right", "bottom", "left"] as const;
  const anySet = sides.some((s) => ctx.get(`${base}-${s}`));
  const input = (side: (typeof sides)[number], style: React.CSSProperties) => (
    <input
      key={side}
      className="sbve-input"
      style={style}
      value={ctx.get(`${base}-${side}`)}
      placeholder={ctx.computed(`${base}-${side}`).replace(/px$/, "") || "0"}
      onChange={(e) => ctx.set(`${base}-${side}`, e.target.value)}
      aria-label={`${label} ${side}`}
    />
  );
  return (
    <div className={`sbve-field${anySet ? " set" : ""}`}>
      <span>{label}</span>
      <div className="sbve-box">
        {input("top", { gridColumn: 2, gridRow: 1 })}
        {input("left", { gridColumn: 1, gridRow: 2 })}
        <span className="c">{base}</span>
        {input("right", { gridColumn: 3, gridRow: 2 })}
        {input("bottom", { gridColumn: 2, gridRow: 3 })}
      </div>
    </div>
  );
}

/* ---------- panel ---------- */

export default function StylePanel({ selection, device, styles, computed, onChange, onBegin, onUpload, onDeviceChange }: Props) {
  const [open, setOpen] = useState<Record<string, boolean>>({
    typography: true,
    background: true,
    spacing: true,
    border: false,
    shadow: false,
    size: false,
    layout: false,
    effects: false,
  });
  const fileRef = useRef<HTMLInputElement | null>(null);

  if (!selection) {
    return <p className="sbve-empty">Select an element on the page to style it.</p>;
  }

  const id = selection.id;
  const ctx: Ctx = {
    get: (prop) => getDecl(styles, id, device, prop),
    set: (prop, value) => onChange({ [prop]: normalize(prop, value) }),
    computed,
  };
  const toggle = (k: string) => () => setOpen((o) => ({ ...o, [k]: !(o[k] !== false) }));
  const isOpen = (k: string) => open[k] !== false;

  const bgImage = ctx.get("background-image");
  const display = ctx.get("display") || computed("display");
  const isFlex = display.includes("flex") || display.includes("grid");

  return (
    <div className="sbve-panel-body" onFocusCapture={onBegin}>
      <div className="sbve-device-note">
        <span>Editing</span>
        <div className="sbve-seg" style={{ width: "auto" }}>
          {(["desktop", "tablet", "mobile"] as Device[]).map((d) => (
            <button key={d} type="button" className={device === d ? "active" : ""} onClick={() => onDeviceChange(d)}>
              {d === "desktop" ? "Desktop" : d === "tablet" ? "Tablet" : "Mobile"}
            </button>
          ))}
        </div>
      </div>
      <div className="sbve-section" style={{ paddingBottom: ".5rem" }}>
        <span className="sbve-chip">{selection.label}</span> <span className="sbve-chip">&lt;{selection.tag}&gt;</span>
        <p className="sbve-hint">
          Highlighted labels are set for this breakpoint. Desktop values apply everywhere unless overridden on tablet or mobile.
        </p>
      </div>

      <Section title="Typography" open={isOpen("typography")} onToggle={toggle("typography")}>
        <datalist id="sbve-fonts">
          {FONTS.map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>
        <Field ctx={ctx} prop="font-family" label="Font family" list="sbve-fonts" />
        <div className="sbve-grid2" style={{ marginTop: 6 }}>
          <Field ctx={ctx} prop="font-size" label="Size" />
          <Select
            ctx={ctx}
            prop="font-weight"
            label="Weight"
            options={[["300", "Light"], ["400", "Regular"], ["500", "Medium"], ["600", "Semibold"], ["700", "Bold"], ["800", "Extra bold"]]}
          />
          <Field ctx={ctx} prop="line-height" label="Line height" />
          <Field ctx={ctx} prop="letter-spacing" label="Letter spacing" />
        </div>
        <div style={{ marginTop: 6 }}>
          <Seg ctx={ctx} prop="text-align" label="Align" options={[["left", "⟸"], ["center", "≡"], ["right", "⟹"], ["justify", "☰"]]} />
        </div>
        <div className="sbve-grid2" style={{ marginTop: 6 }}>
          <Select ctx={ctx} prop="text-transform" label="Transform" options={[["none", "None"], ["uppercase", "UPPER"], ["lowercase", "lower"], ["capitalize", "Capitalize"]]} />
          <Select ctx={ctx} prop="text-decoration" label="Decoration" options={[["none", "None"], ["underline", "Underline"], ["line-through", "Strike"]]} />
        </div>
        <div style={{ marginTop: 6 }}>
          <Color ctx={ctx} prop="color" label="Text colour" />
        </div>
      </Section>

      <Section title="Background" open={isOpen("background")} onToggle={toggle("background")}>
        <Color ctx={ctx} prop="background-color" label="Colour" />
        <div className={`sbve-field${bgImage ? " set" : ""}`} style={{ marginTop: 6 }}>
          <span>Image</span>
          <input
            className="sbve-input"
            value={bgImage.replace(/^url\((['"]?)(.*)\1\)$/, "$2")}
            placeholder={computed("background-image") === "none" ? "none" : shorten(computed("background-image"), 30)}
            onChange={(e) => {
              const v = e.target.value.trim();
              onChange({ "background-image": v && v !== "none" ? `url("${v}")` : v === "none" ? "none" : "" });
            }}
          />
          <div className="sbve-row" style={{ marginTop: 4 }}>
            <button type="button" className="sbve-btn small" onClick={() => fileRef.current?.click()}>
              Upload image
            </button>
            <button type="button" className="sbve-btn small" onClick={() => onChange({ "background-image": "none" })}>
              No image
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                onBegin();
                const url = await onUpload(file);
                if (url) {
                  onChange({
                    "background-image": `url("${url}")`,
                    "background-size": ctx.get("background-size") || "cover",
                    "background-position": ctx.get("background-position") || "center",
                  });
                }
              }}
            />
          </div>
        </div>
        <div className="sbve-grid3" style={{ marginTop: 6 }}>
          <Select ctx={ctx} prop="background-size" label="Size" options={[["cover", "Cover"], ["contain", "Contain"], ["auto", "Auto"], ["100% 100%", "Stretch"]]} />
          <Select ctx={ctx} prop="background-position" label="Position" options={[["center", "Center"], ["top", "Top"], ["bottom", "Bottom"], ["left", "Left"], ["right", "Right"]]} />
          <Select ctx={ctx} prop="background-repeat" label="Repeat" options={[["no-repeat", "No"], ["repeat", "Tile"], ["repeat-x", "X"], ["repeat-y", "Y"]]} />
        </div>
      </Section>

      <Section title="Spacing" open={isOpen("spacing")} onToggle={toggle("spacing")}>
        <Box ctx={ctx} base="padding" label="Padding" />
        <div style={{ marginTop: 6 }}>
          <Box ctx={ctx} base="margin" label="Margin" />
        </div>
      </Section>

      <Section title="Border" open={isOpen("border")} onToggle={toggle("border")}>
        <div className="sbve-grid2">
          <Field ctx={ctx} prop="border-width" label="Width" />
          <Select ctx={ctx} prop="border-style" label="Style" options={[["none", "None"], ["solid", "Solid"], ["dashed", "Dashed"], ["dotted", "Dotted"], ["double", "Double"]]} />
        </div>
        <div style={{ marginTop: 6 }}>
          <Color ctx={ctx} prop="border-color" label="Colour" />
        </div>
        <div style={{ marginTop: 6 }}>
          <Field ctx={ctx} prop="border-radius" label="Radius" />
        </div>
      </Section>

      <Section title="Shadow" open={isOpen("shadow")} onToggle={toggle("shadow")}>
        <Select
          ctx={ctx}
          prop="box-shadow"
          label="Box shadow"
          options={[
            ["none", "None"],
            ["0 1px 3px rgba(0,0,0,.12)", "Small"],
            ["0 6px 18px rgba(0,0,0,.14)", "Medium"],
            ["0 18px 48px rgba(0,0,0,.18)", "Large"],
            ["inset 0 2px 6px rgba(0,0,0,.15)", "Inset"],
          ]}
        />
        <div style={{ marginTop: 6 }}>
          <Field ctx={ctx} prop="box-shadow" label="Custom" placeholder="x y blur spread colour" />
        </div>
      </Section>

      <Section title="Size" open={isOpen("size")} onToggle={toggle("size")}>
        <div className="sbve-grid2">
          <Field ctx={ctx} prop="width" label="Width" />
          <Field ctx={ctx} prop="max-width" label="Max width" />
          <Field ctx={ctx} prop="height" label="Height" />
          <Field ctx={ctx} prop="min-height" label="Min height" />
        </div>
        {selection.widget === "spacer" ? (
          <div style={{ marginTop: 6 }}>
            <Field ctx={ctx} prop="--sb-space" label="Spacer height" placeholder="48px" />
          </div>
        ) : null}
      </Section>

      <Section title="Layout" open={isOpen("layout")} onToggle={toggle("layout")}>
        <Select
          ctx={ctx}
          prop="display"
          label="Display"
          options={[["block", "Block"], ["flex", "Flex"], ["grid", "Grid"], ["inline-block", "Inline block"], ["inline", "Inline"], ["none", "Hidden"]]}
        />
        {isFlex ? (
          <div className="sbve-grid2" style={{ marginTop: 6 }}>
            <Select ctx={ctx} prop="flex-direction" label="Direction" options={[["row", "Row"], ["column", "Column"], ["row-reverse", "Row reverse"], ["column-reverse", "Column reverse"]]} />
            <Select ctx={ctx} prop="flex-wrap" label="Wrap" options={[["nowrap", "No wrap"], ["wrap", "Wrap"]]} />
            <Select ctx={ctx} prop="justify-content" label="Justify" options={[["flex-start", "Start"], ["center", "Center"], ["flex-end", "End"], ["space-between", "Space between"], ["space-around", "Space around"], ["space-evenly", "Space evenly"]]} />
            <Select ctx={ctx} prop="align-items" label="Align" options={[["stretch", "Stretch"], ["flex-start", "Start"], ["center", "Center"], ["flex-end", "End"], ["baseline", "Baseline"]]} />
            <Field ctx={ctx} prop="gap" label="Gap" />
            {display.includes("grid") ? <Field ctx={ctx} prop="grid-template-columns" label="Columns" placeholder="repeat(3, 1fr)" /> : null}
          </div>
        ) : null}
        <div className="sbve-grid2" style={{ marginTop: 6 }}>
          <Select ctx={ctx} prop="position" label="Position" options={[["static", "Static"], ["relative", "Relative"], ["absolute", "Absolute"], ["sticky", "Sticky"]]} />
          <Select ctx={ctx} prop="overflow" label="Overflow" options={[["visible", "Visible"], ["hidden", "Hidden"], ["auto", "Scroll"]]} />
        </div>
      </Section>

      <Section title="Effects" open={isOpen("effects")} onToggle={toggle("effects")}>
        <div className={`sbve-field${ctx.get("opacity") ? " set" : ""}`}>
          <span>Opacity</span>
          <div className="sbve-range">
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={Number(ctx.get("opacity") || computed("opacity") || 1)}
              onChange={(e) => ctx.set("opacity", e.target.value)}
            />
            <input className="sbve-input" value={ctx.get("opacity")} placeholder={computed("opacity")} onChange={(e) => ctx.set("opacity", e.target.value)} />
          </div>
        </div>
        <div className="sbve-grid2" style={{ marginTop: 6 }}>
          <Field ctx={ctx} prop="transform" label="Transform" placeholder="rotate(3deg)" />
          <Field ctx={ctx} prop="transition" label="Transition" placeholder="all .2s ease" />
        </div>
      </Section>
    </div>
  );
}
