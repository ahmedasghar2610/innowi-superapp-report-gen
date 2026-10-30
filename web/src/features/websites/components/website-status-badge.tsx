"use client";

/*
 * Website status (Central PRD WEB-06): eight lifecycle states. Only Live and
 * Update required are public at the site's URL; everything else shows a
 * "Coming soon" page to visitors (staff can open a preview link).
 *
 * `WebsiteStatusBadge` is read-only. To change a status use
 * `WebsiteStatusControl` (website-status-control.tsx), which adds the publish
 * permission check and the confirmation.
 */

import {
  CircleCheck,
  CircleDashed,
  CircleOff,
  Clock,
  FileQuestion,
  Hammer,
  Map,
  RefreshCw,
} from "lucide-react";
import { Badge, type BadgeTone } from "@/components/ui";
import type { WebsiteStatus } from "../types";

export interface StatusMeta {
  label: string;
  tone: BadgeTone;
  icon: typeof Clock;
  /** One line for menus and confirmations. */
  hint: string;
  /** Chip colours, reused by the editable variant. */
  chip: string;
}

const NEUTRAL = "bg-muted text-foreground border-border";
const WARN = "bg-warning-soft text-warning-text border-[color-mix(in_srgb,var(--warning)_35%,transparent)]";
const OK = "bg-success-subtle text-success-subtle-foreground border-[color-mix(in_srgb,var(--success)_35%,transparent)]";
const DANGER = "bg-destructive-subtle text-text-destructive border-[color-mix(in_srgb,var(--destructive)_35%,transparent)]";

export const WEBSITE_STATUS_META: Record<WebsiteStatus, StatusMeta> = {
  not_started: { label: "Not started", tone: "neutral", icon: CircleDashed, chip: NEUTRAL, hint: "Nothing built yet." },
  in_creation: { label: "In creation", tone: "neutral", icon: Hammer, chip: NEUTRAL, hint: "Being built — not public." },
  content_required: { label: "Content required", tone: "warning", icon: FileQuestion, chip: WARN, hint: "Waiting on content from the merchant." },
  content_map_required: { label: "Content map required", tone: "warning", icon: Map, chip: WARN, hint: "Paid site waiting on the SEO content map." },
  under_review: { label: "Under review", tone: "warning", icon: Clock, chip: WARN, hint: "Built — waiting for approval." },
  live: { label: "Live", tone: "success", icon: CircleCheck, chip: OK, hint: "Public at its URL." },
  update_required: { label: "Update required", tone: "warning", icon: RefreshCw, chip: WARN, hint: "Public, but needs changes." },
  inactive: { label: "Inactive", tone: "danger", icon: CircleOff, chip: DANGER, hint: "Taken offline — visitors see it's unavailable." },
};

/** Read-only status chip — icon + text, per the Brand Book's rule for status. */
export function WebsiteStatusBadge({ status }: { status: WebsiteStatus }) {
  const { label, tone, icon: Icon } = WEBSITE_STATUS_META[status] ?? WEBSITE_STATUS_META.in_creation;
  return (
    <Badge tone={tone} icon={Icon}>
      {label}
    </Badge>
  );
}
