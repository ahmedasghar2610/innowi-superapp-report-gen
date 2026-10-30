import type { Metadata } from "next";
import { RoadmapPage } from "@/features/roadmap/components/roadmap-page";

export const metadata: Metadata = { title: "Roadmap — Innowi" };

export default function RoadmapRoute() {
  return <RoadmapPage />;
}
