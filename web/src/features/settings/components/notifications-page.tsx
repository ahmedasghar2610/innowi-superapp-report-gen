"use client";

import { useEffect, useState } from "react";
import { Info } from "lucide-react";
import { Button, Skeleton, useToast } from "@/components/ui";
import { useIntegrations, useMySettings, useUpdateMySettings } from "../api";
import { CHANNEL_LABEL, NOTIFICATION_EVENTS, type NotificationChannel, type Preferences } from "../types";
import { SettingsCard } from "./settings-shell";

const CHANNELS: NotificationChannel[] = ["inApp", "email", "teams"];

export function NotificationSettingsPage() {
  const { data, isPending } = useMySettings();
  const { data: integrations } = useIntegrations();
  const update = useUpdateMySettings();
  const { toast } = useToast();
  const [draft, setDraft] = useState<Preferences["notifications"]>();

  useEffect(() => {
    if (data) setDraft(data.preferences.notifications);
  }, [data]);

  const teamsLive = integrations?.find((i) => i.key === "teams_flow")?.status === "connected";
  const emailLive = integrations?.find((i) => i.key === "email")?.status === "connected";
  const msLive = !integrations || (teamsLive && emailLive);
  const dirty = !!data && !!draft && JSON.stringify(draft) !== JSON.stringify(data.preferences.notifications);

  const toggle = (event: keyof Preferences["notifications"], ch: NotificationChannel) =>
    setDraft((d) => (d ? { ...d, [event]: { ...d[event], [ch]: !d[event][ch] } } : d));

  const setAll = (ch: NotificationChannel, on: boolean) =>
    setDraft((d) =>
      d ? (Object.fromEntries(Object.entries(d).map(([k, v]) => [k, { ...v, [ch]: on }])) as Preferences["notifications"]) : d,
    );

  return (
    <SettingsCard
      title="Notifications"
      description="Choose how you hear about your tickets. These are your own choices — nobody else's change."
      action={
        <Button
          variant="default"
          size="sm"
          disabled={!dirty}
          loading={update.isPending}
          onClick={() =>
            draft &&
            update.mutate(
              { preferences: { notifications: draft } },
              {
                onSuccess: () => toast({ title: "Notification choices saved", variant: "success" }),
                onError: (e) => toast({ title: "Couldn't save", description: e.messages?.[0], variant: "error" }),
              },
            )
          }
        >
          Save
        </Button>
      }
    >
      {!msLive && (
        <div className="mb-4 flex gap-2 rounded-lg border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            Your choices are saved now.{" "}
            {!teamsLive ? "Teams messages start once Teams is connected (Settings → Integrations). " : ""}
            {!emailLive ? "Emails start once e-mail sending is set up. " : ""}
            Until then, new work shows up on <b>Assigned to me</b>. Teams messages go to the address in Settings → Profile.
          </span>
        </div>
      )}
      {isPending || !draft ? (
        <Skeleton className="h-48 w-full" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-3 font-medium">When</th>
                {CHANNELS.map((ch) => {
                  const allOn = Object.values(draft).every((v) => v[ch]);
                  return (
                    <th key={ch} className="w-32 px-2 py-2 text-center font-medium">
                      <div className="flex flex-col items-center gap-1">
                        <span>{CHANNEL_LABEL[ch]}</span>
                        {integrations && ((ch === "teams" && !teamsLive) || (ch === "email" && !emailLive)) && (
                          <span className="whitespace-nowrap text-[10px] font-normal normal-case tracking-normal text-muted-foreground">
                            not sending yet
                          </span>
                        )}
                        <button
                          type="button"
                          className="text-[11px] font-medium normal-case tracking-normal text-primary hover:underline"
                          onClick={() => setAll(ch, !allOn)}
                        >
                          {allOn ? "None" : "All"}
                        </button>
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {NOTIFICATION_EVENTS.map((ev) => (
                <tr key={ev.key} className="border-b border-border last:border-0">
                  <td className="py-3 pr-3">
                    <div className="font-medium text-foreground">{ev.label}</div>
                    <div className="text-xs text-muted-foreground">{ev.hint}</div>
                  </td>
                  {CHANNELS.map((ch) => (
                    <td key={ch} className="px-2 py-3 text-center">
                      <input
                        type="checkbox"
                        className="size-4 accent-[var(--color-primary)]"
                        aria-label={`${ev.label} — ${CHANNEL_LABEL[ch]}`}
                        checked={draft[ev.key][ch]}
                        onChange={() => toggle(ev.key, ch)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SettingsCard>
  );
}
