"use client";

import { useMemo } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { Button, Card, CardBody, Skeleton } from "@/components/ui";
import { ROLE_LABELS, type Role } from "@/features/auth/types";
import type { BusyBlock, PersonAvailability, TeamAvailability } from "@/lib/api/resources/teams";
import { cn } from "@/lib/utils/cn";
import { useWorkspace } from "../api";
import { useTeamAvailability } from "../teams-api";

/* Colours follow the Ops CRM prototype's Ops Hub (member cards with an hourly strip). */
const SLOT = {
  free: "#4338ca", // working, nothing booked
  tentative: "#7c6cf0",
  busy: "#d98a1f", // meeting
  away: "#c9c5bd", // out of office block / "working elsewhere"
  off: "#eeece7", // outside office hours, or on leave
  unknown: "#e4e1db",
};
const AVATAR = ["#4a4742", "#7a2447", "#0f5a3f", "#2f3a8f", "#b8860b", "#5b3f8f", "#8a4b0a", "#1f6f78"];

function avatarColor(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR[h % AVATAR.length];
}
function initials(name: string) {
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase();
}

type Fmt = { time: (iso: string) => string; day: (iso: string) => string; hourOf: (iso: string) => number };

function useFormatters(tz: string): Fmt {
  return useMemo(() => {
    const t = new Intl.DateTimeFormat([], { hour: "numeric", minute: "2-digit", timeZone: tz });
    const d = new Intl.DateTimeFormat([], { weekday: "short", day: "numeric", month: "short", timeZone: tz });
    const h = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: tz });
    return {
      time: (iso) => t.format(new Date(iso)),
      day: (iso) => d.format(new Date(iso)),
      hourOf: (iso) => {
        const [hh, mm] = h.format(new Date(iso)).split(":").map(Number);
        return hh + mm / 60;
      },
    };
  }, [tz]);
}

function hoursRange(start: string, end: string): number[] {
  const s = Number(start.split(":")[0] || 9);
  const e = Number(end.split(":")[0] || 18);
  const out: number[] = [];
  for (let h = s; h < Math.max(e, s + 1); h++) out.push(h);
  return out;
}

/** What each office hour looks like for one person today. */
function strip(p: PersonAvailability, hours: number[], f: Fmt, hasData: boolean): string[] {
  if (p.onLeave) return hours.map(() => SLOT.off);
  if (!hasData) return hours.map(() => SLOT.unknown);
  return hours.map((h) => {
    const hit = p.today.find((b) => f.hourOf(b.start) < h + 1 && f.hourOf(b.end) > h);
    if (!hit) return SLOT.free;
    const s = hit.status.toLowerCase();
    if (s === "tentative") return SLOT.tentative;
    if (s === "oof" || s === "workingelsewhere") return SLOT.away;
    return SLOT.busy;
  });
}

function presence(p: PersonAvailability, f: Fmt, calendarKnown: boolean): { label: string; color: string } {
  if (p.onLeave) return { label: p.leaveUntil ? `On leave · back ${f.day(p.leaveUntil)}` : "On leave", color: "#8a867e" };
  if (p.busyNow) return { label: p.busyUntil ? `In a meeting · until ${f.time(p.busyUntil)}` : "In a meeting", color: "#d98a1f" };
  if (calendarKnown) return { label: "No meeting now", color: "#1f9d5a" };
  return { label: "No calendar data", color: "#8a867e" };
}

/**
 * /ops/hub — team coordination (Ops CRM prototype v4 → Ops Hub). Read-only: who is on
 * leave (Outlook automatic reply) or in a meeting (Outlook calendar), pushed in every
 * 15 minutes by the Power Automate "Availability sync" flow, next to each person's
 * open tickets. Live Teams presence (Available / Away) isn't available without admin consent.
 */
