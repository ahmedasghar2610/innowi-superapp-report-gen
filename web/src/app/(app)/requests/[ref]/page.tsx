import type { Metadata } from "next";
import { RequestDetailPage } from "@/features/requests/components/request-detail-page";

export const metadata: Metadata = { title: "Request — Innowi" };

export default async function RequestRoute({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  return <RequestDetailPage refParam={decodeURIComponent(ref)} />;
}
