"use client";

import { useEffect, useState } from "react";
import { KeyRound, LogOut, Monitor } from "lucide-react";
import { Badge, Button, Dialog, Field, Input, Skeleton, useToast } from "@/components/ui";
import { useAuth } from "@/features/auth/auth-context";
import { ROLE_LABELS, userInitials } from "@/features/auth/types";
import { formatDate, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils/cn";
import { useChangePassword, useEndSession, useLogoutAll, useMySettings, useSessions, useUpdateMySettings } from "../api";
import { GRANTABLE, type StartPage } from "../types";
import { SettingsCard } from "./settings-shell";
import { MicrosoftEmailCard } from "./teams-cards";

const errorText = (e: unknown) => (e as { messages?: string[]; message?: string })?.messages?.[0] ?? (e as Error)?.message ?? "Something went wrong";

export function ProfileSettingsPage() {
  const { data, isPending } = useMySettings();
  if (isPending || !data) {
    return (
      <SettingsCard title="Profile">
        <Skeleton className="h-24 w-full" />
      </SettingsCard>
    );
  }
  return (
    <>
      <ProfileCard />
      <MicrosoftEmailCard />
      <StartPageCard value={data.preferences.startPage} />
      <PasswordCard changedAt={data.passwordChangedAt} />
      <SessionsCard />
    </>
  );
}

function ProfileCard() {
  const { data } = useMySettings();
  const { setUser, user: authUser } = useAuth();
  const update = useUpdateMySettings();
  const { toast } = useToast();
  const u = data!.user;
  const [first, setFirst] = useState(u.firstName ?? "");
  const [last, setLast] = useState(u.lastName ?? "");
  useEffect(() => {
    setFirst(u.firstName ?? "");
    setLast(u.lastName ?? "");
  }, [u.firstName, u.lastName]);
  const dirty = first.trim() !== (u.firstName ?? "") || last.trim() !== (u.lastName ?? "");
  const grants = GRANTABLE.filter((g) => u.grantedCapabilities?.includes(g.key));

  const save = () =>
    update.mutate(
      { firstName: first.trim(), lastName: last.trim() },
      {
        onSuccess: (res) => {
          if (authUser) setUser({ ...authUser, firstName: res.user.firstName, lastName: res.user.lastName });
          toast({ title: "Profile saved", variant: "success" });
        },
        onError: (e) => toast({ title: "Couldn't save", description: errorText(e), variant: "error" }),
      },
    );

  return (
    <SettingsCard title="Profile" description="How you appear on tickets, comments and the Library.">
      <div className="flex flex-col gap-5 md:flex-row">
        <div className="flex shrink-0 flex-col items-center gap-2 md:w-36">
          <div className="grid size-16 place-items-center rounded-full bg-primary text-xl font-semibold text-primary-foreground">
            {userInitials({ firstName: first, lastName: last, email: u.email })}
          </div>
          <Badge tone={u.role === "SUPER_ADMIN" ? "primary" : "accent"}>{ROLE_LABELS[u.role]}</Badge>
        </div>
        <div className="grid min-w-0 flex-1 gap-4 sm:grid-cols-2">
          <Field label="First name" htmlFor="pf-first">
            <Input id="pf-first" value={first} maxLength={100} onChange={(e) => setFirst(e.target.value)} />
          </Field>
          <Field label="Last name" htmlFor="pf-last">
            <Input id="pf-last" value={last} maxLength={100} onChange={(e) => setLast(e.target.value)} />
          </Field>
          <Field label="Email" htmlFor="pf-email" hint="Your sign-in. Ask an admin to change it.">
            <Input id="pf-email" value={u.email} readOnly disabled />
          </Field>
          <div className="flex flex-col gap-1 text-sm">
            <span className="text-xs font-medium text-muted-foreground">Account</span>
            <span>Member since {formatDate(u.createdAt)}</span>
            <span className="text-muted-foreground">Last sign-in {u.lastLoginAt ? formatDateTime(u.lastLoginAt) : "—"}</span>
          </div>
          <div className="sm:col-span-2">
            <span className="text-xs font-medium text-muted-foreground">Extra access</span>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {u.role === "SUPER_ADMIN" ? (
                <Badge tone="success">Everything (Super Admin)</Badge>
              ) : grants.length ? (
                grants.map((g) => (
                  <Badge key={g.key} tone="success">
                    {g.label}
                  </Badge>
                ))
              ) : (
                <span className="text-sm text-muted-foreground">None beyond your role</span>
              )}
            </div>
          </div>
        </div>
      </div>
      <div className="mt-5 flex justify-end">
        <Button variant="default" disabled={!dirty} loading={update.isPending} onClick={save}>
          Save profile
        </Button>
      </div>
    </SettingsCard>
  );
}

const START_OPTIONS: { value: StartPage; label: string; hint: string }[] = [
  { value: "home", label: "Assistant", hint: "The AI assistant (default)." },
  { value: "tickets", label: "Tickets", hint: "The full list, every team." },
  { value: "my-work", label: "Assigned to me", hint: "Only your open tickets, by priority." },
];

function StartPageCard({ value }: { value: StartPage }) {
  const update = useUpdateMySettings();
  const { toast } = useToast();
  return (
    <SettingsCard title="Start page" description="Where the Super App opens when you sign in.">
      <div role="radiogroup" aria-label="Start page" className="grid gap-3 sm:grid-cols-3">
        {START_OPTIONS.map((o) => {
          const on = value === o.value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={update.isPending}
              onClick={() =>
                !on &&
                update.mutate(
                  { preferences: { startPage: o.value } },
                  {
                    onSuccess: () => toast({ title: `You'll start on ${o.label}`, variant: "success" }),
                    onError: (e) => toast({ title: "Couldn't save", description: errorText(e), variant: "error" }),
                  },
                )
              }
              className={cn(
                "flex flex-col gap-0.5 rounded-lg border p-3 text-left transition-colors",
                on ? "border-primary bg-accent" : "border-border bg-card hover:bg-muted",
              )}
            >
              <span className="text-sm font-semibold text-foreground">{o.label}</span>
              <span className="text-xs text-muted-foreground">{o.hint}</span>
            </button>
          );
        })}
      </div>
    </SettingsCard>
  );
}

