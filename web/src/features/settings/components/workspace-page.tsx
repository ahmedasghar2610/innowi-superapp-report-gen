"use client";

import { useEffect, useState } from "react";
import { ImageUp } from "lucide-react";
import { Button, Field, Input, Select, Skeleton, useToast } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils/cn";
import { useSaveWorkspace, useWorkspace } from "../api";
import { WEEKDAYS, type Workspace } from "../types";
import { PreviewTag, SettingsCard, ViewOnlyNote } from "./settings-shell";

const DATE_FORMATS: { value: Workspace["dateFormat"]; example: string }[] = [
  { value: "D MMM YYYY", example: "5 Oct 2026" },
  { value: "MM/DD/YYYY", example: "10/05/2026" },
  { value: "DD/MM/YYYY", example: "05/10/2026" },
  { value: "YYYY-MM-DD", example: "2026-10-05" },
];

export function WorkspaceSettingsPage() {
  const { data, isPending } = useWorkspace();
  const save = useSaveWorkspace();
  const { toast } = useToast();
  const [ws, setWs] = useState<Workspace>();

  useEffect(() => {
    if (data) setWs(data.workspace);
  }, [data]);

  if (isPending || !data || !ws) {
    return (
      <SettingsCard title="Workspace">
        <Skeleton className="h-48 w-full" />
      </SettingsCard>
    );
  }

  const ro = !data.canEdit;
  const dirty = JSON.stringify(ws) !== JSON.stringify(data.workspace);
  const set = <K extends keyof Workspace>(k: K, v: Workspace[K]) => setWs((w) => (w ? { ...w, [k]: v } : w));
  const toggleDay = (d: number) =>
    set("workDays", ws.workDays.includes(d) ? ws.workDays.filter((x) => x !== d) : [...ws.workDays, d].sort());
  const now = new Date().toLocaleTimeString("en-GB", { timeZone: ws.timezone, hour: "2-digit", minute: "2-digit" });

  const footer = (
    <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
      <span className="text-xs text-muted-foreground">
        {data.updatedAt ? `Last changed ${formatDateTime(data.updatedAt)}${data.updatedBy ? ` by ${data.updatedBy}` : ""}` : "Using the defaults."}
      </span>
      {!ro && (
        <div className="flex gap-2">
          <Button disabled={!dirty} onClick={() => setWs(data.workspace)}>
            Discard
          </Button>
          <Button
            variant="default"
            disabled={!dirty || ws.workDays.length === 0 || !ws.companyName.trim()}
            loading={save.isPending}
            onClick={() =>
              save.mutate(ws, {
                onSuccess: () => toast({ title: "Workspace saved", variant: "success" }),
                onError: (e) => toast({ title: "Couldn't save", description: e.messages?.[0], variant: "error" }),
              })
            }
          >
            Save changes
          </Button>
        </div>
      )}
    </div>
  );

  return (
    <>
      <SettingsCard title="Company" description="Saved now; notification emails and exported reports will use it.">
        {ro && <div className="mb-4"><ViewOnlyNote /></div>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Company name" htmlFor="ws-name" required>
            <Input id="ws-name" value={ws.companyName} disabled={ro} maxLength={120} onChange={(e) => set("companyName", e.target.value)} />
          </Field>
          <Field label="Support email" htmlFor="ws-email" hint="Reply-to for notification emails.">
            <Input id="ws-email" type="email" value={ws.supportEmail} disabled={ro} onChange={(e) => set("supportEmail", e.target.value)} />
          </Field>
          <Field label="Ticket number prefix" htmlFor="ws-prefix" hint="Fixed — every ticket is OPS-1001, OPS-1002, …">
            <Input id="ws-prefix" value={`${data.ticketPrefix}-####`} disabled readOnly />
          </Field>
          <Field label="Date format" htmlFor="ws-date" hint="Rolling out across the app.">
            <Select id="ws-date" value={ws.dateFormat} disabled={ro} onChange={(e) => set("dateFormat", e.target.value as Workspace["dateFormat"])}>
              {DATE_FORMATS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.example}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </SettingsCard>

      <SettingsCard title="Working time" description="The team's week. The SLA clock only counts working days in this timezone.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Timezone" htmlFor="ws-tz" hint={`It's ${now} there now.`}>
            <Select id="ws-tz" value={ws.timezone} disabled={ro} onChange={(e) => set("timezone", e.target.value)}>
              {data.timezones.map((z) => (
                <option key={z} value={z}>
                  {z.replace(/_/g, " ")}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Week starts on" htmlFor="ws-week" hint="For the Calendar.">
            <Select id="ws-week" value={ws.weekStartsOn} disabled={ro} onChange={(e) => set("weekStartsOn", e.target.value as Workspace["weekStartsOn"])}>
              <option value="monday">Monday</option>
              <option value="sunday">Sunday</option>
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <span className="text-xs font-medium text-muted-foreground">Working days</span>
            <div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-label="Working days">
              {WEEKDAYS.map((d, i) => {
                const on = ws.workDays.includes(i);
                return (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={on}
                    disabled={ro}
                    onClick={() => toggleDay(i)}
                    className={cn(
                      "h-8 w-12 rounded-lg border text-sm font-medium transition-colors disabled:opacity-60",
                      on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:bg-muted",
                    )}
                  >
                    {d}
                  </button>
                );
              })}
            </div>
            {ws.workDays.length === 0 && <p className="mt-1 text-xs text-text-destructive">Pick at least one working day.</p>}
          </div>
          <Field label="Office opens" htmlFor="ws-start" hint="For Ops Hub availability and the Calendar.">
            <Input
              id="ws-start"
              type="time"
              value={ws.officeHours.start}
              disabled={ro}
              onChange={(e) => set("officeHours", { ...ws.officeHours, start: e.target.value })}
            />
          </Field>
          <Field label="Office closes" htmlFor="ws-end">
            <Input
              id="ws-end"
              type="time"
              value={ws.officeHours.end}
              disabled={ro}
              onChange={(e) => set("officeHours", { ...ws.officeHours, end: e.target.value })}
            />
          </Field>
        </div>
        {footer}
      </SettingsCard>

      <SettingsCard title="Branding" description="Logo and colour for the app and outgoing emails." action={<PreviewTag>Coming soon</PreviewTag>}>
        <div className="flex flex-wrap items-center gap-4 opacity-70">
          <div className="grid size-14 place-items-center rounded-xl bg-primary text-xl font-bold text-primary-foreground">i</div>
          <Button disabled>
            <ImageUp className="size-4" />
            Upload logo
          </Button>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            Accent colour
            <span className="size-6 rounded-md border border-border bg-primary" aria-hidden />
            <code className="text-xs">#2C67F5</code>
          </div>
        </div>
      </SettingsCard>
    </>
  );
}
