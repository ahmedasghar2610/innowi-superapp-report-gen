"use client";

import {
  Users, MapPin, Layers, FileText, Palette, Search, Swords, Tag, Plug, type LucideIcon,
} from "lucide-react";
import { Card, ErrorState, SectionHead, Skeleton, StatTile, type StatTone } from "@/components/ui";
import {
  useBrandAssets, useCompetitors, useConnections, useContacts, useDocuments, useKeywords, useLocations,
  usePromotions, useServices, useProfileCompleteness,
} from "@/features/merchants/api";
import { useMerchantHistory } from "@/features/audit/queries";
import { useMerchant } from "@/features/merchants/api";
import { MerchantChurnCard } from "@/features/churn/components/merchant-churn-card";
import { MerchantLinksCard } from "@/features/merchants/components/links/merchant-links";
import { MerchantDealsCard } from "@/features/deals/components/merchant-deals-card";
import { AuditActionBadge } from "@/features/audit/components/audit-badges";
import { formatDate } from "@/lib/format";

/**
 * Overview — the merchant's landing tab (route: /merchants/[merchantId]/overview).
 *
 * The workspace shell already shows the header, the completeness card (score,
 * confidence, alerts) and the summary card above every tab, so this page does
 * not repeat any of that. It answers "what is here, and what happened
 * recently?": one tile per profiling section with a live count and a
 * one-line status, deep-linked to the tab that manages it, plus the last few
 * audit entries. Super App PRD §14.3's Overview also wants module health, KPIs
 * and AI summary — those arrive with their modules; this is the Profiling
 * slice of it.
 */
