"use client";

import { useState } from "react";
import { TriangleAlert, ChevronDown, FileText, ShieldCheck } from "lucide-react";
import { Badge, Card, EmptyState, ErrorState, SectionHead, Skeleton } from "@/components/ui";
import { useProfileFields } from "@/features/merchants/api";
import { cn } from "@/lib/utils/cn";
import type { ProfileField, ProfileFieldGroup } from "@/features/merchants/types";
import { OutstandingItemsCard } from "./outstanding-items-card";
import { SchemaField } from "./schema-field";

/** Display order for sections — mirrors the backend registry's group order. */
const GROUP_ORDER: ProfileFieldGroup[] = [
  "Restaurant Information",
  "Business & Service",
  "Digital Profiles",
  "Marketing",
  "Internal / Ops",
];

/**
 * Profile tab (route: /merchants/[merchantId]/profile). Renders the server-driven
 * field registry: it fetches GET /merchants/:id/fields and maps each field to a
 * <SchemaField>, so the UI is entirely defined by the backend — add or reorder a
 * field there and it appears here with the right editor, grouping and completion
 * math, with no frontend change.
 *
 * The response also carries the full completeness object (API §4a.1), which
 * feeds the outstanding-items card. This tab shows *what is missing* (PROF-03);
 * the percentage itself (PROF-02) belongs to the workspace card above and is
 * deliberately not repeated here.
 *
 * The Google Ads / Meta Ads budgets are ordinary fields in the Marketing
 * section, not a separate read-only stat row. They are master fields the Ads
 * modules consume (PRD Appendix C-6 / ADS-02), which is a reason to annotate
 * them — the registry supplies that note — not a reason to give them a second,
 * uneditable representation. One field, one place, editable and audited like
 * every other.
 */
export function ProfilePanel({ merchantId }: { merchantId: string }) {
  const { data, isPending, isError, error, refetch } = useProfileFields(merchantId);

  if (isPending) return <ProfileSkeleton />;

  if (isError) {
    return (
      <Card>
        <ErrorState title="Couldn't load the profile" error={error} onRetry={() => refetch()} />
      </Card>
    );
  }

  const { data: fields, completion } = data;

  if (fields.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={FileText}
          title="No profile fields"
          description="The field registry returned no fields for this merchant."
        />
      </Card>
    );
  }

  const groups = groupFields(fields);

  return (
    // Command Center layout: content column + a sticky rail for "what needs
    // attention" (the outstanding-items card), so the fields stay the focus.
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px] xl:items-start">
      <div className="flex flex-col gap-6">
        {groups.map(([group, groupFields]) => (
          <FieldSection key={group} group={group} fields={groupFields} merchantId={merchantId} />
        ))}
      </div>
      <aside className="flex flex-col gap-3 xl:sticky xl:top-6">
        <SectionHead title="Needs attention" as="h2" />
        <OutstandingItemsCard merchantId={merchantId} completeness={completion} />
      </aside>
    </div>
  );
}

/* ---- Grouped sections ----------------------------------------------------- */

function groupFields(fields: ProfileField[]): [ProfileFieldGroup, ProfileField[]][] {
  const byGroup = new Map<ProfileFieldGroup, ProfileField[]>();
  for (const field of fields) {
    const list = byGroup.get(field.group) ?? [];
    list.push(field);
    byGroup.set(field.group, list);
  }
  return GROUP_ORDER.filter((g) => byGroup.has(g)).map((g) => [g, byGroup.get(g)!]);
}

function FieldSection({
  group,
  fields,
  merchantId,
}: {
  group: ProfileFieldGroup;
  fields: ProfileField[];
  merchantId: string;
}) {
  const [open, setOpen] = useState(true);
  const verified = fields.filter((f) => f.verified).length;
  const missingRequired = fields.filter((f) => f.required && (f.value === null || f.value === "")).length;

  const allVerified = verified === fields.length && fields.length > 0;
  return (
    <section className="flex flex-col gap-3" aria-label={group}>
      {/* Section head (Command Center): title + status chips + collapse toggle. */}
      <div className="flex flex-wrap items-center gap-2.5">
        <h2 className="text-base font-semibold leading-6 text-foreground">{group}</h2>
        {missingRequired > 0 && (
          <Badge tone="warning" icon={TriangleAlert}>
            {missingRequired} missing
          </Badge>
        )}
        <Badge tone={allVerified ? "success" : "neutral"} icon={ShieldCheck}>
          {verified} of {fields.length} verified
        </Badge>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={open ? `Collapse ${group}` : `Expand ${group}`}
          className="ml-auto grid size-7 place-items-center rounded-sm text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <ChevronDown className={cn("size-4 transition-transform", !open && "-rotate-90")} />
        </button>
      </div>

      {open && (
        <Card className="overflow-hidden p-0">
          <div className="divide-y divide-border">
            {fields.map((field) => (
              <SchemaField key={field.key} merchantId={merchantId} field={field} />
            ))}
          </div>
        </Card>
      )}
    </section>
  );
}

/* ---- Skeleton --------------------------------------------------------------- */

function ProfileSkeleton() {
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px] xl:items-start">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2.5">
          <Skeleton className="h-5 w-44" />
          <Skeleton className="h-[22px] w-24 rounded-full" />
        </div>
        <Card className="overflow-hidden p-0">
          <div className="divide-y divide-border">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3.5">
                <Skeleton className="h-3.5 w-40 sm:w-52" />
                <Skeleton className="h-3.5 flex-1" />
                <Skeleton className="h-[22px] w-20 rounded-full" />
              </div>
            ))}
          </div>
        </Card>
      </div>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-5 w-32" />
        <Card className="px-4 py-3.5">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="mt-1.5 h-3 w-56" />
          <Skeleton className="mt-3 h-2 w-full rounded-full" />
        </Card>
      </div>
    </div>
  );
}
