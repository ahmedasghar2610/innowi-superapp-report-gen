"use client";

import { Trash2 } from "lucide-react";
import { Button, Dialog } from "@/components/ui";

/**
 * A `Dialog` preset for a destructive confirm (danger tone, trash icon, Cancel +
 * a red confirm button). The entity delete dialogs own their delete mutation and
 * toast, and render this for the UI — removing the identical dialog/footer markup
 * each one repeated. `open` is driven by "is a row queued for deletion".
 */
export function ConfirmDeleteDialog({
  open,
  onClose,
  title,
  description,
  confirmLabel = "Delete",
  busy,
  onConfirm,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  busy: boolean;
  onConfirm: () => void;
  children?: React.ReactNode;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      tone="danger"
      icon={<Trash2 />}
      title={title}
      description={description}
      dismissible={!busy}
      hideClose={busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy} type="button">
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  );
}
