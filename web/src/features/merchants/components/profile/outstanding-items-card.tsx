"use client";

import Link from "next/link";
import { CircleCheck, FileWarning, Plug, UserSearch, type LucideIcon } from "lucide-react";
import { Card } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import type {
  MissingItem,
  MissingItemArea,
  PendingConnection,
  ProfileCompleteness,
} from "@/features/merchants/types";

/**
 * PROF-03 — "Missing Information" and "Missing Files", plus the PROF-04
 * connections still pending.
 *
 * Deliberately carries **no percentage**. The score is the workspace card's job
 * (PROF-02), one screenful above; repeating it here is how the old UI ended up
 * showing a hardcoded 72% next to a computed number. This card answers the other
 * half of the requirement: not "how complete", but "what exactly is outstanding
 * and where do I go to fix it".
 *
 * Required items are listed before recommended ones because only required items
 * raise an alert; recommended ones just cost score.
 */
export function OutstandingItemsCard({
  merchantId,
  completeness,
}: {
  merchantId: string;
  completeness: ProfileCompleteness;
}) {
  const required = completeness.missingInformation.filter((i) => i.severity === "REQUIRED");
  const recommended = completeness.missingInformation.filter((i) => i.severity === "RECOMMENDED");
  const { missingFiles, pendingConnections } = completeness;

  const nothingOutstanding =
    required.length === 0 &&
    recommended.length === 0 &&
    missingFiles.length === 0 &&
    pendingConnections.length === 0;

  if (nothingOutstanding) {
    return (
      <Card className="px-4 py-3.5">
        <div className="flex items-center gap-2.5">
          <CircleCheck className="size-4 shrink-0 text-success" aria-hidden />
          <div>
            <h2 className="text-sm font-semibold leading-5 text-foreground">Nothing outstanding</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Every required field, file, contact and connection is recorded.
            </p>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pb-2.5 pt-3.5">
        <h2 className="text-sm font-semibold leading-5 text-foreground">What&rsquo;s outstanding</h2>
        <p className="text-xs text-muted-foreground">
          {completeness.fields.filled} of {completeness.fields.total} scored fields filled
        </p>
      </div>

      <div className="divide-y divide-border border-t border-border">
        <ItemGroup
          icon={UserSearch}
          title="Missing information"
          caption="Required — these raise an alert until captured."
          tone="required"
          items={required}
          merchantId={merchantId}
        />
        <ItemGroup
          icon={FileWarning}
          title="Missing files"
          caption="Brand assets the §6.2.5 requirement expects."
          tone="required"
          items={missingFiles}
          merchantId={merchantId}
        />
        <PendingConnectionsGroup merchantId={merchantId} connections={pendingConnections} />
        <ItemGroup
          icon={UserSearch}
          title="Recommended"
          caption="Not required — these only lower the completeness score."
          tone="recommended"
          items={recommended}
          merchantId={merchantId}
        />
      </div>
    </Card>
  );
}

/* ---- Groups ----------------------------------------------------------------- */

/** Each missing item deep-links to the tab that actually resolves it. */
const AREA_TAB: Record<MissingItemArea, string> = {
  PROFILE: "profile",
  FILES: "documents",
  CONTACTS: "contacts",
  LOCATIONS: "locations",
  CONNECTIONS: "connections",
  BRAND: "brand",
};

function ItemGroup({
  icon: Icon,
  title,
  caption,
  tone,
  items,
  merchantId,
}: {
  icon: LucideIcon;
  title: string;
  caption: string;
  tone: "required" | "recommended";
  items: MissingItem[];
  merchantId: string;
}) {
  if (items.length === 0) return null;

  return (
    <section className="px-4 py-3.5">
      <GroupHeading icon={Icon} title={title} caption={caption} count={items.length} tone={tone} />
      <ul className="mt-2.5 flex flex-wrap gap-1.5">
        {items.map((item) => (
          <li key={item.key}>
            <Link
              href={`/merchants/${merchantId}/${AREA_TAB[item.area]}`}
              scroll={false}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors",
                tone === "required"
                  ? "bg-warning-soft text-warning-text hover:brightness-95"
                  : "bg-muted text-foreground hover:bg-secondary",
              )}
              title={item.group ? `${item.group} · go to ${AREA_TAB[item.area]}` : `Go to ${AREA_TAB[item.area]}`}
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PendingConnectionsGroup({
  merchantId,
  connections,
}: {
  merchantId: string;
  connections: PendingConnection[];
}) {
  if (connections.length === 0) return null;

  const blocking = connections.filter((c) => c.blocking).length;

  return (
    <section className="px-4 py-3.5">
      <GroupHeading
        icon={Plug}
        title="Connections pending"
        caption={
          blocking > 0
            ? `${blocking} flagged go-live blocking — the service that depends on it cannot launch.`
            : "Access requested but not yet granted or verified."
        }
        count={connections.length}
        tone={blocking > 0 ? "required" : "recommended"}
      />
      <ul className="mt-2.5 flex flex-wrap gap-1.5">
        {connections.map((c) => (
          <li key={c.id}>
            <Link
              href={`/merchants/${merchantId}/connections`}
              scroll={false}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors",
                c.blocking
                  ? "bg-warning-soft text-warning-text hover:brightness-95"
                  : "bg-muted text-foreground hover:bg-secondary",
              )}
              title={`${c.criticality} · ${c.status}`}
            >
              {c.accessItem}
              <span className={cn("text-xs", c.blocking ? "opacity-70" : "text-muted-foreground")}>
                {humanizeStatus(c.status)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function GroupHeading({
  icon: Icon,
  title,
  caption,
  count,
  tone,
}: {
  icon: LucideIcon;
  title: string;
  caption: string;
  count: number;
  tone: "required" | "recommended";
}) {
  return (
    <div className="flex items-start gap-2">
      <Icon
        className={cn("mt-0.5 size-4 shrink-0", tone === "required" ? "text-warning-text" : "text-muted-foreground")}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-semibold leading-5 text-foreground">
          {title}
          <span className="ml-1.5 font-normal tabular-nums text-muted-foreground">{count}</span>
        </h3>
        <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{caption}</p>
      </div>
    </div>
  );
}

/** "NOT_REQUESTED" → "Not requested". */
function humanizeStatus(status: string): string {
  const lower = status.toLowerCase().replace(/_/g, " ");
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}
