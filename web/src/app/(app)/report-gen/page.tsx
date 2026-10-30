import type { Metadata } from "next";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui";
import { QueuePage } from "@/features/report-gen/components/queue-page";

export const metadata: Metadata = { title: "Merchant Reports — Innowi" };

/** /report-gen — every active merchant and its monthly report (generate, review, approve, send). */
export default function Page() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <QueuePage />
    </Suspense>
  );
}
