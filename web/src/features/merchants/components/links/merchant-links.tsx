"use client";

/**
 * The merchant connector on the merchant workspace (API: app/modules/linking/connector*.py).
 *  - <ModuleLinksPanel module="seo|ads|gbp"> sits at the top of the SEO / Google Ads / GBP tabs:
 *    what is linked (unlink), what is suggested (link), and a search to link anything else.
 *  - <MerchantLinksCard> on Overview: one tile per module + "Connect" (link the sure matches).
 * Linking here is the same link the modules' own pages set — it shows up there too.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Link2, MapPin, Plug, Search, Target, X, type LucideIcon } from "lucide-react";
import { Badge, Button, Card, Input, SectionHead, Skeleton, StatTile, useToast } from "@/components/ui";
import { useCan } from "@/features/auth/use-can";
import {
  describeConnect, useConnectMerchants, useLinkRecord, useLinkSearch, useMerchantLinks, useUnlinkRecord,
  type LinkModule, type LinkedRecord, type LinkSuggestion,
} from "@/features/merchants/api";

const META: Record<LinkModule, { one: string; a: string; many: string; tab: string; page: string; pageLabel: string; icon: LucideIcon }> = {
  seo: { one: "SEO site", a: "an SEO site", many: "SEO sites", tab: "seo", page: "/web/seo/site-settings", pageLabel: "SEO site settings", icon: Search },
  ads: { one: "Ads account", a: "an Ads account", many: "Google Ads accounts", tab: "ads", page: "/ads/unmapped", pageLabel: "Ads → Unmapped accounts", icon: Target },
  gbp: { one: "GBP listing", a: "a GBP listing", many: "GBP listings", tab: "gbp", page: "/web/gbp", pageLabel: "GBP", icon: MapPin },
};

function useDebounced(v: string, ms = 300) {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

/* ------------------------------------------------------- per-module panel -- */

export function ModuleLinksPanel({ merchantId, module }: { merchantId: string; module: LinkModule }) {
  const { toast } = useToast();
  const can = useCan();
  const canEdit = can("profile.edit");
  const q = useMerchantLinks(merchantId);
  const link = useLinkRecord(merchantId);
  const unlink = useUnlinkRecord(merchantId);
  const [finding, setFinding] = useState(false);
  const meta = META[module];

  if (q.error) return <p className="text-sm text-text-destructive">Couldn&apos;t load this merchant&apos;s links: {q.error.message}</p>;
  if (!q.data) return <Skeleton className="h-24 w-full" />;
  const m = q.data.modules[module];

  const doLink = (r: LinkedRecord) =>
    link.mutate(
      { module, entityId: r.id },
      {
        onSuccess: () => toast({ variant: "success", title: `${r.name} linked`, description: `It now shows on this merchant and on ${meta.pageLabel}.` }),
        onError: (e) => toast({ variant: "error", title: "Couldn't link it", description: e.messages?.[0] ?? e.message }),
      },
    );
  const doUnlink = (r: LinkedRecord) =>
    unlink.mutate(
      { module, entityId: r.id },
      {
        onSuccess: () => toast({ variant: "success", title: `${r.name} unlinked` }),
        onError: (e) => toast({ variant: "error", title: "Couldn't unlink it", description: e.messages?.[0] ?? e.message }),
      },
    );

  return (
    <Card className="flex flex-col gap-3 p-4" aria-label={`${meta.many} linked to this merchant`}>
      <div className="flex flex-wrap items-center gap-2">
        <Plug className="size-4 text-muted-foreground" />
        <h3 className="flex-1 text-sm font-semibold text-foreground">Linked {meta.many}</h3>
        {m.enabled && canEdit && !finding && (
          <Button size="xs" variant="outline" onClick={() => setFinding(true)}>
            <Link2 className="size-3.5" />
            Link {meta.a}
          </Button>
        )}
        <Link href={meta.page} className="text-xs font-medium text-primary hover:underline">
          Open {meta.pageLabel}
        </Link>
      </div>

      {!m.enabled && (
        <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
          {module === "gbp"
            ? "Google Business Profile access is pending, so listings aren't linked or suggested from here yet. Anything already linked still shows below."
            : `Linking ${meta.many} is turned off in Settings → Data setup → Connector.`}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        {m.linked.map((r) => (
          <span key={r.id} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background py-0.5 pl-2.5 pr-1 text-xs">
            <span className="font-medium text-foreground">{r.name}</span>
            {r.detail && r.detail !== r.name && <span className="text-muted-foreground">{r.detail}</span>}
            {canEdit ? (
              <button
                type="button"
                onClick={() => doUnlink(r)}
                disabled={unlink.isPending}
                aria-label={`Unlink ${r.name}`}
                title="Unlink"
                className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            ) : (
              <span className="w-1" />
            )}
          </span>
        ))}
        {m.linked.length === 0 && <span className="text-xs text-muted-foreground">No {meta.one} linked yet.</span>}
      </div>

      {m.enabled && m.suggestions.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-medium text-muted-foreground">Suggested from this merchant&apos;s website and name</p>
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {m.suggestions.map((s) => (
              <SuggestionRow key={s.id} s={s} canEdit={canEdit} busy={link.isPending} onLink={() => doLink(s)} />
            ))}
          </ul>
        </div>
      )}

      {finding && <FindRecord merchantId={merchantId} module={module} busy={link.isPending} onLink={doLink} onClose={() => setFinding(false)} />}
    </Card>
  );
}

function SuggestionRow({ s, canEdit, busy, onLink }: { s: LinkSuggestion; canEdit: boolean; busy: boolean; onLink: () => void }) {
  return (
    <li className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
      <span className="min-w-40 flex-1">
        <span className="font-medium text-foreground">{s.name}</span>
        {s.detail && s.detail !== s.name && <span className="ml-1.5 text-xs text-muted-foreground">{s.detail}</span>}
        <span className="block text-xs text-muted-foreground">{s.reasons.join(" · ")}</span>
      </span>
      <Badge tone={s.sure ? "success" : s.score >= 85 ? "primary" : "neutral"} icon={false}>
        {s.sure ? "Sure match" : `${s.score}% match`}
      </Badge>
      {canEdit && (
        <Button size="xs" variant={s.sure ? "default" : "outline"} disabled={busy} onClick={onLink}>
          <Link2 className="size-3.5" />
          Link
        </Button>
      )}
    </li>
  );
}

function FindRecord({ merchantId, module, busy, onLink, onClose }: {
  merchantId: string; module: LinkModule; busy: boolean; onLink: (r: LinkedRecord) => void; onClose: () => void;
}) {
  const [text, setText] = useState("");
  const q = useDebounced(text);
  const res = useLinkSearch(merchantId, module, q, true);
  const meta = META[module];
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <div className="flex items-center gap-2">
        <Input
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={module === "ads" ? "Account name or customer ID…" : module === "seo" ? "Site name or domain…" : "Listing name or city…"}
          aria-label={`Find ${meta.a}`}
          className="h-8 flex-1 text-sm"
        />
        <Button size="xs" variant="ghost" onClick={onClose} aria-label="Close search">
          <X className="size-3.5" />
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">Only {meta.many} no merchant has yet are listed.</p>
      {res.isPending ? (
        <Skeleton className="h-16 w-full" />
      ) : (
        <ul className="flex max-h-64 flex-col divide-y divide-border overflow-y-auto">
          {(res.data?.data ?? []).map((r) => (
            <li key={r.id} className="flex items-center gap-2 py-1.5 text-sm">
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium text-foreground">{r.name}</span>
                {r.detail && r.detail !== r.name && <span className="ml-1.5 text-xs text-muted-foreground">{r.detail}</span>}
              </span>
              <Button size="xs" variant="outline" disabled={busy} onClick={() => onLink(r)}>
                <Link2 className="size-3.5" />
                Link
              </Button>
            </li>
          ))}
          {res.data?.data.length === 0 && <li className="py-3 text-center text-xs text-muted-foreground">Nothing unlinked matches.</li>}
        </ul>
      )}
    </div>
  );
}

