"use client";

import { useQuery } from "@tanstack/react-query";
import { ads } from "@/lib/api/resources/ads";
import { gbp } from "@/lib/api/resources/gbp";
import { queryKeys } from "@/lib/query/query-keys";
import type { ApiError } from "@/lib/api/client";
import { useGbpStatus } from "@/features/gbp/api";
import { useAdsStatus } from "@/features/ads/api";
import { useIntegrations } from "@/features/settings/api";
import { useDataQuality } from "@/features/merchants/api/data-quality.queries";
import { useTicketCounts } from "@/features/tickets/api";
import type { Overview } from "@/features/gbp/types";
import type { Portfolio } from "@/features/ads/types";
import { useRangeDays, windowEnding, type Window } from "./range";

const STALE = 5 * 60_000;

/**
 * Every live read the Command Center needs, fetched once and shared through
 * the TanStack Query cache (the GBP and Ads pages reuse the same keys).
 *
 *   GBP     /gbp/status → /gbp/overview for the window ending on its latest day
 *   Ads     /ads/status → /ads/portfolio for that window and the one before
 *   Others  /settings/integrations · /profiling/data-quality · /ops/tickets/counts
 *
 * Each source fails on its own; a missing module only blanks its own cards.
 */
export function useLiveSources() {
  const days = useRangeDays();

  const gbpStatus = useGbpStatus();
  const gbpEnd = gbpStatus.data?.dataThrough ?? null;
  const gbpWin: Window | null = gbpEnd ? windowEnding(gbpEnd, days) : null;
  const gbpQ = gbpWin ? { start: gbpWin.start, end: gbpWin.end } : {};
  const gbpOverview = useQuery<Overview, ApiError>({
    queryKey: queryKeys.gbp.overview(gbpQ),
    queryFn: () => gbp.overview(gbpQ),
    enabled: !!gbpWin,
    staleTime: STALE,
  });

  const adsStatus = useAdsStatus();
  const adsEnd = adsStatus.data?.dataThrough ?? null;
  const adsWin: Window | null = adsEnd ? windowEnding(adsEnd, days) : null;
  const adsQ = adsWin ? { start: adsWin.start, end: adsWin.end } : {};
  const adsPrevQ = adsWin ? { start: adsWin.prevStart, end: adsWin.prevEnd } : {};
  const adsNow = useQuery<Portfolio, ApiError>({
    queryKey: queryKeys.ads.portfolio(adsQ),
    queryFn: () => ads.portfolio(adsQ),
    enabled: !!adsWin,
    staleTime: STALE,
  });
  const adsPrev = useQuery<Portfolio, ApiError>({
    queryKey: queryKeys.ads.portfolio(adsPrevQ),
    queryFn: () => ads.portfolio(adsPrevQ),
    enabled: !!adsWin,
    staleTime: STALE,
  });

  const integrations = useIntegrations();
  const dataQuality = useDataQuality({ staleTime: STALE });
  const ticketOpts = { staleTime: 60_000 } as const;
  const ticketsOpen = useTicketCounts({ view: "open" }, ticketOpts);
  const ticketsOverdue = useTicketCounts({ view: "open", overdue: true }, ticketOpts);
  const ticketsSla = useTicketCounts({ view: "open", slaBreached: true }, ticketOpts);

  // "Loading" = a source we expect data from hasn't answered yet.
  const loading =
    gbpStatus.isPending ||
    adsStatus.isPending ||
    (!!gbpWin && gbpOverview.isPending) ||
    (!!adsWin && (adsNow.isPending || adsPrev.isPending));

  return {
    days,
    loading,
    gbp: { status: gbpStatus.data, overview: gbpWin ? gbpOverview.data : undefined, window: gbpWin, error: gbpStatus.error ?? gbpOverview.error },
    ads: {
      status: adsStatus.data,
      now: adsWin ? adsNow.data : undefined,
      prev: adsWin ? adsPrev.data : undefined,
      window: adsWin,
      error: adsStatus.error ?? adsNow.error,
    },
    integrations: integrations.data,
    dataQuality: dataQuality.data,
    tickets: {
      open: ticketsOpen.data?.total,
      overdue: ticketsOverdue.data?.total,
      slaBreached: ticketsSla.data?.total,
    },
  };
}

export type LiveSources = ReturnType<typeof useLiveSources>;
