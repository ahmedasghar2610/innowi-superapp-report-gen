"use client";

import { X } from "lucide-react";
import { Button, Field, Input, Select } from "@/components/ui";
import type { AuditAction, AuditOutcome, AuditLogQuery } from "@/features/audit/types";

const ACTIONS: AuditAction[] = ["CREATE", "UPDATE", "DELETE"];
const OUTCOMES: AuditOutcome[] = ["SUCCESS", "FAILURE"];

/** Common entity types the audit interceptor annotates (AUDIT_LOG.md §4). */
const ENTITY_TYPES = ["Merchant", "Contact", "Location", "Document", "MerchantService", "Connection", "ProfileField", "User"];

interface Filters {
  entityType: string;
  action: AuditAction | "";
  outcome: AuditOutcome | "";
  from: string;
  to: string;
}

export function AuditLogFilters({
  value,
  onChange,
}: {
  value: Filters;
  onChange: (patch: Partial<Filters>) => void;
}) {
  const hasActive = Boolean(value.entityType || value.action || value.outcome || value.from || value.to);

  return (
    <div className="mb-4 flex flex-wrap items-end gap-3">
      <Field label="Entity" className="w-[170px]">
        <Select value={value.entityType} onChange={(e) => onChange({ entityType: e.target.value })}>
          <option value="">All entities</option>
          {ENTITY_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Action" className="w-[140px]">
        <Select value={value.action} onChange={(e) => onChange({ action: e.target.value as AuditAction | "" })}>
          <option value="">All actions</option>
          {ACTIONS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Outcome" className="w-[140px]">
        <Select value={value.outcome} onChange={(e) => onChange({ outcome: e.target.value as AuditOutcome | "" })}>
          <option value="">All outcomes</option>
          {OUTCOMES.map((o) => (
            <option key={o} value={o}>
              {o === "SUCCESS" ? "Success" : "Failed"}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="From" className="w-[150px]">
        <Input type="date" value={value.from} onChange={(e) => onChange({ from: e.target.value })} />
      </Field>

      <Field label="To" className="w-[150px]">
        <Input type="date" value={value.to} onChange={(e) => onChange({ to: e.target.value })} />
      </Field>

      {hasActive && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange({ entityType: "", action: "", outcome: "", from: "", to: "" })}
        >
          <X className="size-4" />
          Clear
        </Button>
      )}
    </div>
  );
}

export type { Filters as AuditLogFilterState };

/** Local filter state → API query. Dates are sent as start/end-of-day UTC ISO. */
export function toAuditLogQuery(f: Filters): Partial<AuditLogQuery> {
  return {
    entityType: f.entityType || undefined,
    action: f.action || undefined,
    outcome: f.outcome || undefined,
    from: f.from ? new Date(`${f.from}T00:00:00.000Z`).toISOString() : undefined,
    to: f.to ? new Date(`${f.to}T23:59:59.999Z`).toISOString() : undefined,
  };
}
