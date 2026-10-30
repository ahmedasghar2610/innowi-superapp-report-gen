"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button, Dialog, Field, Input, useToast } from "@/components/ui";
import { useDeleteMerchant } from "@/features/merchants/api";
import type { Merchant } from "@/features/merchants/types";

/**
 * Permanently delete a merchant and everything on its profile (contacts,
 * locations, keywords, menu, documents, subscription). Super Admin and Admin
 * only (capability merchant.delete); the delete is in the audit log. The
 * restaurant name has to be typed to confirm.
 */
export function DeleteMerchantDialog({ merchant, open, onClose }: { merchant: Merchant; open: boolean; onClose: () => void }) {
  const router = useRouter();
  const { toast } = useToast();
  const del = useDeleteMerchant();
  const [typed, setTyped] = useState("");
  const ok = typed.trim().toLowerCase() === merchant.restaurantName.trim().toLowerCase();
  const close = () => {
    setTyped("");
    onClose();
  };
  const submit = () =>
    del.mutate(merchant.id, {
      onSuccess: () => {
        toast({ variant: "success", title: `${merchant.restaurantName} deleted` });
        close();
        router.push("/merchants");
      },
      onError: (e) => toast({ variant: "error", title: "Couldn't delete the merchant", description: e.messages?.[0] ?? e.message }),
    });
  return (
    <Dialog
      open={open}
      onClose={close}
      tone="danger"
      icon={<Trash2 className="size-5" />}
      title={`Delete ${merchant.restaurantName}?`}
      description="This permanently deletes the merchant and everything on its profile: contacts, locations, keywords, competitors, menu, documents, subscription and history. It can't be undone."
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={close}>
            Cancel
          </Button>
          <Button variant="destructive" size="sm" onClick={submit} disabled={!ok || del.isPending} loading={del.isPending}>
            Delete merchant
          </Button>
        </>
      }
    >
      <Field label={`Type the restaurant name to confirm`} htmlFor="confirm-delete">
        <Input id="confirm-delete" data-autofocus value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={merchant.restaurantName} autoComplete="off" />
      </Field>
    </Dialog>
  );
}
