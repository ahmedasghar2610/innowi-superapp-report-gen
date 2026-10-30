import { Card, BadgeLink, SectionHead } from "@/components/ui";
import { formatDate, displayUrl, formatUsd } from "@/lib/format";
import { MerchantHealthBadge } from "./merchant-health-badge";
import { PackageBadge, SubscriptionStatusBadge } from "./package-badge";
import type { Merchant, YesNo } from "@/features/merchants/types";
import { yesNo as yesNoLabels } from "@/lib/enums";

function yesNo(v: YesNo | null): string {
  return v === null ? "—" : (yesNoLabels[v] ?? v);
}

/** At-a-glance summary of the merchant, shown across every workspace tab. */
export function MerchantSummary({ merchant }: { merchant: Merchant }) {
  const sub = merchant.subscription;

  const items: { label: string; value: React.ReactNode }[] = [
    { label: "Merchant ID", value: merchant.merchantCode ?? "—" },
    { label: "Account Manager", value: merchant.accountManager?.name ?? "Unassigned" },
    { label: "Account Health", value: <MerchantHealthBadge value={merchant.accountHealth} /> },
    { label: "Package", value: <PackageBadge subscription={sub} /> },
    {
      label: "Subscription Status",
      value: sub ? <SubscriptionStatusBadge status={sub.status} /> : "—",
    },
    { label: "MRR", value: sub ? formatUsd(sub.mrr) : "—" },
    { label: "Renewal Date", value: sub ? formatDate(sub.renewalDate) : "—" },
    { label: "Legal Name", value: merchant.legalName ?? "—" },
    {
      label: "Website",
      value: merchant.websiteUrl ? (
        <BadgeLink
          href={merchant.websiteUrl}
          title={displayUrl(merchant.websiteUrl)}
          aria-label={`Open ${displayUrl(merchant.websiteUrl)}`}
        />
      ) : (
        "—"
      ),
    },
    { label: "POS System", value: merchant.posSystem ?? "—" },
    // Master budgets (PRD Appendix C-6 / ADS-02): surfaced here because the Ads
    // modules read them from this profile and never carry their own.
    { label: "Google Ads Budget", value: formatUsd(merchant.googleAdsBudget) },
    { label: "Meta Ads Budget", value: formatUsd(merchant.metaAdsBudget) },
    { label: "Online Ordering", value: merchant.onlineOrdering ?? "—" },
    { label: "Alcohol License", value: yesNo(merchant.alcoholLicense) },
    { label: "Locations", value: merchant.locationCount !== null ? String(merchant.locationCount) : "—" },
    { label: "Report Frequency", value: merchant.reportFrequency ?? "—" },
    { label: "Onboarded", value: formatDate(merchant.onboardingDate) },
    { label: "Go-Live", value: formatDate(merchant.goLiveDate) },
  ];

  return (
    <section className="mt-6 flex flex-col gap-3" aria-label="Account summary">
      <SectionHead title="Account summary" />
      <Card>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3.5 px-4 py-3.5 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((item) => (
            <div key={item.label} className="flex min-w-0 flex-col gap-1">
              <dt className="text-xs font-medium leading-4 text-muted-foreground">{item.label}</dt>
              <dd className="truncate text-sm font-medium leading-5 text-foreground">{item.value}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </section>
  );
}
