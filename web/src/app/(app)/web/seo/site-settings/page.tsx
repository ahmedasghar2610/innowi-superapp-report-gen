import type { Metadata } from "next";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui";
import { SeoSitesSettings } from "@/features/seo/components/connections-page";

export const metadata: Metadata = { title: "SEO site settings — Innowi" };

/** /web/seo/site-settings — optional SEO keys and every site's settings (?site= opens one).
 *  The Google connection itself is in Settings → Integrations. */
export default function Page() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <SeoSitesSettings />
    </Suspense>
  );
}
