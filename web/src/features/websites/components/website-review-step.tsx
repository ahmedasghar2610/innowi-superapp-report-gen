"use client";

import { Badge, Button, Card } from "@/components/ui";
import { WEBSITE_CONTENT_STEPS } from "../data/website-form-steps";
import type { WebsiteFormStep, WebsiteValues } from "../types";
import { getRows, getString, stepProblems } from "../lib/website-values";
import { isUploadedImage } from "../api/client";

interface WebsiteReviewStepProps {
  values: WebsiteValues;
  /** Jump back to a step to fix something. */
  onEditStep: (stepId: string) => void;
}

/**
 * The final page: every answer laid out step by step, with a count of anything
 * still required and an Edit shortcut back to that step.
 */
export function WebsiteReviewStep({ values, onEditStep }: WebsiteReviewStepProps) {
  const totalMissing = WEBSITE_CONTENT_STEPS.reduce((n, step) => n + stepProblems(step, values).length, 0);

  return (
    <div className="flex flex-col gap-3">
      {totalMissing > 0 && (
        <p className="rounded-md border border-destructive-subtle bg-destructive-subtle px-3 py-2 text-table text-text-destructive">
          {totalMissing} required {totalMissing === 1 ? "field" : "fields"} still need filling in. Use the Edit links
          below.
        </p>
      )}

      {WEBSITE_CONTENT_STEPS.map((step) => (
        <ReviewBlock key={step.id} step={step} values={values} onEditStep={onEditStep} />
      ))}
    </div>
  );
}

function ReviewBlock({
  step,
  values,
  onEditStep,
}: {
  step: WebsiteFormStep;
  values: WebsiteValues;
  onEditStep: (stepId: string) => void;
}) {
  const missing = stepProblems(step, values).length;

  return (
    <Card>
      <div className="flex items-center gap-2.5 border-b border-border px-4 py-2.5">
        <h3 className="flex-1 text-sm font-semibold text-foreground">{step.title}</h3>
        {missing > 0 && <Badge tone="danger">{missing} to fix</Badge>}
        <Button variant="ghost" size="sm" onClick={() => onEditStep(step.id)}>
          Edit
        </Button>
      </div>

      <dl className="divide-y divide-border">
        {rowsFor(step, values).map(([label, value]) => (
          <div key={label} className="grid grid-cols-1 gap-0.5 px-4 py-2 sm:grid-cols-[minmax(0,200px)_1fr] sm:gap-3">
            <dt className="text-xs text-muted-foreground sm:pt-0.5">{label}</dt>
            <dd
              className={
                value ? "whitespace-pre-line break-words text-table text-foreground" : "text-table text-muted-foreground"
              }
            >
              {value || "Not set"}
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

/** Flatten one step's answers into label/value pairs for the summary table. */
function rowsFor(step: WebsiteFormStep, values: WebsiteValues): [string, string][] {
  const rows: [string, string][] = [];

  for (const entry of step.entries) {
    if (entry.kind === "group") continue;

    if (entry.kind === "repeat") {
      const filled = getRows(values, entry.key).filter((row) =>
        Object.values(row).some((v) => String(v ?? "").trim()),
      );
      rows.push([
        `${entry.itemLabel}s`,
        filled
          .map((row) => {
            const title = row.name || row.title || "(untitled)";
            return row.price ? `${title} — ${row.price}` : title;
          })
          .join("\n"),
      ]);
      continue;
    }

    const raw = getString(values, entry.key).trim();
    rows.push([
      entry.label,
      entry.type === "image" && isUploadedImage(raw)
        ? "(uploaded image)"
        : entry.key === "meta.jsonLd" || entry.key === "social.reviewsWidget"
          ? raw && "(set)"
          : raw,
    ]);
  }

  return rows;
}
