import type { Metadata } from "next";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui";
import { IntelligencePage } from "@/features/seo/components/intelligence-page";

export const metadata: Metadata = { title: "SEO Intelligence — Innowi" };

/** /web/seo/intelligence — findings and their fix workflow. Filters live in the URL. */
export default function Page() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <IntelligencePage />
    </Suspense>
  );
}
