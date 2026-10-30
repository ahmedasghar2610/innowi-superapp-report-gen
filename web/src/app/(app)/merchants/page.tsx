import { Suspense } from "react";
import type { Metadata } from "next";
import { MerchantList } from "@/features/merchants/components/merchant-list";

export const metadata: Metadata = {
  title: "Merchants — Innowi",
};

/**
 * /merchants — the Merchants directory.
 * Thin route: renders the client feature component. Wrapped in Suspense because
 * MerchantList reads the URL search params (Next requirement for useSearchParams).
 */
export default function MerchantsPage() {
  return (
    <Suspense fallback={<MerchantsFallback />}>
      <MerchantList />
    </Suspense>
  );
}

function MerchantsFallback() {
  return (
    <div>
      <div className="h-8 w-40 animate-pulse rounded bg-sunken" />
      <div className="mt-6 h-64 animate-pulse rounded-lg bg-sunken" />
    </div>
  );
}
