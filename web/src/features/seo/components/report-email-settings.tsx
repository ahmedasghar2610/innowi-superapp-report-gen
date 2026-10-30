"use client";

import { useState } from "react";
import Link from "next/link";
import { CircleAlert, CircleCheck, CircleDashed, Link2, Mail, Send } from "lucide-react";
import { Badge, Button, Input, Skeleton, useToast } from "@/components/ui";
import { useConnectSeo, useSeoStatus, useTestEmail } from "../api";
import type { SeoStatus } from "../types";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const STATE: Record<SeoStatus["email"]["state"], { label: string; tone: "success" | "warning" | "danger"; icon: typeof CircleCheck }> = {
  ready: { label: "Configured", tone: "success", icon: CircleCheck },
  not_connected: { label: "Not set up", tone: "warning", icon: CircleDashed },
  no_permission: { label: "Needs permission", tone: "warning", icon: CircleDashed },
  error: { label: "Needs reconnect", tone: "danger", icon: CircleAlert },
};

/**
 * Settings → Integrations → "SEO report e-mail". Reports are sent through the
 * Gmail API as the Google account connected for SEO (Search Console & GA4), so
 * they come from that mailbox and land in its Sent folder. Nothing to put in
 * the .env beyond the Google OAuth keys already there.
 */
export function SeoReportEmailSettings() {
  const { data: status, isPending } = useSeoStatus();
  const test = useTestEmail();
  const connect = useConnectSeo("settings");
  const { toast } = useToast();
  const [to, setTo] = useState("");

  if (isPending || !status) return <Skeleton className="h-40 w-full" />;
  const e = status.email;
  const st = STATE[e.state];
  const bad = to.trim() !== "" && !EMAIL_RE.test(to.trim());
  const reconnect = () =>
    connect.mutate(undefined, { onError: (err) => toast({ variant: "error", title: "Can't connect yet", description: err.messages?.[0] ?? err.message }) });

  return (
    <div id="seo-email" className="flex scroll-mt-24 flex-col gap-4 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-start gap-2">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
          <Mail className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-foreground">SEO report e-mail</div>
          <div className="text-xs text-muted-foreground">
            Signed-off client SEO reports are sent through Gmail from the Google account connected for Search Console &amp; GA4 — they show in that mailbox&apos;s Sent
            folder. Without it, reports can still be assembled, signed off and printed to PDF.
          </div>
        </div>
        <Badge tone={st.tone} icon={st.icon}>
          {st.label}
        </Badge>
      </div>

      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <Row label="Sends through">Gmail (Google Workspace)</Row>
        <Row label="Sends from">{e.from ? `${e.fromName} <${e.from}>` : "—"}</Row>
        <Row label="Recipients">
          <Link href="/web/seo/site-settings" className="text-primary hover:underline">
            Per site, in SEO → Site settings
          </Link>
        </Row>
        <Row label="Reports">
          <Link href="/web/seo/reports" className="text-primary hover:underline">
            Marketing → SEO → Reports
          </Link>
        </Row>
      </dl>

      {e.state !== "ready" && (
        <div className="flex flex-col gap-1.5 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
          {e.state === "not_connected" && <span>Connect Search Console &amp; GA4 above with the Google account that should send the reports (e.g. marketing@…).</span>}
          {e.state === "no_permission" && (
            <span>
              {e.from} is connected but hasn&apos;t allowed sending e-mail yet. Reconnect it and tick &quot;Send email on your behalf&quot; on Google&apos;s consent screen.
            </span>
          )}
          {e.state === "error" && <span>The Google connection stopped working — reconnect it in the Search Console &amp; GA4 card above.</span>}
          <span>
            One-time in Google Cloud (project &quot;Super App&quot;): APIs &amp; Services → Library → <b>Gmail API</b> → Enable, and Google Auth Platform → Data Access → add
            the scope <code className="rounded bg-card px-1 py-0.5 text-[11px]">https://www.googleapis.com/auth/gmail.send</code>. No .env change and no script.
          </span>
        </div>
      )}

      {status.canManage && e.state !== "ready" && e.state !== "not_connected" && (
        <div>
          <Button size="sm" onClick={reconnect} loading={connect.isPending}>
            <Link2 className="size-4" />
            Reconnect to allow sending
          </Button>
        </div>
      )}

      {e.state === "ready" &&
        (status.canApprove ? (
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(ev) => {
              ev.preventDefault();
              if (bad) return;
              test.mutate(to.trim() || undefined, {
                onSuccess: (r) => toast({ variant: "success", title: "Test e-mail sent", description: `From ${r.from} to ${r.sentTo}. Check the inbox (and spam).` }),
                onError: (err) => toast({ variant: "error", title: "Test e-mail failed", description: err.messages?.[0] ?? err.message }),
              });
            }}
          >
            <Input
              type="email"
              value={to}
              onChange={(ev) => setTo(ev.target.value)}
              placeholder="Send to (blank = your own e-mail)"
              className="h-8 w-72 text-sm"
              aria-label="Test e-mail address"
              aria-invalid={bad}
            />
            <Button type="submit" size="sm" variant="outline" loading={test.isPending} disabled={bad}>
              <Send className="size-4" />
              Send test e-mail
            </Button>
          </form>
        ) : (
          <p className="text-xs text-muted-foreground">Managers (or people with report approval) can send a test e-mail.</p>
        ))}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 gap-2">
      <dt className="w-36 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-foreground">{children}</dd>
    </div>
  );
}
