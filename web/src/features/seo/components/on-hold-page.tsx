"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { ArrowLeft, ArrowRight, Construction, DollarSign, Link2, MapPinned, Swords } from "lucide-react";
import { Badge, type BadgeTone, Card } from "@/components/ui";
import { InfoNote, Section } from "./parts";

type Reason = "source" | "data";
const REASON: Record<Reason, { label: string; tone: BadgeTone }> = {
  source: { label: "Needs a data source", tone: "warning" },
  data: { label: "Needs ordering data", tone: "warning" },
};

export interface OnHoldModule {
  slug: string;
  title: string;
  icon: LucideIcon;
  reason: Reason;
  summary: string;
  /** What the module will do once built. */
  scope: string[];
  /** What has to be true before it can be built. */
  unblock: string[];
  /** What the built pages already show meanwhile. */
  meanwhile?: { text: string; href: string };
  /** Where its UI preview (placeholder data, no backend) can be seen. */
  preview?: { href: string; label: string };
}

/** Everything in the SEO design that isn't built yet — each gets its own under-construction page. */
export const ON_HOLD: OnHoldModule[] = [
  {
    slug: "backlinks",
    preview: { href: "/web/seo/reports", label: "Placeholder section in every report preview" },
    title: "Backlinks & authority",
    icon: Link2,
    reason: "source",
    summary: "Referring domains, new and lost links, toxic links and an authority score for every site.",
    scope: ["Referring domains and authority trend", "New / lost links per month", "Toxic-link flags into Intelligence", "Authority feeds the Authority pillar"],
    unblock: [
      "Screaming Frog (licensed) → Configuration → API Access → connect Ahrefs, Majestic or Moz (needs that tool's API plan)",
      "Export the Link Metrics columns with the crawl, and add them to the import script (not built yet)",
    ],
    meanwhile: { text: "The Authority pillar shows 'Pending' rather than an estimate.", href: "/web/seo" },
  },
  {
    slug: "competitors",
    preview: { href: "/settings/integrations", label: "Listed in Settings → Integrations → SEO connections & keys" },
    title: "Competitor visibility",
    icon: Swords,
    reason: "source",
    summary: "Track each client against the restaurants competing for the same searches.",
    scope: ["Competitor list per site", "Share of visibility on tracked keywords", "Keyword gaps — searches competitors win and the client doesn't"],
    unblock: ["Screaming Frog doesn't measure competitors — needs its own source (e.g. DataForSEO)", "Search Console only covers your own sites, so it can't show competitors' positions"],
    meanwhile: { text: "Tracked keyword positions for the client itself are on each site's scorecard.", href: "/web/seo" },
  },
  {
    slug: "citations",
    preview: { href: "/web/seo", label: "Pending rows in each scorecard's Local SEO card" },
    title: "Directory citations",
    icon: MapPinned,
    reason: "source",
    summary: "Check the restaurant's name, address and phone across Yelp, TripAdvisor, Apple Maps, Bing and other directories.",
    scope: ["NAP consistency per directory", "Missing / duplicate listings", "Citation score feeding the Local pillar"],
    unblock: ["Screaming Frog doesn't check directory listings — needs a listings source (BrightLocal, Yext, Moz Local)", "Its API key"],
    meanwhile: { text: "The Local pillar already uses the linked Google Business Profile.", href: "/web/gbp" },
  },
  {
    slug: "ordering-roi",
    preview: { href: "/web/seo/reports", label: "“Key events → orders” tile in every report (orders pending)" },
    title: "Ordering ROI",
    icon: DollarSign,
    reason: "data",
    summary: "Tie organic traffic to online orders and revenue, so each report shows what SEO earned the restaurant.",
    scope: ["Orders and revenue from organic visits", "Revenue per package vs fee", "ROI line in client reports"],
    unblock: ["Online-ordering / POS order data in the Super App", "Order attribution (UTM or GA4 purchase events) on client sites"],
    meanwhile: { text: "Reports show GA4 key events (orders, calls, directions) where the site tracks them.", href: "/web/seo/reports" },
  },
];

/** /web/seo/on-hold — the list. */
export function OnHoldPage() {
  return (
    <>
      <InfoNote>
        These parts of the SEO design aren&apos;t built yet. Each one is waiting on a data source — nothing here is estimated or faked in the meantime.
      </InfoNote>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {ON_HOLD.map((m) => (
          <Link key={m.slug} href={`/web/seo/on-hold/${m.slug}`} className="group">
            <Card className="flex h-full flex-col gap-3 p-4 transition-colors group-hover:bg-secondary/50">
              <div className="flex items-start gap-3">
                <div className="grid size-10 shrink-0 place-items-center rounded-[11px] bg-muted text-muted-foreground">
                  <m.icon className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-foreground">{m.title}</div>
                  <Badge tone={REASON[m.reason].tone} className="mt-1">
                    {REASON[m.reason].label}
                  </Badge>
                </div>
                <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </div>
              <p className="text-xs text-muted-foreground">{m.summary}</p>
              {m.preview && <span className="text-xs font-medium text-warning-text">UI preview available</span>}
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}

/** /web/seo/on-hold/[module] — the under-construction page for one module. */
export function OnHoldModulePage({ slug }: { slug: string }) {
  const m = ON_HOLD.find((x) => x.slug === slug);
  if (!m) {
    return (
      <Card>
        <div className="flex flex-col items-center px-5 py-16 text-center">
          <p className="text-base font-semibold text-foreground">Not found</p>
          <Link href="/web/seo/on-hold" className="mt-2 text-sm text-primary hover:underline">
            Back to On hold
          </Link>
        </div>
      </Card>
    );
  }
  return (
    <>
      <Link href="/web/seo/on-hold" className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" />
        On hold
      </Link>
      <Card>
        <div className="flex flex-col items-center px-5 py-12 text-center">
          <div className="relative mb-3.5 grid size-12 place-items-center rounded-[13px] bg-muted text-muted-foreground">
            <m.icon className="size-6" />
            <span className="absolute -bottom-1 -right-1 grid size-5 place-items-center rounded-full bg-warning-soft text-warning-text ring-2 ring-card">
              <Construction className="size-3" />
            </span>
          </div>
          <p className="text-base font-semibold text-foreground">{m.title} — under construction</p>
          <p className="mt-1 max-w-lg text-table text-muted-foreground">{m.summary}</p>
          <Badge tone={REASON[m.reason].tone} className="mt-3">
            {REASON[m.reason].label}
          </Badge>
        </div>
      </Card>
      <div className="grid gap-5 md:grid-cols-2">
        <Section title="What it will do">
          <Card className="p-4">
            <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-foreground">
              {m.scope.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </Card>
        </Section>
        <Section title="Waiting on">
          <Card className="p-4">
            <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-foreground">
              {m.unblock.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </Card>
        </Section>
      </div>
      {m.preview && (
        <Link
          href={m.preview.href}
          className="flex w-fit items-center gap-2 rounded-lg border border-dashed border-warning/60 bg-warning-soft px-3 py-2 text-sm font-medium text-warning-text hover:underline"
        >
          UI preview (placeholder data): {m.preview.label}
        </Link>
      )}
      {m.meanwhile && (
        <InfoNote>
          Meanwhile: {m.meanwhile.text}{" "}
          <Link href={m.meanwhile.href} className="font-medium text-primary hover:underline">
            Open
          </Link>
        </InfoNote>
      )}
    </>
  );
}
