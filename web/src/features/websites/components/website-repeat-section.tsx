"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui";
import type { WebsiteRepeat, WebsiteRepeatRow } from "../types";
import { WebsiteFormField } from "./website-form-field";

interface WebsiteRepeatSectionProps {
  repeat: WebsiteRepeat;
  rows: WebsiteRepeatRow[];
  errors: Record<string, string>;
  onChange: (path: string, value: string) => void;
  onAddRow: (key: string) => void;
  onRemoveRow: (key: string, index: number) => void;
  onNotice?: (message: string) => void;
}

/**
 * A repeatable block — menu items, selling points, reviews. Each row is its own
 * bordered card so it reads as a unit, with a remove button once the row count
 * is above the schema's minimum.
 */
export function WebsiteRepeatSection({
  repeat,
  rows,
  errors,
  onChange,
  onAddRow,
  onRemoveRow,
  onNotice,
}: WebsiteRepeatSectionProps) {
  return (
    <div className="flex flex-col gap-2.5 sm:col-span-2">
      {rows.map((row, index) => (
        <div key={index} className="rounded-[var(--radius-card)] border border-border bg-card p-3.5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {repeat.itemLabel} {index + 1}
            </span>
            {rows.length > repeat.min && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove ${repeat.itemLabel.toLowerCase()} ${index + 1}`}
                className="text-muted-foreground hover:text-text-destructive"
                onClick={() => onRemoveRow(repeat.key, index)}
              >
                <Trash2 className="size-4" />
              </Button>
            )}
          </div>

          <div className="grid grid-cols-1 gap-x-4 gap-y-3.5 sm:grid-cols-2">
            {repeat.fields.map((field) => {
              const path = `${repeat.key}.${index}.${field.key}`;
              return (
                <WebsiteFormField
                  key={path}
                  field={field}
                  path={path}
                  value={row[field.key] ?? ""}
                  error={errors[path]}
                  onChange={onChange}
                  onNotice={onNotice}
                />
              );
            })}
          </div>
        </div>
      ))}

      <div>
        <Button variant="outline" size="sm" onClick={() => onAddRow(repeat.key)}>
          <Plus className="size-4" />
          {repeat.addLabel}
        </Button>
      </div>
    </div>
  );
}
