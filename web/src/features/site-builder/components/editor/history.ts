import { MAX_HISTORY } from "./constants";
import type { Snapshot } from "./types";

/** Undo / redo stacks of full page snapshots (html + css). */
export class History {
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Record the state *before* a change. Ignores consecutive duplicates. */
  push(current: Snapshot): void {
    const last = this.undoStack[this.undoStack.length - 1];
    if (last && last.html === current.html && last.css === current.css) return;
    this.undoStack.push(current);
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack = [];
  }

  undo(current: Snapshot): Snapshot | null {
    const prev = this.undoStack.pop();
    if (!prev) return null;
    this.redoStack.push(current);
    return prev;
  }

  redo(current: Snapshot): Snapshot | null {
    const next = this.redoStack.pop();
    if (!next) return null;
    this.undoStack.push(current);
    return next;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}
