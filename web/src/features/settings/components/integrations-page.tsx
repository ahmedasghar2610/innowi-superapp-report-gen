"use client";

import {
  CircleCheck,
  CircleDashed,
  CircleX,
  Clock,
  FileText,
  TriangleAlert,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Badge, Button, Skeleton, type BadgeTone } from "@/components/ui";
import { useIntegrations } from "../api";
import type { IntegrationStatus } from "../types";
import { Suspense } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/query-keys";
import { GbpConnectionSettings } from "@/features/gbp/components/gbp-connection-settings";
import { AdsConnectionSettings } from "@/features/ads/components/connection";
import { SeoConnectionSettings } from "@/features/seo/components/connection";
import { CrawlerSettings } from "@/features/seo/components/crawler";
import { SeoReportEmailSettings } from "@/features/seo/components/report-email-settings";
import { SeoConnectionsCatalog } from "@/features/seo/components/connections-catalog";
import { ConnectionsOverview } from "./connections-overview";
import { SettingsCard } from "./settings-shell";
import { DataSetupPointer } from "./data-setup";
import { TeamsAlertsCard } from "./teams-cards";

/** Shown in "Google connections" with their own cards, not in "Other integrations". */
const GOOGLE_KEYS = new Set(["gbp", "google_ads", "seo"]);

const STATUS: Record<
  IntegrationStatus,
  { label: string; tone: BadgeTone; icon: LucideIcon }
> = {
  connected: { label: "Working", tone: "success", icon: CircleCheck },
  configured: { label: "Keys added", tone: "accent", icon: CircleDashed },
  attention: { label: "Needs attention", tone: "danger", icon: TriangleAlert },
  not_connected: { label: "Not connected", tone: "warning", icon: CircleX },
  logged_only: { label: "Logged only", tone: "neutral", icon: FileText },
  planned: { label: "Planned", tone: "neutral", icon: Clock },
};

/**
 * Settings → Integrations: one place for every connection.
 *  1. Google connections — GBP, Google Ads and SEO (Search Console & GA4) at a glance,
 *     then each card with connect / change / disconnect / refresh / sample data.
 *  2. Email sending — SEO report e-mail (Gmail as the SEO Google account): status, sender, test send.
 *  3. Other integrations — live status of the remaining keys (Teams, Outlook, Fathom…).
 * SEO site settings (links, package, recipients) stay in SEO → Site settings.
 * Ops CRM → Integrations shows the same page.
 */
export function IntegrationsPanel() {
  const { data, isPending, refetch, isFetching } = useIntegrations();
  const qc = useQueryClient();
  const checkAgain = () => {
    void refetch();
    for (const k of [
      queryKeys.gbp.status(),
      queryKeys.ads.status(),
      queryKeys.seo.status(),
    ])
      void qc.invalidateQueries({ queryKey: k });
  };
  return (
    <>
      <DataSetupPointer />
      <SettingsCard
        title="Google connections"
        description="Google Business Profile, Google Ads and SEO each use their own Google sign-in (different permissions), so each one is connected separately. Keys go in the API's environment variables and need a redeploy."
        action={
          <Button size="sm" loading={isFetching} onClick={checkAgain}>
            Check again
          </Button>
        }
      >
        <div className="flex flex-col gap-3">
          <ConnectionsOverview />
          <Suspense fallback={<Skeleton className="h-48 w-full" />}>
            <GbpConnectionSettings />
          </Suspense>
          <Suspense fallback={<Skeleton className="h-48 w-full" />}>
            <AdsConnectionSettings />
          </Suspense>
          <Suspense fallback={<Skeleton className="h-48 w-full" />}>
            <SeoConnectionSettings />
          </Suspense>
        </div>
      </SettingsCard>

      <SettingsCard
        title="Email sending"
        description="E-mail the Super App sends on its own, from your connected Google (Gmail) account."
      >
        <SeoReportEmailSettings />
      </SettingsCard>

      <SettingsCard
        title="SEO connections & keys"
        description="Every service the SEO module uses or is designed to use (the prototype's Connections & keys list) — live status for built ones, UI preview for the rest."
      >
        <SeoConnectionsCatalog />
      </SettingsCard>

      <SettingsCard
        title="Screaming Frog crawler"
        description="Full-site crawls run on a PC that has a licensed Screaming Frog (the SF-Helper folder, started with Windows). The Super App queues them; the helper picks them up, crawls and sends the result back."
      >
        <CrawlerSettings />
      </SettingsCard>

      <TeamsAlertsCard />

      <SettingsCard
        title="Other integrations"
        description="Live status, checked by the API each time this page loads."
      >
        {isPending ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {data
              ?.filter((i) => !GOOGLE_KEYS.has(i.key))
              .map((i) => {
                const s = STATUS[i.status];
                return (
                  <div
                    key={i.key}
                    className="flex flex-col gap-2 rounded-lg border border-border p-4"
                  >
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-foreground">
                          {i.name}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {i.description}
                        </div>
                      </div>
                      <Badge tone={s.tone} icon={s.icon}>
                        {s.label}
                      </Badge>
                    </div>
                    <p className="text-sm text-foreground">{i.statusText}</p>
                    <div>
                      <div className="text-xs font-medium text-muted-foreground">
                        Used for
                      </div>
                      <ul className="mt-1 list-inside list-disc text-xs text-muted-foreground">
                        {i.usedFor.map((u) => (
                          <li key={u}>{u}</li>
                        ))}
                      </ul>
                    </div>
                    {i.envKeys.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {i.envKeys.map((k) => (
                          <code
                            key={k}
                            className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
                          >
                            {k}
                          </code>
                        ))}
                      </div>
                    )}
                    {i.nextStep && i.status !== "connected" && (
                      <p className="text-xs text-muted-foreground">
                        Next: {i.nextStep}
                      </p>
                    )}
                  </div>
                );
              })}
          </div>
        )}
      </SettingsCard>
    </>
  );
}
