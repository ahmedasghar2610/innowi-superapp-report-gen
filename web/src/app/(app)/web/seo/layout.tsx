import type { Metadata } from "next";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui";
import { SeoShell } from "@/features/seo/components/seo-shell";

export const metadata: Metadata = {
  title: "SEO — Innowi",
};

/** /web/seo/* — title, data-source strip and the SEO tab bar around every SEO page. */
export default function SeoLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <SeoShell>{children}</SeoShell>
    </Suspense>
  );
}
