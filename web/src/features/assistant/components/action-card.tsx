"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Check, CircleSlash, Clock, Copy, KeyRound, Loader2, ShieldCheck, Trash2, Wand2, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { isApiError } from "@/lib/api/errors";
import { cancelAction, confirmAction, getAction, type Revealed } from "../api";
import type { ActionCard as Card } from "../types";

const STATUS: Record<Card["status"], { label: string; tone: string; icon: typeof Check }> = {
  pending: { label: "Waiting for you", tone: "text-primary", icon: ShieldCheck },
  running: { label: "Working…", tone: "text-primary", icon: Loader2 },
  done: { label: "Done", tone: "text-success-subtle-foreground", icon: Check },
  partial: { label: "Partly done", tone: "text-warning-text", icon: AlertTriangle },
  failed: { label: "Didn't work", tone: "text-text-destructive", icon: AlertTriangle },
  interrupted: { label: "Stopped part-way — see below what went through", tone: "text-warning-text", icon: AlertTriangle },
  cancelled: { label: "Cancelled", tone: "text-muted-foreground", icon: CircleSlash },
  expired: { label: "Expired — ask again for a fresh one", tone: "text-muted-foreground", icon: Clock },
};

/**
 * A change the assistant proposed. Nothing has happened yet: it waits for the
 * person to click Confirm, and the API then carries it out as them, with the
 * same checks and audit log as the screens. A delete asks a second time, with
 * the second button in a different place and briefly disabled, so a
 * double-click can't confirm it.
 */