function PasswordCard({ changedAt }: { changedAt: string | null }) {
  const change = useChangePassword();
  const { logout } = useAuth();
  const { toast } = useToast();
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string>();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(undefined);
    if (next.length < 8) return setError("Use at least 8 characters.");
    if (next !== again) return setError("The two new passwords don't match.");
    if (next === cur) return setError("Pick a password different from the current one.");
    change.mutate(
      { currentPassword: cur, newPassword: next },
      {
        onSuccess: () => {
          toast({ title: "Password changed", description: "Sign in again with your new password.", variant: "success" });
          void logout();
        },
        onError: (err) => setError(err.status === 401 ? "Your current password is incorrect." : errorText(err)),
      },
    );
  };

  return (
    <SettingsCard
      title="Password"
      description={`Changing it signs you out on every device. ${changedAt ? `Last changed ${formatDate(changedAt)}.` : ""}`}
    >
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-3">
        <Field label="Current password" htmlFor="pw-cur">
          <Input id="pw-cur" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} required />
        </Field>
        <Field label="New password" htmlFor="pw-new" hint="At least 8 characters.">
          <Input id="pw-new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />
        </Field>
        <Field label="Repeat new password" htmlFor="pw-again">
          <Input id="pw-again" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} required />
        </Field>
        <div className="flex items-center justify-between gap-3 sm:col-span-3">
          <p role="alert" className="text-sm text-text-destructive">
            {error}
          </p>
          <Button type="submit" variant="default" loading={change.isPending} disabled={!cur || !next || !again}>
            <KeyRound className="size-4" />
            Change password
          </Button>
        </div>
      </form>
    </SettingsCard>
  );
}

function SessionsCard() {
  const { data: sessions, isPending } = useSessions();
  const end = useEndSession();
  const all = useLogoutAll();
  const { logout } = useAuth();
  const { toast } = useToast();
  const [confirm, setConfirm] = useState(false);

  return (
    <SettingsCard
      title="Where you're signed in"
      description="Each row is one browser or device. Signing one out takes effect within 15 minutes."
      action={
        <Button size="sm" onClick={() => setConfirm(true)}>
          <LogOut className="size-4" />
          Sign out everywhere
        </Button>
      }
    >
      {isPending ? (
        <Skeleton className="h-12 w-full" />
      ) : !sessions?.length ? (
        <p className="text-sm text-muted-foreground">No active sessions.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {sessions.map((s, i) => (
            <li key={s.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
              <Monitor className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-foreground">
                  {s.device}
                  {i === 0 && <span className="ml-2 text-xs font-normal text-muted-foreground">most recent</span>}
                </div>
                <div className="text-xs text-muted-foreground">
                  {s.ip ?? "Unknown IP"} · signed in {formatDateTime(s.createdAt)} · expires {formatDate(s.expiresAt)}
                </div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                loading={end.isPending && end.variables === s.id}
                onClick={() => end.mutate(s.id, { onSuccess: () => toast({ title: "Session signed out" }) })}
              >
                Sign out
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Dialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Sign out everywhere?"
        description="Every browser and device, including this one. You'll need to sign in again."
        footer={
          <>
            <Button onClick={() => setConfirm(false)}>Cancel</Button>
            <Button
              variant="destructive"
              loading={all.isPending}
              onClick={() => all.mutate(undefined, { onSettled: () => void logout() })}
            >
              Sign out everywhere
            </Button>
          </>
        }
      />
    </SettingsCard>
  );
}
