"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Field, Input, Spinner } from "@/components/ui";
import { ROLE_LABELS, type Role } from "./types";

interface Preview {
  email: string;
  role: Role;
  expiresAt: string;
}

/** Pull a readable message out of the API's `{ message: string | string[] }` error body. */
async function errorText(res: Response | null, fallback: string): Promise<string> {
  if (!res) return "Couldn't reach the server. Check your connection and try again.";
  const body = await res.json().catch(() => null);
  const m = body?.message;
  return (Array.isArray(m) ? m.join(" · ") : m) || fallback;
}

/**
 * Accept-invitation form (route: /invite?token=…). The person has no account
 * yet, so this talks to the public /auth/invitations endpoints with plain
 * fetch — not the shared axios client, whose 401 handler would bounce them
 * to /login.
 */
export function AcceptInviteForm() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token") ?? "";
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) {
      setLoadError("This link is missing its invitation code. Open the link from your e-mail again.");
      return;
    }
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/v1/auth/invitations/${encodeURIComponent(token)}`, { cache: "no-store" }).catch(() => null);
      if (cancelled) return;
      if (res?.ok) setPreview((await res.json()) as Preview);
      else setLoadError(await errorText(res, "This invitation link isn't valid any more. Ask an admin for a new one."));
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError("Your password needs at least 8 characters.");
    if (password !== confirm) return setError("The two passwords don't match.");
    setBusy(true);
    const res = await fetch("/api/v1/auth/invitations/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token,
        password,
        firstName: firstName.trim() || undefined,
        lastName: lastName.trim() || undefined,
      }),
    }).catch(() => null);
    setBusy(false);
    if (res && res.status === 201) {
      setDone(true);
      setTimeout(() => router.replace("/login"), 2500);
      return;
    }
    setError(await errorText(res, "Couldn't create your account. Please try again."));
  };

  if (loadError) {
    return (
      <div className="flex flex-col gap-4">
        <p role="alert" className="rounded-lg bg-destructive-subtle px-3 py-2 text-table text-text-destructive">
          {loadError}
        </p>
        <Link href="/login" className="text-sm font-medium text-foreground underline underline-offset-4">
          Go to sign in
        </Link>
      </div>
    );
  }
  if (!preview) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner /> Checking your invitation…
      </div>
    );
  }
  if (done) {
    return (
      <p role="status" className="rounded-lg bg-success-subtle px-3 py-2 text-table text-success-subtle-foreground">
        You&apos;re all set. Taking you to sign in — use {preview.email} and the password you just chose.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        You&apos;re joining as <span className="font-medium text-foreground">{ROLE_LABELS[preview.role] ?? preview.role}</span>.
      </p>
      <Field label="Email" htmlFor="ai-email">
        <Input id="ai-email" type="email" value={preview.email} readOnly disabled autoComplete="username" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="First name" htmlFor="ai-first">
          <Input id="ai-first" autoComplete="given-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
        </Field>
        <Field label="Last name" htmlFor="ai-last">
          <Input id="ai-last" autoComplete="family-name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
        </Field>
      </div>
      <Field label="Choose a password" htmlFor="ai-pass" required hint="At least 8 characters">
        <Input id="ai-pass" type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <Field label="Password again" htmlFor="ai-confirm" required>
        <Input id="ai-confirm" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </Field>
      {error ? (
        <p role="alert" className="rounded-lg bg-destructive-subtle px-3 py-2 text-table text-text-destructive">
          {error}
        </p>
      ) : null}
      <Button type="submit" variant="default" size="lg" loading={busy}>
        Create my account
      </Button>
    </form>
  );
}
