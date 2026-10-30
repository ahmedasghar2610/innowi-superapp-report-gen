"use client";

import type { LucideIcon } from "lucide-react";
import { CircleAlert, CircleCheck, CircleDashed, MapPin, RefreshCw, Search, Target } from "lucide-react";
import { Badge, type BadgeTone, Skeleton } from "@/components/ui";
import { useGbpStatus } from "@/features/gbp/api";
import { useAdsStatus } from "@/features/ads/api";
import { useSeoStatus } from "@/features/seo/api";
import { fmtAgo } from "@/features/gbp/lib";

/** What every Google connection status has in common (GBP, Ads, SEO). */
interface CommonStatus {
  missingEnv: string[];
  running: boolean;
  connection: { email: string | null; status: "connected" | "error"; lastSyncAt: string | null } | null;
}

interface Tile {
  key: string;
  anchor: string;
  label: string;
  icon: LucideIcon;
  status: CommonStatus | undefined;
  /** Shown when the keys are missing (GBP is waiting for Google's API approval). */
  waitingLabel: string;
}

function stateOf(s: CommonStatus, waitingLabel: string): { label: string; tone: BadgeTone; icon: LucideIcon } {
  const keys = s.missingEnv.filter((k) => k !== "CREDENTIAL_ENCRYPTION_KEY");
  if (s.running) return { label: "Refreshing…", tone: "accent", icon: RefreshCw };
  if (!s.connection) return keys.length ? { label: waitingLabel, tone: "warning", icon: CircleDashed } : { label: "Not connected", tone: "warning", icon: CircleDashed };
  if (s.connection.status === "error") return { label: "Needs reconnect", tone: "danger", icon: CircleAlert };
  return { label: "Connected", tone: "success", icon: CircleCheck };
}

/**
 * The three Google connections at a glance, at the top of Settings → Integrations.
 * Each one is its own Google sign-in (different permissions), so connecting Ads
 * doesn't connect SEO — this row makes that visible. Click a tile to jump to its card.
 */
export function ConnectionsOverview() {
  const gbp = useGbpStatus();
  const ads = useAdsStatus();
  const seo = useSeoStatus();
  const tiles: Tile[] = [
    { key: "gbp", anchor: "#gbp", label: "Google Business Profile", icon: MapPin, status: gbp.data, waitingLabel: "Waiting for Google approval" },
    { key: "ads", anchor: "#google-ads", label: "Google Ads", icon: Target, status: ads.data, waitingLabel: "Waiting for keys" },
    { key: "seo", anchor: "#seo", label: "Search Console & GA4 (SEO)", icon: Search, status: seo.data, waitingLabel: "Waiting for keys" },
  ];

  return (
    <div className="grid gap-3 md:grid-cols-3">
      {tiles.map((t) => {
        if (!t.status) return <Skeleton key={t.key} className="h-[84px] w-full" />;
        const st = stateOf(t.status, t.waitingLabel);
        const c = t.status.connection;
        return (
          <a
            key={t.key}
            href={t.anchor}
            className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3 transition-colors hover:bg-secondary/60"
          >
            <span className="flex items-center gap-2">
              <span className="grid size-7 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
                <t.icon className="size-4" />
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{t.label}</span>
            </span>
            <span className="flex flex-wrap items-center gap-2">
              <Badge tone={st.tone} icon={st.icon}>
                {st.label}
              </Badge>
              <span className="min-w-0 truncate text-xs text-muted-foreground">
                {c ? `${c.email ?? "Google account"} · refreshed ${fmtAgo(c.lastSyncAt)}` : "Not signed in to Google"}
              </span>
            </span>
          </a>
        );
      })}
    </div>
  );
}
