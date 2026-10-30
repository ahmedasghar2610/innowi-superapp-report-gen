import type { Metadata } from "next";
import { KpiPage } from "@/features/seo/components/kpi-page";

export const metadata: Metadata = { title: "SEO KPI Studio — Innowi" };

/** /web/seo/kpis — KPI Studio. */
export default function Page() {
  return <KpiPage />;
}
