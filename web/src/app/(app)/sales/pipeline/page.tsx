import type { Metadata } from "next";
import { PipelinePage } from "@/features/sales/components/pipeline-page";

export const metadata: Metadata = { title: "Salesforce pipeline — Innowi" };

export default function PipelineRoute() {
  return <PipelinePage />;
}
