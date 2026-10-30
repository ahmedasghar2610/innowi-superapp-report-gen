import type { Metadata } from "next";
import { ReportsPage } from "@/features/seo/components/reports-page";

export const metadata: Metadata = { title: "SEO Reports — Innowi" };

/** /web/seo/reports — Reports Center. */
export default function Page() {
  return <ReportsPage />;
}
