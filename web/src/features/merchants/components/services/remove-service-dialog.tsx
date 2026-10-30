"use client";

import { PlugZap } from "lucide-react";
import { Button, Dialog, useToast } from "@/components/ui";
import { useDeactivateService, useUpdateService } from "@/features/merchants/api";
import { isApiError } from "@/lib/api/client";
import type { MerchantService } from "@/features/merchants/types";

/**
 * Remove a service. The API keeps history if you set the link INACTIVE rather
 * than deleting it, so this offers both: "Set inactive" (PATCH status, the
 * recommended path) and "Delete permanently" (DELETE the link row). `service`
 * non-null opens the dialog.
 */
export function RemoveServiceDialog({
  merchantId,
  service,
  onClose,
}: {
  merchantId: string;
  service: MerchantService | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const update = useUpdateService();
  const del = useDeactivateService();
  const busy = update.isPending || del.isPending;

  function fail(err: unknown, title: string) {
    toast({
      variant: "error",
      title,
      description: isApiError(err) ? err.messages[0] : "Something went wrong. Please try again.",
    });
  }

  function setInactive() {
    if (!service) return;
    update.mutate(
      { merchantId, id: service.id, input: { status: "INACTIVE" } },
      {
        onSuccess: (s) => {
          toast({ variant: "success", title: "Service set inactive", description: s.serviceName });
          onClose();
        },
        onError: (err) => fail(err, "Couldn't update service"),
      },
    );
  }

  function deletePermanently() {
    if (!service) return;
    del.mutate(
      { merchantId, id: service.id },
      {
        onSuccess: () => {
          toast({ variant: "success", title: "Service removed", description: service.serviceName });
          onClose();
        },
        onError: (err) => fail(err, "Couldn't remove service"),
      },
    );
  }

  const isInactive = service?.status === "INACTIVE";

  return (
    <Dialog
      open={!!service}
      onClose={onClose}
      tone="warning"
      icon={<PlugZap />}
      title="Remove service"
      description={service ? `How do you want to remove “${service.serviceName}”?` : undefined}
      dismissible={!busy}
      hideClose={busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy} type="button">
            Cancel
          </Button>
          {!isInactive && (
            <Button variant="outline" onClick={setInactive} loading={update.isPending} disabled={del.isPending}>
              Set inactive
            </Button>
          )}
          <Button variant="destructive" onClick={deletePermanently} loading={del.isPending} disabled={update.isPending}>
            Delete permanently
          </Button>
        </>
      }
    >
      <span className="text-muted-foreground">
        <strong className="font-medium text-foreground">Set inactive</strong> keeps the row and its history (recommended).{" "}
        <strong className="font-medium text-foreground">Delete permanently</strong> removes the link entirely and can’t be undone.
      </span>
    </Dialog>
  );
}
