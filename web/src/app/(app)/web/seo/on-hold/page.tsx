import type { Metadata } from "next";
import { OnHoldPage } from "@/features/seo/components/on-hold-page";

export const metadata: Metadata = { title: "SEO — on hold — Innowi" };

/** /web/seo/on-hold — modules of the SEO design that aren't built yet. */
export default function Page() {
  return <OnHoldPage />;
}