/* ---------------------------------------------------------- overview card -- */

export function MerchantLinksCard({ merchantId }: { merchantId: string }) {
  const { toast } = useToast();
  const can = useCan();
  const q = useMerchantLinks(merchantId);
  const connect = useConnectMerchants();
  const sure = q.data ? (Object.keys(META) as LinkModule[]).reduce((n, k) => n + q.data.modules[k].suggestions.filter((s) => s.sure).length, 0) : 0;

  return (
    <section className="flex flex-col gap-3">
      <SectionHead
        title="Connected modules"
        description="SEO sites, Google Ads accounts and GBP listings linked to this merchant — matched from its website and name."
        action={
          can("profile.edit") && sure > 0 ? (
            <Button
              size="sm"
              loading={connect.isPending}
              onClick={() =>
                connect.mutate([merchantId], {
                  onSuccess: (r) =>
                    toast({
                      variant: r.skipped ? "warning" : "success",
                      title: r.skipped ? "Automatic linking is off" : "Connected",
                      description: r.skipped ? "Turn it on in Settings → Data setup → Connector, or link each one on its tab." : describeConnect(r.summary),
                    }),
                  onError: (e) => toast({ variant: "error", title: "Couldn't connect", description: e.messages?.[0] ?? e.message }),
                })
              }
            >
              {!connect.isPending && <Link2 className="size-4" />}
              Link {sure} sure match{sure === 1 ? "" : "es"}
            </Button>
          ) : undefined
        }
      />
      <div className="grid gap-3 sm:grid-cols-3">
        {(Object.keys(META) as LinkModule[]).map((k) => {
          const m = q.data?.modules[k];
          const meta = META[k];
          const n = m?.linked.length ?? 0;
          const suggested = m?.suggestions.length ?? 0;
          return (
            <StatTile
              key={k}
              href={`/merchants/${merchantId}/${meta.tab}`}
              scroll={false}
              icon={meta.icon}
              label={meta.many}
              value={m ? n : "—"}
              loading={q.isPending}
              tone={!m ? "neutral" : n ? "ok" : suggested ? "warning" : "neutral"}
              status={
                !m ? "" : !m.enabled ? (k === "gbp" ? "GBP access pending" : "Linking turned off") : suggested ? `${suggested} suggested` : n ? "Linked" : "Nothing suggested"
              }
            />
          );
        })}
      </div>
      {q.error && <p className="text-xs text-text-destructive">Couldn&apos;t load links: {q.error.message}</p>}
    </section>
  );
}

