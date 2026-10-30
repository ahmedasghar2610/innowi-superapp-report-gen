"use client";

// COPIED from innowi-superapp-web/src/features/site-builder/components/editor/WidgetsPanel.tsx by scripts/sync-editor.cjs.
// Edit it there, then run `npm run sync-editor`.
import type React from "react";
import { TEMPLATES, WIDGETS, type Widget } from "./widgets";

type Props = {
  onInsert: (widgetId: string) => void;
  onDragStart: (e: React.PointerEvent, widgetId: string) => void;
  /** Popup / Toast / Column / Empty box selected — clicked blocks go inside it. */
  insideWidget?: string;
};

const GROUPS: Array<{ id: Widget["group"]; label: string }> = [
  { id: "layout", label: "Layout" },
  { id: "basic", label: "Basic" },
  { id: "media", label: "Media" },
  { id: "feedback", label: "Feedback" },
];

export default function WidgetsPanel({ onInsert, onDragStart, insideWidget }: Props) {
  return (
    <div className="sbve-panel-body">
      <p className="sbve-widgets-hint" style={{ paddingTop: ".8rem" }}>
        {insideWidget ? (
          <>
            <strong>{insideWidget} selected</strong> — click a block to add it inside the {insideWidget.toLowerCase()}, or
            drag it to an exact spot.{insideWidget === "Popup" || insideWidget === "Toast" ? " (Feedback blocks go after it.)" : ""}
          </>
        ) : (
          "Drag a block onto the page, or click it to insert after the selected element."
        )}
      </p>
      {GROUPS.map((group) => (
        <div key={group.id}>
          <div className="sbve-panel-head" style={{ borderTop: "1px solid #e5e7eb" }}>
            {group.label}
          </div>
          <div className="sbve-widgets">
            {WIDGETS.filter((w) => w.group === group.id).map((w) => (
              <div
                key={w.id}
                className="sbve-widget"
                role="button"
                tabIndex={0}
                title={w.description}
                onPointerDown={(e) => onDragStart(e, w.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onInsert(w.id);
                  }
                }}
              >
                <span className="g" aria-hidden="true">{w.icon}</span>
                <span className="n">{w.name}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
      <div className="sbve-panel-head" style={{ borderTop: "1px solid #e5e7eb" }}>
        Section templates
      </div>
      <div className="sbve-widgets">
        {TEMPLATES.map((t) => (
          <div
            key={t.id}
            className="sbve-widget wide"
            role="button"
            tabIndex={0}
            title={t.description}
            onPointerDown={(e) => onDragStart(e, t.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onInsert(t.id);
              }
            }}
          >
            <span className="g" aria-hidden="true">{t.icon}</span>
            <span className="n">{t.name}</span>
            <span className="d">{t.description}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
