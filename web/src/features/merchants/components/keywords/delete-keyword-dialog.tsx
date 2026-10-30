"use client";

import { useToast } from "@/components/ui";
import { useDeleteKeyword } from "@/features/merchants/api";
import { isApiError } from "@/lib/api/client";
import type { Keyword } from "@/features/merchants/types";
import { ConfirmDeleteDialog } from "../shared/confirm-delete-dialog";

/** Confirm + delete a keyword. `keyword` non-null opens the dialog. */
export function DeleteKeywordDialog({
  merchantId,
  keyword,
  onClose,
}: {
  merchantId: string;
  keyword: Keyword | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const del = useDeleteKeyword();
  const label = keyword ? keyword.term : "";

  function confirm() {
    if (!keyword) return;
    del.mutate(
      { merchantId, id: keyword.id },
      {
        onSuccess: () => {
          toast({ variant: "success", title: "Keyword deleted", description: label });
          onClose();
        },
        onError: (err) =>
          toast({
            variant: "error",
            title: "Couldn't delete keyword",
            description: isApiError(err) ? err.messages[0] : "Something went wrong. Please try again.",
          }),
      },
    );
  }

  return (
    <ConfirmDeleteDialog
      open={!!keyword}
      onClose={onClose}
      title="Delete keyword"
      description={keyword ? `“${label}” will be permanently removed from this merchant.` : undefined}
      busy={del.isPending}
      onConfirm={confirm}
    >
      This can’t be undone.
    </ConfirmDeleteDialog>
  );
}
