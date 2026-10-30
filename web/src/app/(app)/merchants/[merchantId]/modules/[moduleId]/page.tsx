import Link from "next/link";
import { redirect } from "next/navigation";
import { Mail, Gift, Globe, type LucideIcon } from "lucide-react";
import { ComingSoon } from "@/components/ui";
import { MERCHANT_MODULE_TABS } from "@/features/merchants/data/merchant-modules";

const SUBLABEL: Record<string, string> = {
  customers: "Customer lists, segments and repeat-visit insights for this merchant.",
  marketing: "Email & SMS campaigns for this merchant.",
  rewards: "Loyalty and rewards program management for this merchant.",
  website: "Website, local SEO and Google Business Profile management for this merchant.",
  payments: "Payments, invoicing and billing for this merchant.",
  performance: "Performance reporting and trends for this merchant.",
};

const SUBICON: Record<string, LucideIcon> = {
  marketing: Mail,
  rewards: Gift,
  website: Globe,
};

/**
 * /merchants/[merchantId]/modules/[moduleId] — placeholder landing for every
 * merchant-scoped module that isn't built yet (Customers, Marketing, Rewards,
 * Website & SEO, Payments, Performance). Overview and Profiling have real
 * screens and never land here.
 */
export default async function MerchantModulePage({
  params,
}: {
  params: Promise<{ merchantId: string; moduleId: string }>;
}) {
  const { merchantId, moduleId } = await params;
  const mod = MERCHANT_MODULE_TABS.find((m) => m.id === moduleId);
  if (mod?.built && mod.path) redirect(`/merchants/${merchantId}/${mod.path}`);
  const label = mod?.label ?? "This section";

  return (
    <div>
      <ComingSoon
        title={`${label} — currently being worked on`}
        description={SUBLABEL[moduleId] ?? "This section is currently being worked on. Check back soon."}
        icon={SUBICON[moduleId]}
      />
      <p className="mt-4 text-center text-table text-muted-foreground">
        In the meantime, see{" "}
        <Link href={`/merchants/${merchantId}/overview`} scroll={false} className="text-accent hover:underline">
          this merchant&apos;s Overview
        </Link>
        .
      </p>
    </div>
  );
}
