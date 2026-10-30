"use client";

import { useState } from "react";
import Link from "next/link";
import { Building2, Link2, Unlink } from "lucide-react";
import { Button, Dialog, Spinner, useToast } from "@/components/ui";
import { MerchantSelect, type MerchantValue } from "@/features/tickets/components/merchant-select";
import { useLinkMerchant, useMerchantSuggestions } from "../api";

/** Which Super App merchant this Google listing belongs to. Linking only
 *  connects the records — nothing is copied between the profile and Google. */
export function MerchantLink({
  locationId,
  merchant,
  canManage,
}: {
  locationId: string;
  merchant: { id: string; name: string } | null;
  canManage: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { unlink } = useLinkMerchant(locationId);
  const { toast } = useToast();

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3 text-sm">
      <Building2 className="size-4 text-muted-foreground" aria-hidden />
      {merchant ? (
        <>
          <span className="text-muted-foreground">Merchant</span>
          <Link href={`/merchants/${merchant.id}/gbp`} className="font-medium text-foreground hover:underline">
            {merchant.name}
          </Link>
        </>
      ) : (
        <span className="text-muted-foreground">Not linked to a merchant yet</span>
      )}
      {canManage && (
        <div className="ml-auto flex gap-1.5 print:hidden">
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            <Link2 className="size-4" />
            {merchant ? "Change" : "Link to merchant"}
          </Button>
          {merchant && (
            <Button
              size="sm"
              variant="ghost"
              loading={unlink.isPending}
              onClick={() =>
                unlink.mutate(undefined, {
                  onSuccess: () => toast({ variant: "success", title: "Unlinked", description: `${merchant.name} no longer shows this listing.` }),
                })
              }
            >
              <Unlink className="size-4" />
              Unlink
            </Button>
          )}
        </div>
      )}
      {open && <LinkDialog locationId={locationId} onClose={() => setOpen(false)} />}
    </div>
  );
}

function LinkDialog({ locationId, onClose }: { locationId: string; onClose: () => void }) {
  const [picked, setPicked] = useState<MerchantValue | null>(null);
  const suggestions = useMerchantSuggestions(locationId, true);
  const { link } = useLinkMerchant(locationId);
  const { toast } = useToast();
  const save = (m: MerchantValue) =>
    link.mutate(m.id, {
      onSuccess: () => {
        toast({ variant: "success", title: "Linked", description: `This listing now shows on ${m.name}'s GBP tab.` });
        onClose();
      },
      onError: (e) => toast({ variant: "error", title: "Couldn't link", description: e.messages?.[0] ?? e.message }),
    });

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title="Link to a merchant"
      description="Suggestions match the listing's name, phone, website and city. Linking doesn't change anything on Google or in the merchant's profile."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!picked} loading={link.isPending} onClick={() => picked && save(picked)}>
            Link
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="text-xs font-medium text-muted-foreground">Suggested</div>
        {suggestions.isPending ? (
          <Spinner />
        ) : suggestions.data?.length ? (
          <ul className="flex flex-col gap-1.5">
            {suggestions.data.map((s) => (
              <li key={s.merchantId}>
                <button
                  type="button"
                  onClick={() => setPicked({ id: s.merchantId, name: s.name })}
                  className={
                    "flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm " +
                    (picked?.id === s.merchantId ? "border-primary bg-accent" : "border-border hover:bg-secondary")
                  }
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-foreground">{s.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {[s.city, s.reasons.join(", ")].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No close matches — search below.</p>
        )}
        <div className="text-xs font-medium text-muted-foreground">Or search all merchants</div>
        <MerchantSelect value={picked} onChange={setPicked} placeholder="Search merchants…" />
      </div>
    </Dialog>
  );
}
