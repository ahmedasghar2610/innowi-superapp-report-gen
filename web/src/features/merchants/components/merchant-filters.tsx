"use client";

import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { Button, Select } from "@/components/ui";
import { ACCOUNT_HEALTH, MERCHANT_ACCOUNT_STATUS, MERCHANT_SUBSCRIPTION_STATUS } from "@/features/merchants/types";
import type { AccountHealth, MerchantAccountStatus, MerchantSubscriptionStatus } from "@/features/merchants/types";
import { MERCHANT_STATUS_LABEL } from "@/features/churn/labels";
import { accountHealth as healthLabels, subscriptionStatus as statusLabels } from "@/lib/enums";
import { useAccountManagers } from "@/features/merchants/api";
import { MERCHANT_SOURCES, SOURCE_LABEL, SOURCE_NOT_RECORDED } from "@/features/sources/labels";

interface MerchantFiltersProps {
  search: string;
  health: AccountHealth | "";
  /** Account manager id filter ("" = all). */
  accountManagerId: string;
  /** Subscription status filter ("" = all). */
  status: MerchantSubscriptionStatus | "";
  /** Account lifecycle filter ("" = everything but churned, "ALL" = everything). */
  account: MerchantAccountStatus | "ALL" | "";
  /** Where the record came from ("" = any, "NONE" = not recorded). */
  source: string;
  hasActiveFilters: boolean;
  onSearchChange: (value: string) => void;
  onHealthChange: (value: AccountHealth | "") => void;
  onAccountManagerChange: (value: string) => void;
  onStatusChange: (value: MerchantSubscriptionStatus | "") => void;
  onAccountChange: (value: MerchantAccountStatus | "ALL" | "") => void;
  onSourceChange: (value: string) => void;
  onClear: () => void;
}

/** Search (debounced) + Account Health + Account Manager filters + Clear. */
export function MerchantFilters({
  search,
  health,
  accountManagerId,
  status,
  account,
  source,
  hasActiveFilters,
  onSearchChange,
  onHealthChange,
  onAccountManagerChange,
  onStatusChange,
  onAccountChange,
  onSourceChange,
  onClear,
}: MerchantFiltersProps) {
  // Small, rarely-changing list; cached 5 min by the hook. While it loads the
  // select still renders so the layout doesn't jump.
  const { data: managers } = useAccountManagers();
  const [term, setTerm] = useState(search);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep the input in sync when the URL changes externally (e.g. Clear).
  useEffect(() => setTerm(search), [search]);

  const handleTerm = (value: string) => {
    setTerm(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => onSearchChange(value.trim()), 300);
  };

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative w-full max-w-[280px]">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={term}
          onChange={(e) => handleTerm(e.target.value)}
          placeholder="Search by name or ID…"
          aria-label="Search merchants by name or Merchant ID"
          className="h-7 w-full rounded-sm border border-border bg-background pl-8 pr-3 text-xs font-medium leading-4 text-foreground placeholder:font-normal placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent"
        />
      </div>

      <Select
        aria-label="Filter by account health"
        value={health}
        onChange={(e) => onHealthChange(e.target.value as AccountHealth | "")}
        className="h-7 w-[150px] rounded-sm text-xs font-medium"
      >
        <option value="">All health</option>
        {ACCOUNT_HEALTH.map((h) => (
          <option key={h} value={h}>
            {healthLabels[h]?.label ?? h}
          </option>
        ))}
      </Select>

      <Select
        aria-label="Filter by account status"
        value={account}
        onChange={(e) => onAccountChange(e.target.value as MerchantAccountStatus | "ALL" | "")}
        className="h-7 w-[160px] rounded-sm text-xs font-medium"
      >
        <option value="">Current accounts</option>
        <option value="ALL">All incl. churned</option>
        {MERCHANT_ACCOUNT_STATUS.map((s) => (
          <option key={s} value={s}>
            {MERCHANT_STATUS_LABEL[s]}
          </option>
        ))}
      </Select>

      <Select
        aria-label="Filter by how it was added"
        value={source}
        onChange={(e) => onSourceChange(e.target.value)}
        className="h-7 w-[170px] rounded-sm text-xs font-medium"
      >
        <option value="">Added via: any</option>
        {MERCHANT_SOURCES.map((s) => (
          <option key={s} value={s}>
            {SOURCE_LABEL[s]}
          </option>
        ))}
        <option value={SOURCE_NOT_RECORDED}>Not recorded</option>
      </Select>

      <Select
        aria-label="Filter by subscription status"
        value={status}
        onChange={(e) => onStatusChange(e.target.value as MerchantSubscriptionStatus | "")}
        className="h-7 w-[160px] rounded-sm text-xs font-medium"
      >
        <option value="">All statuses</option>
        {MERCHANT_SUBSCRIPTION_STATUS.map((s) => (
          <option key={s} value={s}>
            {statusLabels[s]?.label ?? s}
          </option>
        ))}
      </Select>

      <Select
        aria-label="Filter by account manager"
        value={accountManagerId}
        onChange={(e) => onAccountManagerChange(e.target.value)}
        className="h-7 w-[180px] rounded-sm text-xs font-medium"
      >
        <option value="">All managers</option>
        {(managers ?? []).map((am) => (
          <option key={am.id} value={am.id}>
            {am.name}
            {am.merchantCount ? ` (${am.merchantCount})` : ""}
          </option>
        ))}
      </Select>

      {hasActiveFilters && (
        <Button variant="ghost" size="sm" onClick={onClear}>
          <X className="size-4" />
          Clear
        </Button>
      )}
    </div>
  );
}
