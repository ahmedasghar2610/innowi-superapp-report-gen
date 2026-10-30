"use client";

import { Info } from "lucide-react";
import { Badge, Card, Skeleton } from "@/components/ui";
import { useOffers } from "../api";
import { fmtDay } from "../lib";

/** Client offers (Profiling → Promotions) next to the Google Ads promotion
 *  assets. Shown side by side for manual review — a difference is not
 *  automatically an error. */
export function OffersTab({ accountId }: { accountId: string }) {
  const { data, isPending } = useOffers(accountId);
  if (isPending || !data) return <Skeleton className="h-48 w-full" />;
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="flex flex-col gap-3 p-4">
          <div>
            <div className="text-sm font-semibold text-foreground">Client offer</div>
            <div className="text-xs text-muted-foreground">Source: Client Profiling → Promotions</div>
          </div>
          {!data.merchantLinked ? (
            <p className="text-sm text-muted-foreground">Link this account to a merchant to see the offers agreed with the client.</p>
          ) : !data.client.length ? (
            <p className="text-sm text-muted-foreground">No promotions on the merchant&apos;s Profile.</p>
          ) : (
            data.client.map((o) => (
              <div key={o.id} className="rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-foreground">{o.name ?? [o.offerValue, o.offerType].filter(Boolean).join(" ") ?? "Offer"}</span>
                  {o.status && <Badge tone={o.status === "ACTIVE" ? "success" : "neutral"} icon={false}>{o.status.toLowerCase().replace(/_/g, " ")}</Badge>}
                  {o.code && <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{o.code}</code>}
                </div>
                {(o.offerType || o.offerValue) && <div className="mt-1 text-sm text-muted-foreground">{[o.offerType, o.offerValue].filter(Boolean).join(" · ")}</div>}
                {o.notes && <div className="mt-1 text-sm text-muted-foreground">{o.notes}</div>}
                <div className="mt-1 text-xs text-muted-foreground">
                  {o.startDate ? fmtDay(o.startDate) : "—"} – {o.endDate ? fmtDay(o.endDate) : "Ongoing"}
                  {o.channels && <> · {o.channels}</>}
                </div>
              </div>
            ))
          )}
        </Card>
        <Card className="flex flex-col gap-3 p-4">
          <div>
            <div className="text-sm font-semibold text-foreground">Google Ads promotion</div>
            <div className="text-xs text-muted-foreground">Source: Google Ads promotion assets</div>
          </div>
          {!data.google.length ? (
            <p className="text-sm text-muted-foreground">No promotion assets in Google Ads.</p>
          ) : (
            data.google.map((p) => (
              <div key={p.id} className="rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-foreground">{p.text ?? p.details.target}</span>
                  <Badge tone={p.status === "ENABLED" ? "success" : "neutral"} icon={false}>{p.status.toLowerCase()}</Badge>
                  {p.details.code && <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{p.details.code}</code>}
                </div>
                <div className="mt-1 text-sm text-muted-foreground">{p.campaignName ?? "Whole account"}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {p.details.startDate ? fmtDay(p.details.startDate) : "—"} – {p.details.endDate ? fmtDay(p.details.endDate) : "Ongoing"}
                </div>
              </div>
            ))
          )}
        </Card>
      </div>
      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        These two sources are shown side by side for manual review. A difference between them is not automatically an error — the team decides whether the Google Ads
        promotion still reflects what the client agreed.
      </p>
    </div>
  );
}
