import { IntegrationsPanel } from "@/features/settings/components/integrations-page";

/** Ops CRM → Integrations: the same live status as Settings → Integrations. */
export default function OpsIntegrationsPage() {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-[-0.011em] text-foreground">Integrations</h1>
        <p className="mt-1 text-table text-muted-foreground">Connections to Google Business Profile, Google Ads, Search Console & GA4, Microsoft Teams, Outlook and Fathom.</p>
      </div>
      <IntegrationsPanel />
    </div>
  );
}
