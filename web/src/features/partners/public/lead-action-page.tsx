"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui";

/**
 * /lead-action?t=<token> — where the partner-lead e-mail buttons land
 * ("Assign to Asif", "Mark as Won"). No login. It first shows what the button
 * will do and only acts on Confirm, so mail link-scanners that open every link
 * can't trigger anything. The API forwards to the partner-lead-action function.
 */

interface ActionResult {
  ok: boolean;
  error?: string | null;
  owner?: string | null;
  action?: "assign" | "status" | null;
  valueLabel?: string | null;
  lead?: { fullName?: string | null; company?: string | null } | null;
  already: boolean;
  committed: boolean;
}

const ERRORS: Record<string, string> = {
  invalid: "This button doesn't work. It may be from an old e-mail — open the lead in the Super App instead.",
  expired: "This button has expired. Open the lead in the Super App instead.",
  lead_gone: "This lead no longer exists.",
  assignee_missing: "That person can't be given leads any more. Open the lead in the Super App to choose someone else.",
  already_assigned: "Someone already has this lead, so this button no longer changes it. Open the lead in the Super App to change the owner.",
  not_on_team: "This button no longer works: you're not on the partner team any more.",
  not_owner: "This lead has a new owner, so this button no longer works.",
  server: "Something went wrong on our side. Please try again in a minute.",
};

async function call(token: string, commit: boolean): Promise<ActionResult> {
  const res = await fetch("/api/v1/public/partner-leads/action", {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, commit }),
  }).catch(() => null);
  if (!res || !res.ok) return { ok: false, error: "server", already: false, committed: false };
  return (await res.json()) as ActionResult;
}

export function LeadActionPage() {
  const token = useSearchParams().get("t") ?? "";
  const [preview, setPreview] = useState<ActionResult | null>(null);
  const [done, setDone] = useState<ActionResult | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) {
      setPreview({ ok: false, error: "invalid", already: false, committed: false });
      return;
    }
    let live = true;
    void call(token, false).then((r) => live && setPreview(r));
    return () => {
      live = false;
    };
  }, [token]);

  const confirm = async () => {
    setBusy(true);
    setDone(await call(token, true));
    setBusy(false);
  };

  const r = done ?? preview;
  const who = r?.lead ? [r.lead.fullName, r.lead.company && `(${r.lead.company})`].filter(Boolean).join(" ") : "";
  const what = r?.action === "assign" ? `Assign ${who} to ${r?.valueLabel}` : `Mark ${who} as ${r?.valueLabel}`;

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-[440px] rounded-[var(--radius-xl)] border border-border bg-card p-6 shadow-sm">
        <img src="/brand/innowi-wordmark.png" alt="Innowi" className="mb-6 h-[18px] w-auto dark:invert" />
        {!r ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Checking this button…
          </p>
        ) : !r.ok ? (
          <div className="flex items-start gap-2.5">
            <TriangleAlert className="mt-0.5 size-5 shrink-0 text-warning-text" aria-hidden />
            <p className="text-sm text-foreground">
              {r.error === "already_assigned" && r.owner
                ? `${r.owner} already has this lead, so this button no longer changes it. Open the lead in the Super App to change the owner.`
                : (ERRORS[r.error ?? "server"] ?? ERRORS.server)}
            </p>
          </div>
        ) : done || r.already ? (
          <div className="flex items-start gap-2.5">
            <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
            <div>
              <p className="text-sm font-semibold text-foreground">{r.already && !done?.committed ? "Already done" : "Done"}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {r.action === "assign"
                  ? `${who} is assigned to ${r.valueLabel}.`
                  : `${who} is marked as ${r.valueLabel}.`}
              </p>
            </div>
          </div>
        ) : (
          <div>
            <h1 className="text-lg font-semibold text-foreground">{what}?</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">Nothing changes until you confirm.</p>
            <div className="mt-5 flex gap-2">
              <Button variant="default" onClick={confirm} loading={busy}>
                Confirm
              </Button>
            </div>
          </div>
        )}
        <p className="mt-6 text-xs text-muted-foreground">
          Signed in to the Super App?{" "}
          <a href="/partners" className="font-medium text-foreground underline underline-offset-2">
            Open partner leads
          </a>
        </p>
      </div>
    </div>
  );
}
