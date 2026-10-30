"use client";

import { useToast } from "@/components/ui";
import { useDeleteCompetitor } from "@/features/merchants/api";
import { isApiError } from "@/lib/api/client";
import type { Competitor } from "@/features/merchants/types";
import { ConfirmDeleteDialog } from "../shared/confirm-delete-dialog";

/** Confirm + delete a competitor. `competitor` non-null opens the dialog. */
export function DeleteCompetitorDialog({
  merchantId,
  competitor,
  onClose,
}: {
  merchantId: string;
  competitor: Competitor | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const del = useDeleteCompetitor();
  const label = competitor ? competitor.name : "";

  function confirm() {
    if (!competitor) return;
    del.mutate(
      { merchantId, id: competitor.id },
      {
        onSuccess: () => {
          toast({ variant: "success", title: "Competitor deleted", description: label });
          onClose();
        },
        onError: (err) =>
          toast({
            variant: "error",
            title: "Couldn't delete competitor",
            description: isApiError(err) ? err.messages[0] : "Something went wrong. Please try again.",
          }),
      },
    );
  }

  return (
    <ConfirmDeleteDialog
      open={!!competitor}
      onClose={onClose}
      title="Delete competitor"
      description={competitor ? `“${label}” will be permanently removed from this merchant.` : undefined}
      busy={del.isPending}
      onConfirm={confirm}
    >
      This can’t be undone.
    </ConfirmDeleteDialog>
  );
}
