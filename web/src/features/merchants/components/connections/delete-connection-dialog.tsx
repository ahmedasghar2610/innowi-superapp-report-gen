"use client";

import { useToast } from "@/components/ui";
import { useDeleteConnection } from "@/features/merchants/api";
import { isApiError } from "@/lib/api/client";
import type { Connection } from "@/features/merchants/types";
import { ConfirmDeleteDialog } from "../shared/confirm-delete-dialog";

/** Confirm + delete a connection (access item). `connection` non-null opens it. */
export function DeleteConnectionDialog({
  merchantId,
  connection,
  onClose,
}: {
  merchantId: string;
  connection: Connection | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const del = useDeleteConnection();

  function confirm() {
    if (!connection) return;
    del.mutate(
      { merchantId, id: connection.id },
      {
        onSuccess: () => {
          toast({ variant: "success", title: "Connection deleted", description: connection.accessItem });
          onClose();
        },
        onError: (err) =>
          toast({
            variant: "error",
            title: "Couldn't delete connection",
            description: isApiError(err) ? err.messages[0] : "Something went wrong. Please try again.",
          }),
      },
    );
  }

  return (
    <ConfirmDeleteDialog
      open={!!connection}
      onClose={onClose}
      title="Delete access item"
      description={connection ? `“${connection.accessItem}” will be permanently removed from this merchant.` : undefined}
      busy={del.isPending}
      onConfirm={confirm}
    >
      This can’t be undone.
    </ConfirmDeleteDialog>
  );
}
