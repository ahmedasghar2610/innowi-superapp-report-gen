"use client";

import { CircleCheck, CircleX, Send } from "lucide-react";
import { Badge, Button, Skeleton, useToast } from "@/components/ui";
import { useMySettings } from "../api";
import { useTeamsDigest, useTeamsStatus, useTeamsTest } from "../teams-api";
import { SettingsCard } from "./settings-shell";

const errorText = (e: unknown) =>
  (e as { messages?: string[]; message?: string })?.messages?.[0] ?? (e as Error)?.message ?? "Something went wrong";

/** Settings → Profile: Teams alerts go to the sign-in e-mail; plus a test message. */
export function MicrosoftEmailCard() {
  const { data } = useMySettings();
  const status = useTeamsStatus();
  const test = useTeamsTest();
  const { toast } = useToast();

  const sendTest = () =>
    test.mutate("me", {
      onSuccess: (r) => toast({ title: r.ok ? "Test sent — check Teams" : "Not sent", description: r.detail, variant: r.ok ? "success" : "error" }),
      onError: (e) => toast({ title: "Not sent", description: errorText(e), variant: "error" }),
    });

  return (
    <SettingsCard
      title="Microsoft Teams"
      description="Ticket alerts you've set to Teams (Settings → Notifications) arrive as a chat from Workflows, at your sign-in e-mail."
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Teams / Outlook address: <span className="font-medium text-foreground">{data?.user.email ?? "…"}</span>
        </p>
        <Button
          variant="outline"
          disabled={!status.data?.configured}
          loading={test.isPending}
          onClick={sendTest}
          title={status.data?.configured ? "Send yourself a test card in Teams" : "Teams isn't connected yet"}
        >
          <Send className="size-4" />
          Send me a test
        </Button>
      </div>
      {status.data && !status.data.configured ? (
        <p className="text-xs text-muted-foreground">Teams isn&apos;t connected to the Super App yet, so nothing is sent for now.</p>
      ) : null}
    </SettingsCard>
  );
}

/** Settings → Integrations: Teams flow status and admin test buttons. */
export function TeamsAlertsCard() {
  const status = useTeamsStatus();
  const test = useTeamsTest();
  const digest = useTeamsDigest();
  const { toast } = useToast();
  const s = status.data;

  const done = (r: { ok: boolean; detail: string }) =>
    toast({ title: r.ok ? "Done" : "Not sent", description: r.detail, variant: r.ok ? "success" : "error" });
  const failed = (e: unknown) => toast({ title: "Not sent", description: errorText(e), variant: "error" });

  return (
    <SettingsCard
      title="Teams alerts"
      description="Ticket alerts, the Ops alerts channel, the daily digest and Teams meeting invites go through one Power Automate flow (“Super App – Notify”). No Microsoft 365 admin permissions are needed."
    >
      {!s ? (
        <Skeleton className="h-20 w-full" />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {s.configured ? (
              <Badge tone="success" icon={CircleCheck}>
                Teams flow connected
              </Badge>
            ) : (
              <Badge tone="warning" icon={CircleX}>
                Teams flow not connected
              </Badge>
            )}
            {s.emailConfigured ? (
              <Badge tone="success" icon={CircleCheck}>
                E-mail on (Resend)
              </Badge>
            ) : (
              <Badge tone="neutral" icon={CircleX}>
                E-mail off
              </Badge>
            )}
            <span className="text-muted-foreground">
              Your Teams address: <span className="font-medium text-foreground">{s.myMicrosoftEmail}</span>
              {" (your sign-in e-mail)"}
            </span>
          </div>
          {!s.configured ? (
            <p className="text-sm text-muted-foreground">
              Add <code className="rounded bg-muted px-1">OPS_TEAMS_FLOW_URL</code> and{" "}
              <code className="rounded bg-muted px-1">OPS_TEAMS_FLOW_SECRET</code> to the API settings (Vercel →
              Environment Variables), then redeploy.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" loading={test.isPending && test.variables === "me"} onClick={() => test.mutate("me", { onSuccess: done, onError: failed })}>
                Send me a test
              </Button>
              {s.canManage ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    loading={test.isPending && test.variables === "channel"}
                    onClick={() => test.mutate("channel", { onSuccess: done, onError: failed })}
                  >
                    Test the alerts channel
                  </Button>
                  <Button variant="outline" size="sm" loading={digest.isPending} onClick={() => digest.mutate(undefined, { onSuccess: done, onError: failed })}>
                    Post today&apos;s digest now
                  </Button>
                </>
              ) : null}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            The daily digest posts once each working day after {String(s.digestHour).padStart(2, "0")}:00. Meeting times
            use {s.timezone}.
          </p>
        </div>
      )}
    </SettingsCard>
  );
}
