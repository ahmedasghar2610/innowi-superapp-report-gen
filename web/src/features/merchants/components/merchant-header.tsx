"use client";

import { MERCHANT_STATUS_LABEL, MERCHANT_STATUS_TONE } from "@/features/churn/labels";

import { useState } from "react";

import Link from "next/link";
import { ArrowLeft, Utensils, Calendar, Pencil, Lightbulb, UserRound, Package, Trash2 } from "lucide-react";
import { Badge, Button } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { MerchantHealthBadge } from "./merchant-health-badge";
import { PackageBadge } from "./package-badge";
import { SourceBadge } from "@/features/sources/source-badge";
import { SubscriptionDrawer } from "./subscription/subscription-drawer";
import { DeleteMerchantDialog } from "./delete-merchant-dialog";
import { useMia } from "@/features/mia/mia-context";
import { useCan } from "@/features/auth/use-can";
import type { Merchant } from "@/features/merchants/types";

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

/** Workspace header: identity, health, key meta and primary actions. */
export function MerchantHeader({ merchant }: { merchant: Merchant }) {
  const { openMia } = useMia();
  const [subscriptionOpen, setSubscriptionOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const can = useCan();

  return (
    <div>
      <Link
        href="/merchants"
        className="mb-3 inline-flex items-center gap-1 text-xs font-medium leading-4 text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to merchants
      </Link>

      <div className="flex flex-wrap items-start gap-4">
        <div
          className="grid size-12 shrink-0 place-items-center rounded-lg bg-primary text-base font-semibold text-primary-foreground"
          aria-hidden
        >
          {initials(merchant.restaurantName)}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-semibold tracking-[-0.011em] text-foreground">{merchant.restaurantName}</h1>
            {merchant.merchantCode && (
              <span
                className="rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground"
                title="Workbook Merchant ID"
              >
                {merchant.merchantCode}
              </span>
            )}
            {merchant.status && merchant.status !== "ACTIVE" && (
              <Badge tone={MERCHANT_STATUS_TONE[merchant.status]} icon={false}>
                {MERCHANT_STATUS_LABEL[merchant.status]}
              </Badge>
            )}
            <MerchantHealthBadge value={merchant.accountHealth} />
            <PackageBadge subscription={merchant.subscription} />
            <SourceBadge source={merchant.source} detail={merchant.sourceDetail} />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-4 text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Utensils className="size-4" aria-hidden />
              {merchant.cuisineCategory ?? "—"}
            </span>
            <span aria-hidden>·</span>
            <span className="inline-flex items-center gap-1" title="Account manager">
              <UserRound className="size-4" aria-hidden />
              {merchant.accountManager?.name ?? "Unassigned"}
            </span>
            <span aria-hidden>·</span>
            <span className="inline-flex items-center gap-1">
              <Calendar className="size-4" aria-hidden />
              Onboarded {formatDate(merchant.onboardingDate)}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => openMia(merchant.restaurantName)}>
            <Lightbulb className="size-4 text-primary" />
            Ask MIA
          </Button>
          {can("subscription.write") && (
            <Button variant="outline" size="sm" onClick={() => setSubscriptionOpen(true)}>
              <Package className="size-4" />
              {merchant.subscription ? "Manage subscription" : "Add subscription"}
            </Button>
          )}
          <Link href={`/merchants/${merchant.id}/edit`} scroll={false}>
            <Button variant="default" size="sm">
              <Pencil className="size-4" />
              Edit Profile
            </Button>
          </Link>
          {can("merchant.delete") && (
            <Button variant="outline" size="sm" onClick={() => setDeleteOpen(true)} aria-label={`Delete ${merchant.restaurantName}`}>
              <Trash2 className="size-4 text-text-destructive" />
              Delete
            </Button>
          )}
          <SubscriptionDrawer merchant={merchant} open={subscriptionOpen} onClose={() => setSubscriptionOpen(false)} />
          {can("merchant.delete") && <DeleteMerchantDialog merchant={merchant} open={deleteOpen} onClose={() => setDeleteOpen(false)} />}
        </div>
      </div>
    </div>
  );
}
