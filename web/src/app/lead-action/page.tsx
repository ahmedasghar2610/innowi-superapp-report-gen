import { Suspense } from "react";
import type { Metadata } from "next";
import { LeadActionPage } from "@/features/partners/public/lead-action-page";

export const metadata: Metadata = {
  title: "Partner lead — Innowi",
  robots: { index: false, follow: false },
};

/** Public: the partner-lead e-mail buttons land here (see LeadActionPage). */
export default function Page() {
  return (
    <Suspense fallback={null}>
      <LeadActionPage />
    </Suspense>
  );
}