export function MerchantOverviewPanel({ merchantId }: { merchantId: string }) {
  const completeness = useProfileCompleteness(merchantId);
  const contacts = useContacts(merchantId);
  const locations = useLocations(merchantId);
  const services = useServices(merchantId);
  const documents = useDocuments(merchantId);
  const assets = useBrandAssets(merchantId);
  const keywords = useKeywords(merchantId);
  const competitors = useCompetitors(merchantId);
  const promotions = usePromotions(merchantId);
  const connections = useConnections(merchantId);
  const history = useMerchantHistory(merchantId, { page: 1, limit: 6 });
  const merchant = useMerchant(merchantId);

  const c = completeness.data;
  const pendingConn = c?.pendingConnections.length ?? 0;
  const blockingConn = c?.pendingConnections.filter((p) => p.blocking).length ?? 0;
  const activeServices = services.data?.filter((s) => s.status === "ACTIVE").length ?? 0;
  const activePromos = promotions.data?.filter((p) => p.status === "ACTIVE" || p.status === "SCHEDULED").length ?? 0;
  const storedDocs = documents.data?.filter((d) => d.hasFile).length ?? 0;
  const activeAssets = assets.data?.filter((a) => a.status === "ACTIVE").length ?? 0;
  const primaryLoc = locations.data?.find((l) => l.isPrimary) ?? locations.data?.[0];
  const napConflicts = c?.napConflicts.length ?? 0;
  const requiredMissing = c?.requiredMissingCount ?? 0;

  const tiles: Tile[] = [
    {
      href: "profile", icon: FileText, label: "Profile",
      value: c ? `${c.fields.filled}/${c.fields.total}` : undefined, loading: completeness.isPending,
      status: c ? (requiredMissing > 0 ? `${requiredMissing} required missing` : "All required fields present") : "",
      tone: requiredMissing > 0 ? "warning" : "ok",
    },
    {
      href: "connections", icon: Plug, label: "Access",
      value: connections.data?.length, loading: connections.isPending,
      // "All connected" only when there is something connected — an empty list is "None recorded yet".
      status: !connections.data?.length ? "None recorded yet" : pendingConn === 0 ? "All connected" : `${pendingConn} pending${blockingConn ? ` · ${blockingConn} blocking` : ""}`,
      tone: !connections.data?.length ? "warning" : blockingConn > 0 ? "danger" : pendingConn > 0 ? "warning" : "ok",
    },
    {
      href: "contacts", icon: Users, label: "Contacts",
      value: contacts.data?.length, loading: contacts.isPending,
      status: contacts.data?.some((x) => x.role === "OWNER" && x.name) ? "Owner on file" : "No owner named",
      tone: contacts.data?.some((x) => x.role === "OWNER" && x.name) ? "ok" : "warning",
    },
    {
      href: "locations", icon: MapPin, label: "Locations",
      value: locations.data?.length, loading: locations.isPending,
      status: napConflicts > 0 ? `${napConflicts} NAP conflict` : primaryLoc?.city ? `Primary: ${primaryLoc.city}` : "No address yet",
      tone: napConflicts > 0 ? "danger" : primaryLoc?.city ? "ok" : "warning",
    },
    {
      href: "services", icon: Layers, label: "Services",
      value: activeServices, loading: services.isPending,
      status: `${activeServices} active of ${services.data?.length ?? 0} assigned`, tone: "neutral",
    },
    {
      href: "brand", icon: Palette, label: "Brand",
      value: activeAssets, loading: assets.isPending,
      status: `${activeAssets} asset${activeAssets === 1 ? "" : "s"} on file`, tone: activeAssets > 0 ? "ok" : "warning",
    },
    {
      href: "documents", icon: FileText, label: "Documents",
      value: documents.data?.length, loading: documents.isPending,
      status: `${storedDocs} stored · ${(documents.data?.length ?? 0) - storedDocs} reference`, tone: "neutral",
    },
    {
      href: "keywords", icon: Search, label: "Keywords",
      value: keywords.data?.length, loading: keywords.isPending,
      status: keywords.data?.length ? `${keywords.data.filter((k) => k.type === "PRIMARY").length} primary` : "None defined",
      tone: keywords.data?.length ? "neutral" : "warning",
    },
    {
      href: "competitors", icon: Swords, label: "Competitors",
      value: competitors.data?.length, loading: competitors.isPending,
      status: competitors.data?.length ? "Tracked" : "None named", tone: "neutral",
    },
    {
      href: "promotions", icon: Tag, label: "Promotions",
      value: promotions.data?.length, loading: promotions.isPending,
      status: activePromos ? `${activePromos} live or scheduled` : "Nothing running", tone: "neutral",
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      {merchant.data ? <MerchantDealsCard merchantId={merchantId} restaurantName={merchant.data.restaurantName} /> : null}
      {merchant.data ? <MerchantChurnCard merchantId={merchantId} status={merchant.data.status} /> : null}
      <section className="flex flex-col gap-3">
        <SectionHead
          title="At a glance"
          description="What the profile holds today — open a tile to manage that section."
        />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {tiles.map((t) => (
            <StatTile
              key={t.href}
              href={`/merchants/${merchantId}/${t.href}`}
              scroll={false}
              icon={t.icon}
              label={t.label}
              value={t.value ?? "—"}
              status={t.status}
              tone={t.tone}
              loading={t.loading}
            />
          ))}
        </div>
      </section>

      <MerchantLinksCard merchantId={merchantId} />

      <section className="flex flex-col gap-3">
      <SectionHead title="Recent activity" link="Full history" href={`/merchants/${merchantId}/history`} scroll={false} />
      <Card className="overflow-hidden p-0">
        {history.isError ? (
          <ErrorState title="Couldn't load activity" error={history.error} onRetry={() => history.refetch()} />
        ) : history.isPending ? (
          <div className="divide-y divide-border">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3">
                <Skeleton className="h-5 w-16 rounded-full" />
                <Skeleton className="h-3.5 w-48" />
                <Skeleton className="ml-auto h-3 w-24" />
              </div>
            ))}
          </div>
        ) : history.data.data.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs leading-4 text-muted-foreground">No changes recorded yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {history.data.data.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-xs leading-4">
                <AuditActionBadge action={row.action} />
                <span className="text-sm font-medium leading-5 text-foreground">{row.entityType}</span>
                {row.changedFields.length > 0 && (
                  <span className="truncate text-muted-foreground">{row.changedFields.slice(0, 3).join(", ")}{row.changedFields.length > 3 ? ` +${row.changedFields.length - 3}` : ""}</span>
                )}
                <span className="ml-auto text-muted-foreground">
                  {row.actorEmail ?? "system"} · {formatDate(row.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      </section>
    </div>
  );
}

/* ---- tiles ------------------------------------------------------------------ */

type Tone = StatTone;

interface Tile {
  href: string;
  icon: LucideIcon;
  label: string;
  value: number | string | undefined;
  loading: boolean;
  status: string;
  tone: Tone;
}
