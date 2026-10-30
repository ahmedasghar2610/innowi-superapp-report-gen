"use client";

import { useState } from "react";

/**
 * The open/close state every child-resource panel needs: a create/edit form
 * drawer (with the row being edited, if any) and a delete confirmation (the row
 * being deleted). Replaces the repeated `useState` triplet + handlers that each
 * panel had.
 *
 * `editing` is `T | undefined` (undefined = create mode, matching the form
 * drawers' optional prop); `deleting` is `T | null` (matching the dialogs).
 */
export function useCrudManager<T>() {
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<T | undefined>(undefined);
  const [deleting, setDeleting] = useState<T | null>(null);

  return {
    /** Form drawer */
    formOpen,
    editing,
    openCreate() {
      setEditing(undefined);
      setFormOpen(true);
    },
    openEdit(item: T) {
      setEditing(item);
      setFormOpen(true);
    },
    closeForm() {
      setFormOpen(false);
    },

    /** Delete confirmation */
    deleting,
    requestDelete(item: T) {
      setDeleting(item);
    },
    cancelDelete() {
      setDeleting(null);
    },
  };
}
