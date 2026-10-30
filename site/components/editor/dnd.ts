// COPIED from innowi-superapp-web/src/features/site-builder/components/editor/dnd.ts by scripts/sync-editor.cjs.
// Edit it there, then run `npm run sync-editor`.
import { DROP_INDICATOR_ID } from "./constants";
import { acceptsChildren, feedbackContentBox, layerChildren, pickTarget } from "./dom";
import type { DropTarget } from "./types";

function isHorizontalFlow(parent: HTMLElement | null, child: HTMLElement): boolean {
  if (!parent) return false;
  const win = parent.ownerDocument.defaultView;
  if (!win) return false;
  const ps = win.getComputedStyle(parent);
  if (ps.display.includes("grid")) return true;
  if (ps.display.includes("flex") && !ps.flexDirection.startsWith("column")) return true;
  const cs = win.getComputedStyle(child);
  if (cs.float !== "none") return true;
  if (cs.display === "inline-block" || cs.display === "inline-flex") return true;
  return false;
}

function isInline(el: HTMLElement): boolean {
  const win = el.ownerDocument.defaultView;
  if (!win) return false;
  return win.getComputedStyle(el).display === "inline";
}

/**
 * Where would a block dropped at (x, y) land? `excluded` is the element being
 * moved (never drop into itself). Coordinates are iframe client coordinates.
 */
export function computeDropTarget(
  doc: Document,
  root: HTMLElement,
  x: number,
  y: number,
  excluded: HTMLElement | null,
): DropTarget | null {
  const hit = doc.elementFromPoint(x, y);
  let candidate = pickTarget(hit, root);

  // Over the root / body itself: append relative to the first or last child.
  if (!candidate) {
    const kids = layerChildren(root);
    if (!kids.length) return { ref: root, where: "inside" };
    const last = kids[kids.length - 1];
    const first = kids[0];
    return y > last.getBoundingClientRect().bottom
      ? { ref: last, where: "after" }
      : y < first.getBoundingClientRect().top
        ? { ref: first, where: "before" }
        : null;
  }

  if (excluded && (candidate === excluded || excluded.contains(candidate))) return null;

  // Over a Popup/Toast's empty area (which selects the widget itself), drop
  // into its content — the popup card / toast text — not beside its parts.
  const box = feedbackContentBox(candidate);
  if (box) candidate = box;

  // Climb out of inline text and out of parents that cannot hold blocks.
  while (
    candidate.parentElement &&
    candidate.parentElement !== root &&
    (isInline(candidate) || !acceptsChildren(candidate.parentElement))
  ) {
    candidate = candidate.parentElement;
  }
  if (excluded && (candidate === excluded || excluded.contains(candidate))) return null;

  // Hovering a container's own padding: snap to the nearest child instead.
  if (acceptsChildren(candidate)) {
    const kids = layerChildren(candidate).filter((k) => k !== excluded && !(excluded && excluded.contains(k)));
    if (kids.length === 0) {
      return { ref: candidate, where: "inside" };
    }
    const horizontal = isHorizontalFlow(candidate, kids[0]);
    let best: HTMLElement | null = null;
    let bestDist = Infinity;
    for (const kid of kids) {
      const r = kid.getBoundingClientRect();
      const d = horizontal
        ? x < r.left
          ? r.left - x
          : x > r.right
            ? x - r.right
            : 0
        : y < r.top
          ? r.top - y
          : y > r.bottom
            ? y - r.bottom
            : 0;
      if (d < bestDist) {
        bestDist = d;
        best = kid;
      }
    }
    if (best) {
      const r = best.getBoundingClientRect();
      const before = horizontal ? x < r.left + r.width / 2 : y < r.top + r.height / 2;
      return { ref: best, where: before ? "before" : "after" };
    }
  }

  const rect = candidate.getBoundingClientRect();
  const horizontal = isHorizontalFlow(candidate.parentElement, candidate);
  const before = horizontal ? x < rect.left + rect.width / 2 : y < rect.top + rect.height / 2;
  return { ref: candidate, where: before ? "before" : "after" };
}

export function showIndicator(doc: Document, target: DropTarget | null): void {
  let bar = doc.getElementById(DROP_INDICATOR_ID);
  if (!target) {
    if (bar) bar.style.display = "none";
    return;
  }
  if (!bar) {
    bar = doc.createElement("div");
    bar.id = DROP_INDICATOR_ID;
    doc.body.appendChild(bar);
  }
  const win = doc.defaultView;
  const sx = win?.scrollX ?? 0;
  const sy = win?.scrollY ?? 0;
  const r = target.ref.getBoundingClientRect();
  bar.style.display = "block";
  bar.classList.toggle("inside", target.where === "inside");
  if (target.where === "inside") {
    bar.style.left = `${r.left + sx}px`;
    bar.style.top = `${r.top + sy}px`;
    bar.style.width = `${Math.max(r.width, 24)}px`;
    bar.style.height = `${Math.max(r.height, 24)}px`;
    return;
  }
  const horizontal = isHorizontalFlow(target.ref.parentElement, target.ref);
  if (horizontal) {
    const x = target.where === "before" ? r.left - 3 : r.right - 1;
    bar.style.left = `${x + sx}px`;
    bar.style.top = `${r.top + sy}px`;
    bar.style.width = "4px";
    bar.style.height = `${r.height}px`;
  } else {
    const y = target.where === "before" ? r.top - 3 : r.bottom - 1;
    bar.style.left = `${r.left + sx}px`;
    bar.style.top = `${y + sy}px`;
    bar.style.width = `${r.width}px`;
    bar.style.height = "4px";
  }
}

export function hideIndicator(doc: Document | null): void {
  if (!doc) return;
  const bar = doc.getElementById(DROP_INDICATOR_ID);
  if (bar) bar.remove();
}
