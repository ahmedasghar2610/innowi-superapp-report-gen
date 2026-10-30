import type { Metadata } from "next";
import { ChurnPage } from "@/features/churn/components/churn-page";

export const metadata: Metadata = { title: "Churned accounts — Innowi" };

export default function ChurnRoute() {
  return <ChurnPage />;
}
