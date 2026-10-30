"use client";

import { useMemo } from "react";
import { useAuditLogs } from "@/features/audit/queries";
import { useMerchants } from "@/features/merchants/api/merchants.queries";
import { useCan } from "@/features/auth/use-can";
import type { AuditLog } from "@/features/audit/types";

/**
 * "What Changed" from the audit log — every successful write made through
 * the API, newest first. The platform-wide log is admin-only
 * (AUDIT_LOG.md §5), so other roles get `allowed: false`.
 */
export interface LiveChange {
  id: string;
  action: "CREATE" | "UPDATE" | "DELETE";
  title: string;
  /** "status: In creation → Live" style lines, at most three. */
  details: string[];
  owner: string;
  when: string;
  module: string;
  merchant: string | null;
  href: string | null;
}

const ENTITY: Record<string, { label: string; module: string }> = {
  Website: { label: "Website", module: "Website" },
  AdsAccount: { label: "Ads account", module: "Ads" },
  GbpLocation: { label: "GBP listing", module: "GBP" },
  Merchant: { label: "Merchant", module: "Profiles" },
  Location: { label: "Location", module: "Profiles" },
  Contact: { label: "Contact", module: "Profiles" },
  Document: { label: "Document", module: "Profiles" },
  BrandAsset: { label: "Brand asset", module: "Profiles" },
  BrandProfile: { label: "Brand profile", module: "Profiles" },
  CateringProfile: { label: "Catering profile", module: "Profiles" },
  Competitor: { label: "Competitor", module: "Profiles" },
  Keyword: { label: "Keyword", module: "SEO" },
  Promotion: { label: "Promotion", module: "Profiles" },
  MerchantService: { label: "Service", module: "Profiles" },
  Subscription: { label: "Subscription", module: "Profiles" },
  Connection: { label: "Connection", module: "Profiles" },
  ProfileField: { label: "Profile field", module: "Profiles" },
  Ticket: { label: "Ticket", module: "Ops" },
  User: { label: "Team member", module: "Team" },
  AccountManager: { label: "Account manager", module: "Team" },
};

const NAME_KEYS = ["restaurantName", "name", "title", "businessName", "keyword", "label", "email", "key"];
const SKIP_FIELDS = new Set(["updatedAt", "createdAt", "version", "passwordHash", "id"]);

function nameOf(snap: Record<string, unknown> | null): string | null {
  if (!snap) return null;
  for (const k of NAME_KEYS) {
    const v = snap[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

const words = (k: string) => k.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").toLowerCase();
function show(v: unknown): string {
  if (v === null || v === undefined || v === "") return "empty";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "number") return v.toLocaleString("en-US");
  if (typeof v === "string") {
    const s = /^[A-Z][A-Z_]+$/.test(v) ? v.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : v;
    return s.length > 40 ? `${s.slice(0, 38)}…` : s;
  }
  return "updated";
}

function hrefFor(log: AuditLog): string | null {
  const id = log.entityId;
  if (log.action === "DELETE") return log.merchantId ? `/merchants/${log.merchantId}` : null;
  switch (log.entityType) {
    case "AdsAccount":
      return id ? `/ads/${id}` : "/ads";
    case "GbpLocation":
      return id ? `/web/gbp/${id}` : "/web/gbp";
    case "Website":
      return "/web/website";
    case "Ticket":
      return "/ops/tickets";
    default:
      return log.merchantId ? `/merchants/${log.merchantId}` : null;
  }
}

function toChange(log: AuditLog, merchants: Map<string, string>): LiveChange {
  const e = ENTITY[log.entityType] ?? { label: log.entityType.replace(/([a-z])([A-Z])/g, "$1 $2"), module: "Other" };
  const merchant = log.merchantId ? merchants.get(log.merchantId) ?? null : null;
  const name = nameOf(log.after) ?? nameOf(log.before);
  const subject = name && name !== merchant ? name : null;
  const verb = log.action === "CREATE" ? "added" : log.action === "DELETE" ? "removed" : "updated";
  const title = `${e.label} ${verb}${subject ? ` — ${subject}` : ""}`;
  const details: string[] = [];
  if (log.action === "UPDATE") {
    for (const f of log.changedFields.filter((f) => !SKIP_FIELDS.has(f))) {
      const b = log.before?.[f];
      const a = log.after?.[f];
      const scalar = (v: unknown) => v === null || ["string", "number", "boolean", "undefined"].includes(typeof v);
      details.push(scalar(b) && scalar(a) ? `${words(f)}: ${show(b)} → ${show(a)}` : `${words(f)} changed`);
      if (details.length === 3) break;
    }
    const more = log.changedFields.filter((f) => !SKIP_FIELDS.has(f)).length - details.length;
    if (more > 0) details.push(`+${more} more field${more === 1 ? "" : "s"}`);
  }
  return {
    id: log.id,
    action: log.action,
    title,
    details,
    owner: log.actorEmail ?? "System",
    when: log.createdAt,
    module: e.module,
    merchant,
    href: hrefFor(log),
  };
}

export function useLiveChanges(limit = 50) {
  const can = useCan();
  const allowed = can("audit.view");
  const logs = useAuditLogs({ limit, order: "desc", outcome: "SUCCESS" }, { enabled: allowed, staleTime: 60_000 });
  const merchants = useMerchants({ limit: 100 }, { enabled: allowed, staleTime: 5 * 60_000 });
  const changes = useMemo(() => {
    const names = new Map((merchants.data?.data ?? []).map((m) => [m.id, m.restaurantName]));
    return (logs.data?.data ?? []).map((l) => toChange(l, names));
  }, [logs.data, merchants.data]);
  return { allowed, loading: allowed && logs.isPending, error: logs.error, total: logs.data?.meta.total, changes };
}
