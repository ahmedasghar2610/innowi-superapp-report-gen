import type { Metadata } from "next";
import { VisitsPage } from "@/features/sales/components/list-pages";

export const metadata: Metadata = { title: "Visits — Salesforce — Innowi" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const WHEN = ["all", "today", "week", "next7", "overdue", "upcoming"] as const;
type When = (typeof WHEN)[number];

/** ?when=today|week|next7|overdue|upcoming — set by the My Day tiles. */
export default async function VisitsRoute({ searchParams }: { searchParams: SearchParams }) {
  const raw = (await searchParams).when;
  const when = (Array.isArray(raw) ? raw[0] : raw) as When | undefined;
  const initial: When = when && WHEN.includes(when) ? when : "all";
  return <VisitsPage key={initial} initialWhen={initial} />;
}
