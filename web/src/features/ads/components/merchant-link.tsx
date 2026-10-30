"use client";

import { useState } from "react";
import Link from "next/link";
import { Building2, Link2, Unlink } from "lucide-react";
import { Button, Dialog, Spinner, useToast } from "@/components/ui";
import { MerchantSelect, type MerchantValue } from "@/features/tickets/components/merchant-select";
import { useLinkMerchant, useMerchantSuggestions } from "../api";

/** Which Super App merchant this Google Ads account belongs to. Linking only
 *  connects the records: the approved budget, "ads paid by", address, phone
 *  and client offers then come from that merchant's Profile. */
export function MerchantLink({
  account,
  canManage,
}: {
  account: { id: string; name: string; isDemo: boolean; merchant: { id: string | null; name: string } | null };
  canManage: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { unlink } = useLinkMerchant();
  const { toast } = useToast();
  const m = account.merchant;

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3 text-sm">
      <Building2 className="size-4 text-muted-foreground" aria-hidden />
      {m ? (
        <>
          <span className="text-muted-foreground">Merchant</span>
          {m.id ? (
            <Link href={`/merchants/${m.id}/ads`} className="font-medium text-foreground hover:underline">
              {m.name}
            </Link>
          ) : (
            <span className="font-medium text-foreground">{m.name} (sample)</span>
          )}
          <span className="text-xs text-muted-foreground">· budget, ads paid by, address and offers come from its Profile</span>
        </>
      ) : (
        <span className="text-muted-foreground">Not linked to a merchant — approved budget, ads paid by and client offers are blank until it is.</span>
      )}
      {canManage && !account.isDemo && (
        <div className="ml-auto flex gap-1.5 print:hidden">
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            <Link2 className="size-4" />
            {m ? "Change" : "Link to merchant"}
          </Button>
          {m && (
            <Button
              size="sm"
              variant="ghost"
              loading={unlink.isPending}
              onClick={() => unlink.mutate(account.id, { onSuccess: () => toast({ variant: "success", title: "Unlinked", description: `${account.name} is no longer linked to ${m.name}.` }) })}
            >
              <Unlink className="size-4" />
              Unlink
            </Button>
          )}
        </div>
      )}
      {open && <LinkDialog accountId={account.id} name={account.name} onClose={() => setOpen(false)} />}
    </div>
  );
}

export function LinkDialog({ accountId, name, onClose }: { accountId: string; name: string; onClose: () => void }) {
  const [picked, setPicked] = useState<MerchantValue | null>(null);
  const suggestions = useMerchantSuggestions(accountId, true);
  const { link } = useLinkMerchant();
  const { toast } = useToast();
  const save = (m: MerchantValue) =>
    link.mutate(
      { id: accountId, merchantId: m.id },
      {
        onSuccess: () => {
          toast({ variant: "success", title: "Linked", description: `${name} now reports for ${m.name}.` });
          onClose();
        },
        onError: (e) => toast({ variant: "error", title: "Couldn't link", description: e.messages?.[0] ?? e.message }),
      },
    );

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={`Link “${name}” to a merchant`}
      description="Suggestions match the Google Ads account name. Linking doesn't change anything in Google Ads or in the merchant's Profile."
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
                    <span className="block text-xs text-muted-foreground">{[s.city, s.reason].filter(Boolean).join(" · ")}</span>
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
