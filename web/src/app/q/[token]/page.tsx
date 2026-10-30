import type { Metadata } from "next";
import { QuotePage } from "@/features/quotes/public/quote-page";

export const metadata: Metadata = {
  title: "Your Innowi quote",
  // Each link is private to one restaurant: keep it out of search engines.
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/** Public page a restaurant opens from its quote link (no login). */
export default async function QuoteLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <QuotePage token={token} />;
}
