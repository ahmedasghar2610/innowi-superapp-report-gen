"use client";

import { CircleCheck, CircleDashed, Construction } from "lucide-react";
import { Badge, Button, Input, Skeleton } from "@/components/ui";
import { useGbpStatus } from "@/features/gbp/api";
import { useAdsStatus } from "@/features/ads/api";
import { useSeoStatus } from "../api";
import { PreviewBanner } from "./parts";

type Live = "connected" | "pending" | "preview";
interface Item {
  id: string;
  name: string;
  by: string;
  powers: string;
  fields: string[];
  state: Live;
  /** Where the real setting lives, for built ones. */
  where?: string;
}

/**
 * Settings → Integrations → "SEO connections & keys" — the prototype's full
 * Connections & keys list (17 services). Built ones show their live status and
 * point to where they're managed; the rest are a UI preview with disabled
 * fields (no vault, no backend yet).
 */
export function SeoConnectionsCatalog() {
  const seo = useSeoStatus();
  const gbp = useGbpStatus();
  const ads = useAdsStatus();
  if (!seo.data || !gbp.data || !ads.data) return <Skeleton className="h-64 w-full" />;
  const s = seo.data;
  const on = (b: boolean): Live => (b ? "connected" : "pending");

  const groups: { title: string; note: string; items: Item[] }[] = [
    {
      title: "A · Site tags & scripts",
      note: "IDs injected into client sites",
      items: [
        { id: "CON-03", name: "Google Tag Manager", by: "Google", powers: "Tracking-integrity watchdog · tag registry", fields: ["Container ID", "API access token"], state: "preview" },
        { id: "CON-07", name: "Meta Pixel + Marketing API", by: "Meta", powers: "Social paid alignment · conversion cross-check", fields: ["Pixel ID", "Marketing API token"], state: "preview" },
        { id: "—", name: "Custom snippet (guarded)", by: "Head/body injection per site", powers: "Reviewed, logged snippets — never a live paste", fields: ["Snippet"], state: "preview" },
      ],
    },
    {
      title: "B · External data connections",
      note: "what the SEO pages read",
      items: [
        { id: "CON-01", name: "Google Search Console", by: "Google", powers: "Clicks/impressions · indexing · Audits pillar", fields: [], state: on(!!s.connection?.scopes.searchConsole), where: "Settings → Integrations (Google connections)" },
        { id: "CON-02", name: "Google Analytics 4", by: "Google", powers: "Visits · key events · ROI & Tracking pillar", fields: [], state: on(!!s.connection?.scopes.analytics), where: "Settings → Integrations; property per site in SEO → Site settings" },
        { id: "CON-04", name: "Google Business Profile", by: "Google", powers: "Local health · Local SEO pillar", fields: [], state: on(gbp.data.connection?.status === "connected"), where: "Settings → Integrations" },
        { id: "CON-05", name: "Google Ads (read-only)", by: "Google", powers: "Paid alignment pillar", fields: [], state: on(ads.data.connection?.status === "connected"), where: "Settings → Integrations" },
        { id: "CON-17", name: "PageSpeed Insights API", by: "Google", powers: "Mobile speed + Core Web Vitals per page", fields: [], state: on(s.keys.pagespeed), where: "PAGESPEED_API_KEY in the API .env" },
        { id: "CON-08", name: "Screaming Frog crawl (full site)", by: "Screaming Frog desktop · CSV import", powers: "Whole-site audits · orphan / redirect checks · client report", fields: [], state: on(s.sources.some((x) => x.key === "screamingfrog" && x.state === "connected")), where: "scripts/seo_import_sf.py in the API folder" },
        { id: "CON-06b", name: "Screaming Frog link metrics (Ahrefs / Majestic / Moz)", by: "Screaming Frog", powers: "Backlinks · Authority pillar", fields: ["Link-data API key (set inside Screaming Frog)"], state: "preview" },
        { id: "CON-09", name: "Looker Studio (optional)", by: "Google", powers: "Legacy report embeds", fields: ["Dashboard embed URL"], state: "preview" },
      ],
    },
    {
      title: "C · Internal platform endpoints",
      note: "Innowi services the SEO module would talk to",
      items: [
        { id: "CON-10", name: "Client registry", by: "Innowi CRM / onboarding", powers: "Merchants linked to sites", fields: [], state: "connected", where: "Built in — merchants come from Merchant Profiling" },
        { id: "CON-11", name: "Ordering conversions feed", by: "Innowi ordering", powers: "ROI pillar · orders in reports", fields: ["Conversions API endpoint", "Service token"], state: "preview" },
        { id: "CON-12", name: "Content-tree store", by: "SEO content-tree engine", powers: "Drip queue · publish statuses", fields: ["Store endpoint / bucket"], state: "preview" },
        { id: "CON-13", name: "Site write + deploy hook", by: "Web Development", powers: "Page editor save → review → publish", fields: ["Deploy hook URL", "Hook secret"], state: "preview" },
        { id: "CON-14", name: "Identity & roles (SSO)", by: "Innowi platform auth", powers: "Who can edit / approve", fields: [], state: "connected", where: "Built in — Super App login and roles" },
        { id: "CON-15", name: "Task tracker", by: "Ops CRM tickets", powers: "Alert → task with SLA", fields: ["Task-create endpoint"], state: "preview" },
        { id: "CON-16", name: "Reviews signals (read-only)", by: "Reviews module", powers: "Local context on the scorecard", fields: ["Signals endpoint"], state: "preview" },
      ],
    },
  ];
  const all = groups.flatMap((g) => g.items);
  const live = all.filter((i) => i.state === "connected").length;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted-foreground">
        {live} of {all.length} connected · {all.filter((i) => i.state === "pending").length} built but not set up · {all.filter((i) => i.state === "preview").length} UI preview
        only
      </p>
      <PreviewBanner title="Cards marked “UI preview” have no backend yet">
        Their fields are disabled and nothing is stored. Built connections show their live status and where they&apos;re managed.
      </PreviewBanner>
      {groups.map((g) => (
        <div key={g.title} className="flex flex-col gap-2">
          <div className="flex items-baseline gap-2">
            <h3 className="text-sm font-semibold text-foreground">{g.title}</h3>
            <span className="text-xs text-muted-foreground">{g.note}</span>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {g.items.map((i) => (
              <div key={i.id + i.name} className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-foreground">{i.name}</div>
                    <div className="text-xs text-muted-foreground">{i.by}</div>
                  </div>
                  {i.state === "connected" ? (
                    <Badge tone="success" icon={CircleCheck}>
                      Connected
                    </Badge>
                  ) : i.state === "pending" ? (
                    <Badge tone="warning" icon={CircleDashed}>
                      Not set up
                    </Badge>
                  ) : (
                    <Badge tone="dataq" icon={Construction}>
                      UI preview
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-foreground">
                  <span className="text-muted-foreground">Powers:</span> {i.powers}
                </p>
                {i.where && <p className="text-xs text-muted-foreground">Managed in: {i.where}</p>}
                {i.state === "preview" && i.fields.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    {i.fields.map((f) => (
                      <Input key={f} placeholder={f} disabled className="h-8 text-xs" />
                    ))}
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" disabled>
                        Save to vault
                      </Button>
                      <Button size="sm" variant="outline" disabled>
                        Test connection
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
