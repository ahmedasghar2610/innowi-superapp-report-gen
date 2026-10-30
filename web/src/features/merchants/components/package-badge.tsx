import { Package } from "lucide-react";
import { Badge } from "@/components/ui";
import { subscriptionStatus as statusLabels } from "@/lib/enums";
import { humanize } from "@/lib/format";
import type { MerchantSubscription } from "@/features/merchants/types";

/**
 * Package identity chip — "$299 · Growth Plus". Used anywhere a merchant's
 * plan needs to be visible at a glance (workspace header, list table).
 * `subscription` is `null` when the merchant has no subscription row yet
 * (Catalog API, `subscription` embedded on Merchant responses) — rendered as
 * a neutral "No package" chip rather than silently showing nothing, so the
 * gap itself is visible instead of looking like the UI is missing data.
 */
export function PackageBadge({
  subscription,
  className,
}: {
  subscription: MerchantSubscription | null;
  className?: string;
}) {
  if (!subscription) {
    return (
      <Badge tone="neutral" className={className} title="No subscription on file" icon={Package}>
        No package
      </Badge>
    );
  }

  const meta = statusLabels[subscription.status];
  const label = `${subscription.package.code} · ${subscription.package.name}`;

  return (
    <Badge
      tone={meta?.tone ?? "neutral"}
      className={className}
      title={`${label} — ${meta?.label ?? humanize(subscription.status)}`}
      icon={Package}
    >
      {label}
    </Badge>
  );
}

/** Just the status half (e.g. table cells that already show the package name). */
export function SubscriptionStatusBadge({ status }: { status: MerchantSubscription["status"] }) {
  const meta = statusLabels[status];
  return (
    <Badge tone={meta?.tone ?? "neutral"}>
      {meta?.label ?? humanize(status)}
    </Badge>
  );
}
