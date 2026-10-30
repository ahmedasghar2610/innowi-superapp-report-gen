"use client";

import { useToast } from "@/components/ui";
import { useDeleteLocation } from "@/features/merchants/api";
import { isApiError } from "@/lib/api/client";
import type { Location } from "@/features/merchants/types";
import { ConfirmDeleteDialog } from "../shared/confirm-delete-dialog";

function labelOf(l: Location) {
  return l.address || l.city || "this location";
}

/** Confirm + delete a location. `location` non-null opens the dialog. */
export function DeleteLocationDialog({
  merchantId,
  location,
  onClose,
}: {
  merchantId: string;
  location: Location | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const del = useDeleteLocation();

  function confirm() {
    if (!location) return;
    del.mutate(
      { merchantId, id: location.id },
      {
        onSuccess: () => {
          toast({ variant: "success", title: "Location deleted", description: labelOf(location) });
          onClose();
        },
        onError: (err) =>
          toast({
            variant: "error",
            title: "Couldn't delete location",
            description: isApiError(err) ? err.messages[0] : "Something went wrong. Please try again.",
          }),
      },
    );
  }

  return (
    <ConfirmDeleteDialog
      open={!!location}
      onClose={onClose}
      title="Delete location"
      description={location ? `“${labelOf(location)}” will be permanently removed.` : undefined}
      busy={del.isPending}
      onConfirm={confirm}
    >
      Any documents attached to this location are kept (their link is cleared). This can’t be undone.
    </ConfirmDeleteDialog>
  );
}
