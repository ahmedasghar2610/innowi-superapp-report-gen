import { TriangleAlert, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Button } from "./button";
import { ApiError } from "@/lib/api/errors";

interface ErrorStateProps {
  title?: string;
  description?: string;
  /** If an ApiError is passed, its message is used when `description` is absent. */
  error?: unknown;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}

function messageFrom(error: unknown): string | undefined {
  if (error instanceof ApiError) return error.messages.join(" · ");
  if (error instanceof Error) return error.message;
  return undefined;
}

/** Inline error surface with an optional retry action. */
export function ErrorState({
  title = "Something went wrong",
  description,
  error,
  onRetry,
  retryLabel = "Try again",
  className,
}: ErrorStateProps) {
  const desc = description ?? messageFrom(error) ?? "The request could not be completed. Please try again.";
  return (
    <div className={cn("flex flex-col items-center px-5 py-12 text-center", className)} role="alert">
      <div className="mb-3.5 grid size-12 place-items-center rounded-[13px] bg-destructive-subtle text-destructive">
        <TriangleAlert className="size-6" aria-hidden />
      </div>
      <p className="text-base font-semibold text-foreground">{title}</p>
      <p className="mt-1 max-w-sm text-table text-muted-foreground">{desc}</p>
      {onRetry && (
        <Button variant="outline" onClick={onRetry} className="mt-4">
          <RotateCw className="size-4" />
          {retryLabel}
        </Button>
      )}
    </div>
  );
}