export function OpsHubPage() {
  const { data, isPending, refetch, isFetching } = useTeamAvailability();
  const ws = useWorkspace();
  const tz = data?.timezone || ws.data?.workspace.timezone || "Asia/Karachi";
  const f = useFormatters(tz);
  const office = ws.data?.workspace.officeHours ?? { start: "09:00", end: "18:00" };
  const hours = useMemo(() => hoursRange(office.start, office.end), [office.start, office.end]);
  const people = useMemo(() => data?.people ?? [], [data]);
  const withCalendar = people.filter((p) => p.hasCalendar).length;
  const onLeave = people.filter((p) => p.onLeave);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-[-0.011em] text-foreground">Ops Hub</h1>
          <p className="mt-1 text-table text-muted-foreground">
            Team coordination: who&apos;s on leave or in a meeting today, read from Outlook, next to each person&apos;s
            open tickets. Status comes from Outlook (automatic replies and calendar) — the point is coordination, not
            monitoring.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {data?.updatedAt ? `Updated ${f.time(data.updatedAt)}` : "Not updated yet"}
          </span>
          <Button variant="outline" size="sm" loading={isFetching} onClick={() => refetch()}>
            <RefreshCw className="size-4" />
            Refresh
          </Button>
        </div>
      </div>

      {data && (data.stale || (people.length > 0 && withCalendar === 0)) ? (
        <div className="rounded-lg border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
          {data.stale
            ? "The “Super App – Availability sync” flow hasn't sent anything in the last 2 hours, so this may be out of date. "
            : ""}
          {withCalendar === 0
            ? "No calendar (busy/free) data came through — leave is shown from Outlook automatic replies only. Check the flow's “Schedule” step, and that each person signs in with their real @innowi.com e-mail."
            : ""}
        </div>
      ) : null}

      {isPending ? (
        <Skeleton className="h-72 w-full" />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {people.map((p) => (
            <MemberCard key={p.id} p={p} f={f} hours={hours} />
          ))}
        </div>
      )}

      {data ? (
        <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          {(
            [
              ["Free", SLOT.free],
              ["Meeting", SLOT.busy],
              ["Tentative", SLOT.tentative],
              ["Away / elsewhere", SLOT.away],
              ["Off / on leave", SLOT.off],
              ["No calendar data", SLOT.unknown],
            ] as const
          ).map(([l, c]) => (
            <span key={l} className="inline-flex items-center gap-1.5">
              <i className="inline-block size-3 rounded-sm" style={{ background: c }} />
              {l}
            </span>
          ))}
          <span>
            Strip = office hours {office.start}–{office.end} ({tz})
          </span>
        </div>
      ) : null}

      {data ? (
        <div className="grid gap-3 lg:grid-cols-2">
          <LeavePanel onLeave={onLeave} f={f} />
          <TodayPanel data={data} hours={hours} f={f} />
        </div>
      ) : null}
    </div>
  );
}

