"use client";

import { useState } from "react";
import Link from "next/link";
import { UserMinus } from "lucide-react";
import { Badge, Button, Card, Dialog, Field, Input, SectionHead, Textarea, useToast } from "@/components/ui";
import { useCan } from "@/features/auth/use-can";
import { WINBACK_LABEL, WINBACK_TONE, formatDay, money } from "../labels";
import { useChurnDetail, useMarkChurned } from "../queries";
import type { MerchantStatus } from "../types";

/**
 * On a merchant's Overview: the churn record when the account has left
 * (why, when, win-back state → opens the Churned accounts drawer), or a
 * "Mark as churned" action for an account that is leaving now.
 */
export function MerchantChurnCard({ merchantId, status }: { merchantId: string; status: MerchantStatus }) {
  const can = useCan();
  const churned = status === "CHURNED";
  const { data, isPending } = useChurnDetail(merchantId, { enabled: can("churn.view") });
  const [open, setOpen] = useState(false);
  if (!can("churn.view")) return null;
  if (!churned && !data) {
    if (!can("churn.manage")) return null;
    return (
      <section className="flex flex-col gap-3" data-testid="merchant-churn-card">
        <SectionHead title="Account status" description="Active. If the restaurant is leaving Innowi, record it here so it joins the win-back list." />
        <div>
          <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
            <UserMinus className="size-4" /> Mark as churned
          </Button>
        </div>
        <MarkChurnedDialog merchantId={merchantId} open={open} onClose={() => setOpen(false)} />
      </section>
    );
  }
  return (
    <section className="flex flex-col gap-3" data-testid="merchant-churn-card">
      <SectionHead title="Churn" description={churned ? "This account has left Innowi." : "This account churned once and was won back."} />
      <Card>
        {isPending || !data ? (
          <p className="text-table text-muted-foreground">Loading…</p>
        ) : (
          <div className="flex flex-col gap-2 text-table">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="danger" icon={false}>
                Churned {data.churnedOn ? formatDay(data.churnedOn) : ""}
              </Badge>
              <Badge tone={WINBACK_TONE[data.winbackStatus]} icon={false}>
                Win-back: {WINBACK_LABEL[data.winbackStatus]}
              </Badge>
              {data.winbackOwner ? <span className="text-xs text-muted-foreground">Owner: {data.winbackOwner.name}</span> : null}
            </div>
            {data.categories.length ? <p className="text-foreground">{data.categories.join(" · ")}</p> : null}
            {data.reason ? <p className="whitespace-pre-wrap text-muted-foreground">{data.reason}</p> : null}
            <p className="text-xs text-muted-foreground">
              {[data.csmName && `CSM ${data.csmName}`, data.mrrAtChurn && `MRR at churn ${money(data.mrrAtChurn)}`, data.gpvAtChurn && `GPV ${money(data.gpvAtChurn, { compact: true })}`]
                .filter(Boolean)
                .join(" · ")}
            </p>
            <div>
              <Link href={`/churn?merchant=${merchantId}`} className="text-xs font-medium text-foreground underline underline-offset-4">
                Work the win-back
              </Link>
            </div>
          </div>
        )}
      </Card>
    </section>
  );
}

function MarkChurnedDialog({ merchantId, open, onClose }: { merchantId: string; open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const mark = useMarkChurned();
  const [churnedOn, setChurnedOn] = useState(new Date().toISOString().slice(0, 10));
  const [category, setCategory] = useState("");
  const [reason, setReason] = useState("");
  const [mrr, setMrr] = useState("");
  const submit = () =>
    mark.mutate(
      {
        merchantId,
        input: {
          churnedOn: churnedOn || undefined,
          category: category.trim() || undefined,
          reason: reason.trim() || undefined,
          mrrAtChurn: mrr.trim() || undefined,
        },
      },
      {
        onSuccess: () => {
          toast({ variant: "success", title: "Marked as churned", description: "It's on the Churned accounts list now." });
          onClose();
        },
        onError: (err) => toast({ variant: "error", title: "Couldn't mark as churned", description: err.messages.join(" · ") }),
      },
    );
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Mark as churned"
      description="Sets the account's status to Churned and starts its win-back record."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="default" size="sm" onClick={submit} loading={mark.isPending}>
            Mark as churned
          </Button>
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Churn date">
          <Input type="date" value={churnedOn} onChange={(e) => setChurnedOn(e.target.value)} aria-label="Churn date" />
        </Field>
        <Field label="MRR at churn">
          <Input value={mrr} onChange={(e) => setMrr(e.target.value)} inputMode="decimal" placeholder="0.00" aria-label="MRR at churn" />
        </Field>
        <Field label="Category" hint="e.g. Price; Product Features" className="sm:col-span-2">
          <Input value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Churn category" />
        </Field>
        <Field label="Reason" className="sm:col-span-2">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} aria-label="Churn reason" />
        </Field>
      </div>
    </Dialog>
  );
}
