import type { Metadata } from "next";
import { DataQualityPage } from "@/features/merchants/components/data-quality/data-quality-page";

export const metadata: Metadata = {
  title: "Data Quality — Innowi",
};

/**
 * /data-quality — portfolio profile completeness and verification (PRD §22, M1-02).
 * Thin route: renders the client feature component.
 */
export default function DataQualityRoute() {
  return <DataQualityPage />;
}
