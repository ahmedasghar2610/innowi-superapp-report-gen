import { cn } from "@/lib/utils/cn";

interface FieldProps {
  label?: string;
  htmlFor?: string;
  required?: boolean;
  hint?: string;
  error?: string;
  className?: string;
  children: React.ReactNode;
}

/**
 * Form-control wrapper: label (+ required marker), the control, and hint/error.
 * Pair with Input / Textarea / Select. Client validation mirrors the DTO rules
 * documented in API_REFERENCE.md; server 400s are surfaced through `error`.
 */
export function Field({ label, htmlFor, required, hint, error, className, children }: FieldProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label ? (
        <label htmlFor={htmlFor} className="flex items-center gap-1.5 text-sm font-medium text-foreground">
          {label}
          {required ? <span className="text-destructive">*</span> : null}
        </label>
      ) : null}
      {children}
      {error ? (
        <p className="text-sm text-text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-sm text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
