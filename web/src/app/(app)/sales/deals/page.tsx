import type { Metadata } from "next";
import { DealsPage } from "@/features/sales/components/list-pages";

export const metadata: Metadata = { title: "Salesforce deals — Innowi" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Filters arrive from the Pipeline ("See all") and My Day links: ?column=&state=&stale=1&quiet=stuck|stale */
export default async function DealsRoute({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const state = one(sp.state);
  const column = one(sp.column)?.slice(0, 120);
  const stale = one(sp.stale) === "1";
  const q = one(sp.quiet);
  const quiet = q === "stuck" || q === "stale" ? q : undefined;
  return (
    <DealsPage
      // A new link (e.g. another pipeline column) starts from its own filters.
      key={`${column ?? ""}|${state ?? ""}|${stale}|${quiet ?? ""}`}
      initialColumn={column}
      initialState={state === "closed" || state === "all" ? state : "open"}
      initialStale={stale}
      initialQuiet={quiet}
    />
  );
}
