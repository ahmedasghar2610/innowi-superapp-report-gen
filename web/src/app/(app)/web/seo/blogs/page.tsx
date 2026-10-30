import type { Metadata } from "next";
import { BlogImpactPage } from "@/features/seo/components/blog-impact-page";

export const metadata: Metadata = { title: "SEO Blog Impact — Innowi" };

/** /web/seo/blogs — Blog Impact. */
export default function Page() {
  return <BlogImpactPage />;
}
