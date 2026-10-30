"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DEFAULT_PAGE_SIZE, PAGE_SIZE_OPTIONS } from "@/lib/constants";
import {
  ACCOUNT_HEALTH,
  MERCHANT_ACCOUNT_STATUS,
  MERCHANT_SORT_BY,
  MERCHANT_SUBSCRIPTION_STATUS,
  SORT_ORDER,
} from "@/features/merchants/types";
import { MERCHANT_SOURCES, SOURCE_NOT_RECORDED } from "@/features/sources/labels";
import type {
  AccountHealth,
  MerchantAccountStatus,
  MerchantListQuery,
  MerchantSortBy,
  MerchantSubscriptionStatus,
  SortOrder,
} from "@/features/merchants/types";

/**
 * The Merchants list state lives in the URL (`/merchants?page=2&q=kabob&…`), so
 * it is shareable and survives back/forward. This hook parses the search params
 * into a typed shape and returns a setter that writes them back (resetting to
 * page 1 whenever a filter/search/sort changes).
 */
export interface MerchantParamsState {
  page: number;
  q: string;
  health: AccountHealth | "";
  /** Account manager id, or "" for all. */
  am: string;
  /** Subscription (package) status, or "" for all. */
  status: MerchantSubscriptionStatus | "";
  /** Account lifecycle: "" = every account except churned, "ALL" = everything, or one status. */
  acct: MerchantAccountStatus | "ALL" | "";
  /** Where the record came from (a source key, "NONE" = not recorded), or "" for all. */
  src: string;
  /** Page size — one of PAGE_SIZE_OPTIONS. */
  limit: number;
  sortBy: MerchantSortBy;
  order: SortOrder;
}

const DEFAULT_SORT: MerchantSortBy = "createdAt";
const DEFAULT_ORDER: SortOrder = "desc";

function parse(sp: URLSearchParams): MerchantParamsState {
  const pageRaw = Number(sp.get("page"));
  const limitRaw = Number(sp.get("limit"));
  const health = sp.get("health") ?? "";
  const status = sp.get("status") ?? "";
  const acct = sp.get("acct") ?? "";
  const src = sp.get("src") ?? "";
  const sortBy = sp.get("sort") ?? "";
  const order = sp.get("order") ?? "";
  return {
    page: Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1,
    q: sp.get("q") ?? "",
    am: sp.get("am") ?? "",
    status: (MERCHANT_SUBSCRIPTION_STATUS as readonly string[]).includes(status)
      ? (status as MerchantSubscriptionStatus)
      : "",
    src: src === SOURCE_NOT_RECORDED || (MERCHANT_SOURCES as readonly string[]).includes(src) ? src : "",
    acct: acct === "ALL" || (MERCHANT_ACCOUNT_STATUS as readonly string[]).includes(acct) ? (acct as MerchantAccountStatus | "ALL") : "",
    limit: (PAGE_SIZE_OPTIONS as readonly number[]).includes(limitRaw) ? limitRaw : DEFAULT_PAGE_SIZE,
    health: (ACCOUNT_HEALTH as readonly string[]).includes(health) ? (health as AccountHealth) : "",
    sortBy: (MERCHANT_SORT_BY as readonly string[]).includes(sortBy) ? (sortBy as MerchantSortBy) : DEFAULT_SORT,
    order: (SORT_ORDER as readonly string[]).includes(order) ? (order as SortOrder) : DEFAULT_ORDER,
  };
}

export function useMerchantQueryParams() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const params = useMemo(() => parse(new URLSearchParams(searchParams.toString())), [searchParams]);

  /** Merge a patch into the URL. Any change other than `page` resets to page 1. */
  const setParams = useCallback(
    (patch: Partial<MerchantParamsState>) => {
      const next = { ...params, ...patch };
      if (!("page" in patch)) next.page = 1;

      const sp = new URLSearchParams();
      if (next.page > 1) sp.set("page", String(next.page));
      if (next.q) sp.set("q", next.q);
      if (next.health) sp.set("health", next.health);
      if (next.am) sp.set("am", next.am);
      if (next.status) sp.set("status", next.status);
      if (next.acct) sp.set("acct", next.acct);
      if (next.src) sp.set("src", next.src);
      if (next.limit !== DEFAULT_PAGE_SIZE) sp.set("limit", String(next.limit));
      if (next.sortBy !== DEFAULT_SORT) sp.set("sort", next.sortBy);
      if (next.order !== DEFAULT_ORDER) sp.set("order", next.order);

      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  /** The params mapped to the API query (empty strings dropped). */
  const apiQuery: MerchantListQuery = useMemo(
    () => ({
      page: params.page,
      limit: params.limit,
      search: params.q || undefined,
      accountHealth: params.health || undefined,
      accountManagerId: params.am || undefined,
      subscriptionStatus: params.status || undefined,
      status: params.acct || undefined,
      source: params.src || undefined,
      sortBy: params.sortBy,
      order: params.order,
    }),
    [params],
  );

  const hasActiveFilters = Boolean(params.q || params.health || params.am || params.status || params.acct || params.src);

  return { params, setParams, apiQuery, hasActiveFilters };
}
