import type { Metadata } from "next";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui";
import { ComparePage } from "@/features/seo/components/compare-page";

export const metadata: Metadata = { title: "Compare sites — SEO — Innowi" };

/** /web/seo/compare?ids=a,b — sites side by side. */
export default function Page() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <ComparePage />
    </Suspense>
  );
}
