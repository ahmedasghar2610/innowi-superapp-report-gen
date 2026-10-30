import type { Metadata } from "next";
import { WebsitesPanel } from "@/features/websites/components/websites-panel";

export const metadata: Metadata = {
  title: "Website — Innowi",
};

/**
 * /web/website — the Website module. Thin route: the feature component owns the
 * list, the filters and the intake form drawer.
 */
export default function WebsitePage() {
  return <WebsitesPanel />;
}
