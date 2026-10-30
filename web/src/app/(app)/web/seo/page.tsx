import { Suspense } from "react";
import { Skeleton } from "@/components/ui";
import { CommandPage } from "@/features/seo/components/command-page";

/** /web/seo — SEO Command: every site, its health and alerts. */
export default function Page() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <CommandPage />
    </Suspense>
  );
}
