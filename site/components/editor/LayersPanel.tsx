"use client";

// COPIED from innowi-superapp-web/src/features/site-builder/components/editor/LayersPanel.tsx by scripts/sync-editor.cjs.
// Edit it there, then run `npm run sync-editor`.
import { useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { acceptsChildren, labelFor, layerChildren, summarizeText } from "./dom";

type Where = "before" | "after" | "inside";

type Props = {
  root: HTMLElement | null;
  /** Bumped by the editor whenever the DOM changes so the tree re-renders. */
  version: number;
  selected: HTMLElement | null;
  onSelect: (el: HTMLElement) => void;
  onHover: (el: HTMLElement | null) => void;
  onMove: (el: HTMLElement, ref: HTMLElement, where: Where) => void;
};

// Stable keys for live DOM nodes without writing attributes into the page.
const keys = new WeakMap<Element, number>();
let nextKey = 1;
function keyOf(el: Element): number {
  let k = keys.get(el);
  if (!k) {
    k = nextKey++;
    keys.set(el, k);
  }
  return k;
}

let dragged: HTMLElement | null = null;

export default function LayersPanel({ root, version, selected, onSelect, onHover, onMove }: Props) {
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const [collapsed, setCollapsed] = useState<Set<number>>(() => new Set());
  const [drop, setDrop] = useState<{ key: number; where: Where } | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  // Ancestors of the selected element are open unless the user collapsed them.
  const forced = useMemo(() => {
    const set = new Set<number>();
    if (!selected || !root) return set;
    let cursor = selected.parentElement;
    while (cursor && cursor !== root) {
      set.add(keyOf(cursor));
      cursor = cursor.parentElement;
    }
    return set;
  }, [selected, root]);

  useEffect(() => {
    if (!selected) return;
    const timer = window.setTimeout(() => {
      const row = listRef.current?.querySelector<HTMLElement>(`[data-key="${keyOf(selected)}"]`);
      row?.scrollIntoView({ block: "nearest" });
    }, 30);
    return () => window.clearTimeout(timer);
  }, [selected]);

  // `version` is bumped by the editor after DOM mutations so this re-reads the live tree.
  void version;
  const topLevel = root ? layerChildren(root) : [];

  if (!root) return <p className="sbve-empty">Preview has not loaded yet.</p>;
  if (!topLevel.length) return <p className="sbve-empty">This page is empty. Add a widget to get started.</p>;

  function isOpen(k: number): boolean {
    if (collapsed.has(k)) return false;
    return expanded.has(k) || forced.has(k);
  }

  function toggle(k: number) {
    const open = isOpen(k);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (open) next.delete(k);
      else next.add(k);
      return next;
    });
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (open) next.add(k);
      else next.delete(k);
      return next;
    });
  }

  function whereFor(e: React.DragEvent, el: HTMLElement): Where {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = (e.clientY - r.top) / r.height;
    if (y < 0.3) return "before";
    if (y > 0.7) return "after";
    return acceptsChildren(el) ? "inside" : "after";
  }

  function renderRow(el: HTMLElement, depth: number): React.ReactNode {
    const k = keyOf(el);
    const kids = layerChildren(el);
    const open = isOpen(k);
    const isSel = el === selected;
    const dropCls = drop && drop.key === k ? ` drop-${drop.where}` : "";
    const text = summarizeText(el, 40);
    return (
      <div key={k}>
        <div
          className={`sbve-layer${isSel ? " selected" : ""}${dropCls}`}
          data-key={k}
          style={{ paddingLeft: 6 + depth * 14 }}
          draggable
          onClick={() => onSelect(el)}
          onMouseEnter={() => onHover(el)}
          onMouseLeave={() => onHover(null)}
          onDragStart={(e) => {
            dragged = el;
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", labelFor(el));
          }}
          onDragEnd={() => {
            dragged = null;
            setDrop(null);
          }}
          onDragOver={(e) => {
            if (!dragged || dragged === el || dragged.contains(el)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            const where = whereFor(e, el);
            if (!drop || drop.key !== k || drop.where !== where) setDrop({ key: k, where });
          }}
          onDragLeave={() => {
            if (drop && drop.key === k) setDrop(null);
          }}
          onDrop={(e) => {
            e.preventDefault();
            if (!dragged || dragged === el || dragged.contains(el)) return;
            const where = whereFor(e, el);
            onMove(dragged, el, where);
            if (where === "inside") {
              setExpanded((prev) => new Set(prev).add(k));
              setCollapsed((prev) => {
                const next = new Set(prev);
                next.delete(k);
                return next;
              });
            }
            dragged = null;
            setDrop(null);
          }}
          title={`${labelFor(el)}${text ? ` — ${text}` : ""}`}
        >
          <button
            type="button"
            className={`tw${kids.length ? "" : " leaf"}`}
            onClick={(e) => {
              e.stopPropagation();
              toggle(k);
            }}
            aria-label={open ? "Collapse" : "Expand"}
          >
            {open ? "▾" : "▸"}
          </button>
          <span className="lb">{labelFor(el)}</span>
          {text ? <span className="tx">{text}</span> : null}
        </div>
        {open && kids.length ? kids.map((kid) => renderRow(kid, depth + 1)) : null}
      </div>
    );
  }

  return (
    <div className="sbve-layers" ref={listRef}>
      {topLevel.map((el) => renderRow(el, 0))}
    </div>
  );
}
