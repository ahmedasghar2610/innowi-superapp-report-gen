import { ArrowRight } from "lucide-react";
import type { AuditLog } from "@/features/audit/types";

/** Render any JSON scalar/array/object compactly for a diff row. */
function renderValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v || "(empty)";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") return String(v);
  return JSON.stringify(v);
}

/**
 * Before → after diff for one audit row. UPDATE shows only `changedFields`
 * (the backend already computed which top-level keys differ — AUDIT_LOG.md
 * §2); CREATE shows the full `after` snapshot; DELETE shows the full `before`
 * snapshot. A FAILURE outcome usually has no before/after to show.
 */
export function AuditDiff({ log }: { log: AuditLog }) {
  if (log.outcome === "FAILURE") {
    return (
      <p className="text-table text-muted-foreground">
        This write failed{log.errorMessage ? `: ${log.errorMessage}` : "."} No changes were made.
      </p>
    );
  }

  if (log.action === "CREATE") {
    return <SnapshotList title="Created with" snapshot={log.after} />;
  }

  if (log.action === "DELETE") {
    return <SnapshotList title="Deleted record" snapshot={log.before} />;
  }

  // UPDATE
  const fields = log.changedFields.length > 0 ? log.changedFields : Object.keys(log.after ?? {});
  if (fields.length === 0) {
    return <p className="text-table text-muted-foreground">No field-level changes recorded.</p>;
  }

  return (
    <div className="flex flex-col divide-y divide-border rounded-lg border border-border">
      {fields.map((key) => {
        const before = log.before?.[key];
        const after = log.after?.[key];
        return (
          <div key={key} className="flex flex-col gap-1 px-3.5 py-2.5">
            <span className="text-xs font-medium uppercase tracking-[0.04em] text-muted-foreground">{key}</span>
            <div className="flex flex-wrap items-center gap-2 text-table">
              <span className="rounded bg-destructive-subtle px-1.5 py-0.5 text-text-destructive line-through decoration-text-destructive/40">
                {renderValue(before)}
              </span>
              <ArrowRight className="size-4 text-muted-foreground" aria-hidden />
              <span className="rounded bg-success-subtle px-1.5 py-0.5 font-medium text-success-subtle-foreground">
                {renderValue(after)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SnapshotList({ title, snapshot }: { title: string; snapshot: Record<string, unknown> | null }) {
  const entries = Object.entries(snapshot ?? {}).filter(([, v]) => v !== null && v !== undefined && v !== "");
  if (entries.length === 0) {
    return <p className="text-table text-muted-foreground">No details recorded.</p>;
  }
  return (
    <div>
      <p className="mb-2 text-xs font-medium uppercase tracking-[0.04em] text-muted-foreground">{title}</p>
      <div className="flex flex-col divide-y divide-border rounded-lg border border-border">
        {entries.map(([key, value]) => (
          <div key={key} className="flex items-center justify-between gap-3 px-3.5 py-2 text-table">
            <span className="text-muted-foreground">{key}</span>
            <span className="max-w-[60%] truncate text-right font-medium text-foreground">{renderValue(value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