function MemberCard({ p, f, hours }: { p: PersonAvailability; f: Fmt; hours: number[] }) {
  const pres = presence(p, f, p.hasCalendar);
  const slots = strip(p, hours, f, p.hasCalendar);
  const meetings = p.today.filter((b) => b.status.toLowerCase() !== "free");
  const role = ROLE_LABELS[p.role as Role] ?? p.role;
  return (
    <Card className={cn(p.onLeave && "opacity-75")}>
      <CardBody className="flex flex-col gap-2.5">
        <div className="flex items-center gap-2.5">
          <span
            className="grid size-10 shrink-0 place-items-center rounded-full text-sm font-bold text-white"
            style={{ background: avatarColor(p.id) }}
          >
            {initials(p.name)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-foreground">{p.name}</div>
            <div className="truncate text-xs text-muted-foreground">{role}</div>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold" style={{ color: pres.color }}>
            <i className="inline-block size-2 rounded-full" style={{ background: pres.color }} />
            {pres.label}
          </span>
        </div>

        <div className="flex h-3 gap-0.5 overflow-hidden rounded" title={`Office hours today`}>
          {slots.map((c, i) => (
            <i key={i} className="block grow" style={{ background: c }} title={`${hours[i]}:00`} />
          ))}
        </div>

        <div className="flex justify-between gap-3 text-xs text-muted-foreground">
          <span className="min-w-0 truncate">
            {p.onLeave
              ? p.leaveMessage || "Out of office (Outlook automatic reply)"
              : !p.hasCalendar
                ? "Calendar not readable"
                : meetings.length
                  ? meetings
                      .slice(0, 3)
                      .map((b) => `${f.time(b.start)}–${f.time(b.end)}`)
                      .join(" · ")
                  : "No meetings today"}
          </span>
          <Link href="/ops/tickets" className="shrink-0 hover:underline">
            <span className={cn(p.urgent || p.overdue ? "font-semibold text-text-destructive" : "")}>
              {p.openTickets} open
              {p.urgent ? ` · ${p.urgent} urgent` : ""}
              {p.overdue ? ` · ${p.overdue} overdue` : ""}
            </span>
          </Link>
        </div>

        <TeamsEmail p={p} />
      </CardBody>
    </Card>
  );
}

/** The Outlook address used for this person: their Super App login e-mail. */
function TeamsEmail({ p }: { p: PersonAvailability }) {
  return (
    <div className="border-t border-border pt-2 text-[11px] text-muted-foreground">
      <span className="block truncate" title="Their Super App login e-mail, used for Teams / Outlook">
        {p.email}
        {!p.known ? " · waiting for next Outlook sync" : ""}
      </span>
    </div>
  );
}

function LeavePanel({ onLeave, f }: { onLeave: PersonAvailability[]; f: Fmt }) {
  return (
    <Card>
      <CardBody className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-foreground">Leave &amp; coverage</h3>
        {onLeave.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nobody is out of office right now.</p>
        ) : (
          <div className="flex flex-col divide-y divide-border">
            {onLeave.map((p) => (
              <div key={p.id} className="flex items-center gap-3 py-2 text-sm">
                <span
                  className="grid size-7 shrink-0 place-items-center rounded-full text-[10px] font-bold text-white"
                  style={{ background: avatarColor(p.id) }}
                >
                  {initials(p.name)}
                </span>
                <span className="w-32 truncate">{p.name}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {p.leaveUntil ? `Until ${f.day(p.leaveUntil)}` : "Out of office"}
                </span>
                <span className={cn("shrink-0 text-xs", p.openTickets ? "font-semibold text-warning-text" : "text-muted-foreground")}>
                  {p.openTickets ? `${p.openTickets} open · reassign?` : "no open tickets"}
                </span>
              </div>
            ))}
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          From each person&apos;s Outlook automatic reply. People on leave are marked in the New ticket form, so work
          isn&apos;t assigned to someone who is out.
        </p>
      </CardBody>
    </Card>
  );
}

function TodayPanel({ data, hours, f }: { data: TeamAvailability; hours: number[]; f: Fmt }) {
  const present = data.people.filter((p) => !p.onLeave && p.hasCalendar);
  // Hours where everyone with readable calendars (and not on leave) is free.
  const overlap = hours.filter((h) =>
    present.every((p) => !p.today.some((b: BusyBlock) => f.hourOf(b.start) < h + 1 && f.hourOf(b.end) > h)),
  );
  const ranges: string[] = [];
  for (let i = 0; i < overlap.length; i++) {
    const s = overlap[i];
    let e = s + 1;
    while (overlap[i + 1] === e) {
      e++;
      i++;
    }
    ranges.push(`${String(s).padStart(2, "0")}:00 – ${String(e).padStart(2, "0")}:00`);
  }
  const inMeeting = data.people.filter((p) => !p.onLeave && p.busyNow);
  const withCalendar = data.people.filter((p) => p.hasCalendar).length;
  return (
    <Card>
      <CardBody className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-foreground">Today</h3>
        <Row label="Team overlap (everyone free)" value={present.length ? ranges.join(", ") || "None" : "—"} />
        <Row label="In a meeting now" value={inMeeting.length ? inMeeting.map((p) => p.name.split(" ")[0]).join(", ") : "Nobody"} />
        <Row label="On leave" value={String(data.people.filter((p) => p.onLeave).length)} />
        <Row label="Calendars readable" value={`${withCalendar} of ${data.people.length}`} />
      </CardBody>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 rounded-md bg-muted px-2.5 py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <b className="text-right text-foreground">{value}</b>
    </div>
  );
}
