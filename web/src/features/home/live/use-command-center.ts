"use client";

import { useLiveSources } from "./sources";
import {
  integrationHealth,
  liveCollapsed,
  liveHealth,
  liveIssues,
  liveKpis,
  liveRecommendations,
  liveSummary,
  sampleFlags,
} from "./build";

/**
 * Everything the Command Center renders, built from live module data
 * (GBP, Google Ads, integrations, profiles, tickets). Sections a module
 * can't fill yet come back empty and the screen says so. The builders are
 * cheap, so this recomputes on every render rather than memoising.
 */
export function useCommandCenter() {
  const s = useLiveSources();
  {
    const { issues, opportunities } = liveIssues(s);
    const sample = sampleFlags(s);
    return {
      days: s.days,
      loading: s.loading,
      connected: {
        gbp: !!s.gbp.status && (s.gbp.status.locations.google > 0 || s.gbp.status.locations.demo > 0),
        ads: !!s.ads.status && (s.ads.status.accounts.google > 0 || s.ads.status.accounts.demo > 0 || s.ads.status.accounts.sheet > 0),
      },
      sample,
      windows: { gbp: s.gbp.window, ads: s.ads.window },
      integrations: integrationHealth(s),
      summary: liveSummary(s, issues),
      kpis: liveKpis(s),
      issues,
      opportunities,
      recommendations: liveRecommendations([...issues, ...opportunities]),
      health: liveHealth(s),
      collapsed: liveCollapsed(s, issues.length),
    };
  }
}

export type CommandCenter = ReturnType<typeof useCommandCenter>;
