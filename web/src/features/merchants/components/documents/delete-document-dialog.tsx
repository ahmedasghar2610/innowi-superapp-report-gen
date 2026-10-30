"use client";

import { useToast } from "@/components/ui";
import { useDeleteDocument } from "@/features/merchants/api";
import { isApiError } from "@/lib/api/client";
import type { Document } from "@/features/merchants/types";
import { ConfirmDeleteDialog } from "../shared/confirm-delete-dialog";

/** Confirm + delete a document's metadata row. `document` non-null opens it. */
export function DeleteDocumentDialog({
  merchantId,
  document,
  onClose,
}: {
  merchantId: string;
  document: Document | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const del = useDeleteDocument();

  function confirm() {
    if (!document) return;
    del.mutate(
      { merchantId, id: document.id },
      {
        onSuccess: () => {
          toast({ variant: "success", title: "Document deleted", description: document.fileName });
          onClose();
        },
        onError: (err) =>
          toast({
            variant: "error",
            title: "Couldn't delete document",
            description: isApiError(err) ? err.messages[0] : "Something went wrong. Please try again.",
          }),
      },
    );
  }

  return (
    <ConfirmDeleteDialog
      open={!!document}
      onClose={onClose}
      title="Delete document"
      description={document ? `“${document.fileName}” will be removed from this merchant.` : undefined}
      busy={del.isPending}
      onConfirm={confirm}
    >
      This removes the metadata record only — the file in external storage is untouched. This can’t be undone.
    </ConfirmDeleteDialog>
  );
}
