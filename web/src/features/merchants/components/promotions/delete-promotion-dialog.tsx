"use client";

import { useToast } from "@/components/ui";
import { useDeletePromotion } from "@/features/merchants/api";
import { isApiError } from "@/lib/api/client";
import type { Promotion } from "@/features/merchants/types";
import { ConfirmDeleteDialog } from "../shared/confirm-delete-dialog";

/** Confirm + delete a promotion. `promotion` non-null opens it. */
export function DeletePromotionDialog({
  merchantId,
  promotion,
  onClose,
}: {
  merchantId: string;
  promotion: Promotion | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const del = useDeletePromotion();

  const label = promotion?.promoName || "This promotion";

  function confirm() {
    if (!promotion) return;
    del.mutate(
      { merchantId, id: promotion.id },
      {
        onSuccess: () => {
          toast({ variant: "success", title: "Promotion deleted", description: label });
          onClose();
        },
        onError: (err) =>
          toast({
            variant: "error",
            title: "Couldn't delete promotion",
            description: isApiError(err) ? err.messages[0] : "Something went wrong. Please try again.",
          }),
      },
    );
  }

  return (
    <ConfirmDeleteDialog
      open={!!promotion}
      onClose={onClose}
      title="Delete promotion"
      description={promotion ? `“${label}” will be removed from this merchant.` : undefined}
      busy={del.isPending}
      onConfirm={confirm}
    >
      This can’t be undone.
    </ConfirmDeleteDialog>
  );
}
