"use client";

import { useToast } from "@/components/ui";
import { useDeleteContact } from "@/features/merchants/api";
import { isApiError } from "@/lib/api/client";
import { humanize } from "@/lib/format";
import type { Contact } from "@/features/merchants/types";
import { ConfirmDeleteDialog } from "../shared/confirm-delete-dialog";

/** Confirm + delete a contact. `contact` non-null opens the dialog. */
export function DeleteContactDialog({
  merchantId,
  contact,
  onClose,
}: {
  merchantId: string;
  contact: Contact | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const del = useDeleteContact();
  const label = contact ? (contact.name ?? humanize(contact.role)) : "";

  function confirm() {
    if (!contact) return;
    del.mutate(
      { merchantId, id: contact.id },
      {
        onSuccess: () => {
          toast({ variant: "success", title: "Contact deleted", description: label });
          onClose();
        },
        onError: (err) =>
          toast({
            variant: "error",
            title: "Couldn't delete contact",
            description: isApiError(err) ? err.messages[0] : "Something went wrong. Please try again.",
          }),
      },
    );
  }

  return (
    <ConfirmDeleteDialog
      open={!!contact}
      onClose={onClose}
      title="Delete contact"
      description={contact ? `“${label}” will be permanently removed from this merchant.` : undefined}
      busy={del.isPending}
      onConfirm={confirm}
    >
      This can’t be undone.
    </ConfirmDeleteDialog>
  );
}