export function ActionCardView({ action, onChange }: { action: Card; onChange: (next: Card) => void }) {
  const [busy, setBusy] = useState<"confirm" | "cancel" | null>(null);
  const [armed, setArmed] = useState(false);
  const [armReady, setArmReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // Show-once values from the confirm response (kept only in this tab, never saved).
  const [revealed, setRevealed] = useState<Revealed[]>([]);

  // Expiry is checked by the server too; this just greys the buttons out on time.
  useEffect(() => {
    if (action.status !== "pending" || !action.expiresAt) return;
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, [action.status, action.expiresAt]);

  // The second (destructive) confirm becomes clickable after a moment and disarms itself.
  useEffect(() => {
    if (!armed) return;
    setArmReady(false);
    const ready = setTimeout(() => setArmReady(true), 900);
    const reset = setTimeout(() => setArmed(false), 8_000);
    return () => {
      clearTimeout(ready);
      clearTimeout(reset);
    };
  }, [armed]);

  const expiredLocally =
    action.status === "pending" && !!action.expiresAt && new Date(action.expiresAt).getTime() <= now;
  const status: Card["status"] = expiredLocally ? "expired" : action.status;
  const s = STATUS[status] ?? STATUS.pending;
  const Icon = s.icon;
  const pending = status === "pending";
  const results = action.results ?? [];
  const perItem = results.length > 0 && results.length === action.items.length;
  const count = action.steps ?? action.items.length;

  async function run(kind: "confirm" | "cancel") {
    setBusy(kind);
    setError(null);
    try {
      if (kind === "confirm") {
        const r = await confirmAction(action.id);
        setRevealed(r.revealed ?? []);
        onChange(r.action);
      } else {
        onChange(await cancelAction(action.id));
      }
    } catch (e) {
      setError(isApiError(e) ? e.message : "That didn't go through. Try again.");
      // e.g. it expired or another tab already confirmed it: show what it is now.
      getAction(action.id).then(onChange).catch(() => {});
    } finally {
      setBusy(null);
      setArmed(false);
    }
  }

  return (
    <div
      className={cn(
        "sa-rise my-3 overflow-hidden rounded-[var(--radius-xl)] border bg-card shadow-[0_1px_2px_rgba(16,24,40,0.04)]",
        pending && action.destructive ? "border-destructive/40" : pending ? "border-primary-border" : "border-border",
      )}
    >
      <div className="flex items-start gap-3 px-4 pt-3.5">
        <span
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded-lg",
            action.destructive ? "bg-destructive-subtle text-text-destructive" : "bg-primary-subtle text-primary",
          )}
          aria-hidden
        >
          {action.destructive ? <Trash2 className="size-4" /> : <Wand2 className="size-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-foreground">{action.title}</div>
          <div className={cn("mt-0.5 inline-flex items-center gap-1 text-xs font-medium", s.tone)}>
            <Icon className={cn("size-3.5", status === "running" && "animate-spin")} aria-hidden />
            {s.label}
            {pending && <span className="font-normal text-muted-foreground"> · nothing changes until you confirm</span>}
          </div>
        </div>
      </div>

      <ul className="mx-4 mt-3 max-h-72 divide-y divide-border overflow-y-auto rounded-[var(--radius-lg)] border border-border text-sm">
        {action.items.map((item, i) => {
          const r = perItem ? results[i] : undefined;
          return (
            <li key={i} className="flex items-start gap-2 px-3 py-2">
              {r ? (
                r.ok ? (
                  <Check className="mt-0.5 size-4 shrink-0 text-success" aria-label="done" />
                ) : (
                  <X className="mt-0.5 size-4 shrink-0 text-text-destructive" aria-label="failed" />
                )
              ) : (
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-muted-foreground/50" aria-hidden />
              )}
              <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-foreground">
                {item}
                {r && !r.ok && r.message && <span className="block text-xs text-text-destructive">{r.message}</span>}
              </span>
            </li>
          );
        })}
      </ul>

      {/* Results that don't line up with the item list (one call for a multi-line change). */}
      {!perItem && results.length > 0 && (
        <ul className="mx-4 mt-2 space-y-1 text-xs">
          {results.map((r, i) => (
            <li key={i} className={cn("flex items-start gap-1.5", r.ok ? "text-success-subtle-foreground" : "text-text-destructive")}>
              {r.ok ? <Check className="mt-0.5 size-3.5 shrink-0" aria-hidden /> : <X className="mt-0.5 size-3.5 shrink-0" aria-hidden />}
              <span>
                {r.ok ? "Saved" : r.message ?? "Failed"}
                {r.label ? ` · ${r.label}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}

      {revealed.length > 0 && <RevealedValues values={revealed} />}

      {pending ? (
        armed ? (
          <div className="mx-4 my-3 flex flex-wrap items-center gap-2 rounded-[var(--radius-lg)] bg-destructive-subtle px-3 py-2.5">
            <span className="mr-auto text-sm text-text-destructive">
              Delete {count} for good? This can&apos;t be undone.
            </span>
            <button
              type="button"
              onClick={() => run("confirm")}
              disabled={!armReady || busy !== null}
              className="inline-flex items-center gap-1.5 rounded-md bg-destructive px-3 py-1.5 text-sm font-semibold text-destructive-foreground shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy === "confirm" && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
              {busy === "confirm" ? "Deleting…" : "Yes, delete for good"}
            </button>
            <button
              type="button"
              onClick={() => setArmed(false)}
              disabled={busy !== null}
              className="rounded-md px-3 py-1.5 text-sm font-medium text-text-destructive hover:bg-background/60"
            >
              Keep them
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-end gap-2 px-4 py-3">
            {action.destructive && <span className="mr-auto text-xs text-text-destructive">This can&apos;t be undone.</span>}
            <button
              type="button"
              onClick={() => run("cancel")}
              disabled={busy !== null}
              className="rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              {busy === "cancel" ? "Cancelling…" : "Cancel"}
            </button>
            <button
              type="button"
              onClick={() => (action.destructive ? setArmed(true) : run("confirm"))}
              disabled={busy !== null}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold shadow-sm transition-colors disabled:opacity-60",
                action.destructive
                  ? "bg-destructive text-destructive-foreground hover:opacity-90"
                  : "bg-primary text-primary-foreground hover:bg-primary-hover",
              )}
            >
              {busy === "confirm" && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
              {busy === "confirm" ? "Working…" : action.destructive ? `Confirm delete (${count})` : count > 1 ? `Confirm (${count})` : "Confirm"}
            </button>
          </div>
        )
      ) : (
        <div className="h-3" />
      )}
      {error && <div className="px-4 pb-3 text-xs text-text-destructive">{error}</div>}
    </div>
  );
}

const REVEAL_LABEL: Record<string, string> = {
  url: "Link",
  inviteUrl: "Invitation link",
  temporaryPassword: "Temporary password",
  emailed: "E-mailed",
};

/** One-time values (new links, a temporary password). Gone when the page reloads, like on the screens. */
function RevealedValues({ values }: { values: Revealed[] }) {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (v: string) => {
    try {
      await navigator.clipboard.writeText(v);
      setCopied(v);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      /* clipboard blocked; the text is selectable */
    }
  };
  return (
    <div className="mx-4 mt-3 rounded-[var(--radius-lg)] border border-warning/40 bg-warning-soft px-3 py-2.5 text-sm" data-testid="revealed">
      <div className="mb-1.5 inline-flex items-center gap-1.5 text-xs font-semibold text-warning-text">
        <KeyRound className="size-3.5" aria-hidden /> Shown once — copy it now. It isn&apos;t saved anywhere.
      </div>
      {values.map((v, i) => (
        <div key={i} className="mt-1">
          {values.length > 1 && v.label ? <div className="text-xs text-muted-foreground">{v.label}</div> : null}
          {Object.entries(v)
            .filter(([k]) => k !== "label")
            .map(([k, val]) =>
              typeof val === "boolean" ? (
                <div key={k} className="text-xs text-muted-foreground">
                  {REVEAL_LABEL[k] ?? k}: {val ? "yes" : "no — send the link yourself"}
                </div>
              ) : (
                <div key={k} className="flex items-center gap-2">
                  <span className="shrink-0 text-xs text-muted-foreground">{REVEAL_LABEL[k] ?? k}</span>
                  <code className="min-w-0 flex-1 truncate rounded bg-background px-1.5 py-0.5 font-mono text-xs text-foreground" title={String(val)}>
                    {String(val)}
                  </code>
                  <button
                    type="button"
                    onClick={() => copy(String(val))}
                    className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-foreground hover:bg-background/70"
                  >
                    {copied === String(val) ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
                    {copied === String(val) ? "Copied" : "Copy"}
                  </button>
                </div>
              ),
            )}
        </div>
      ))}
    </div>
  );
}
