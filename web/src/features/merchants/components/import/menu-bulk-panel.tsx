"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CircleCheck, CircleAlert, RefreshCw, Utensils } from "lucide-react";
import { Badge, type BadgeTone, Button, Dialog, Select, Skeleton, useToast } from "@/components/ui";
import { useCan } from "@/features/auth/use-can";
import { useCheckMenus, useFetchMenus, useMenuStatuses, usePickMenuLink } from "@/features/merchants/api";
import type { MenuStatusKind, MenuStatusRow } from "@/features/merchants/types";

const STATUS: Record<MenuStatusKind, { label: string; tone: BadgeTone }> = {
  fetched: { label: "Fetched", tone: "success" },
  running: { label: "Fetching…", tone: "accent" },
  queued: { label: "Queued", tone: "accent" },
  failed: { label: "Failed", tone: "danger" },
  ready: { label: "Ready", tone: "primary" },
  pick: { label: "Pick a link", tone: "warning" },
  none: { label: "No Innowi link", tone: "neutral" },
};
const ORDER: MenuStatusKind[] = ["running", "queued", "pick", "ready", "failed", "fetched", "none"];

/**
 * Menus across merchants: can each one be fetched (an Innowi link in its
 * Online ordering), a quick check that the branch exists, and "Fetch menus"
 * for the ones that are ready — one after another, with live status.
 * `merchantIds` limits it to those merchants (e.g. the ones just imported).
 */
export function MenuBulkPanel({ merchantIds }: { merchantIds?: string[] }) {
  const { toast } = useToast();
  const can = useCan();
  const canEdit = can("profile.edit");
  const q = useMenuStatuses(merchantIds);
  const check = useCheckMenus();
  const fetchMenus = useFetchMenus();
  const pick = usePickMenuLink();
  const [checks, setChecks] = useState<Record<string, { ok: boolean; error?: string | null }>>({});

  const rows = useMemo(
    () => [...(q.data?.data ?? [])].sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || a.restaurantName.localeCompare(b.restaurantName)),
    [q.data],
  );
  const ready = rows.filter((r) => r.status === "ready" || (r.status === "failed" && r.link));
  const busy = rows.some((r) => r.status === "running" || r.status === "queued");

  if (q.error) return <p className="text-sm text-text-destructive">Couldn&apos;t load menu status: {q.error.message}</p>;
  if (!q.data) return <Skeleton className="h-40 w-full" />;

  const runCheck = () =>
    check.mutate(rows.filter((r) => r.link).map((r) => r.merchantId), {
      onSuccess: (res) => {
        const next: Record<string, { ok: boolean; error?: string | null }> = {};
        for (const r of res.data) if (r.check && r.check !== "no-link") next[r.merchantId] = { ok: r.check === "ok", error: r.checkError };
        setChecks(next);
        const bad = Object.values(next).filter((x) => !x.ok).length;
        toast({ variant: bad ? "warning" : "success", title: bad ? `${bad} link${bad === 1 ? "" : "s"} didn't work` : "Every link works" });
      },
      onError: (e) => toast({ variant: "error", title: "Couldn't check the links", description: e.messages?.[0] ?? e.message }),
    });

  const runFetch = (ids: string[]) =>
    fetchMenus.mutate(ids, {
      onSuccess: (res) => {
        const skipped = Object.keys(res.skipped).length;
        toast({
          variant: "success",
          title: res.started.length ? `Fetching ${res.started.length} menu${res.started.length === 1 ? "" : "s"}` : "Nothing to fetch",
          description: [
            skipped ? `${skipped} skipped` : "",
            res.remaining.length ? `${res.remaining.length} still to do — click Fetch again` : "",
          ].filter(Boolean).join(" · ") || undefined,
        });
      },
      onError: (e) => toast({ variant: "error", title: "Couldn't start the menu fetch", description: e.messages?.[0] ?? e.message }),
    });

  const counts = q.data.counts;
  return (
    <section className="flex flex-col gap-3" aria-label="Menus">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="flex-1 text-sm font-semibold text-foreground">Menus from Innowi Online Ordering</h3>
        {canEdit && (
          <>
            <Button size="sm" variant="outline" onClick={runCheck} loading={check.isPending} disabled={!rows.some((r) => r.link)}>
              {!check.isPending && <CircleCheck className="size-4" />}
              Check links
            </Button>
            <Button size="sm" variant="default" onClick={() => runFetch(ready.map((r) => r.merchantId))} loading={fetchMenus.isPending}
              disabled={busy || ready.length === 0}>
              {!fetchMenus.isPending && <Utensils className="size-4" />}
              {busy ? "Fetching…" : `Fetch ${ready.length} menu${ready.length === 1 ? "" : "s"}`}
            </Button>
          </>
        )}
      </div>
      <p className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
        {ORDER.filter((k) => counts[k]).map((k) => (
          <span key={k}>
            {STATUS[k].label}: <b className="font-semibold text-foreground">{counts[k]}</b>
          </span>
        ))}
        <span>The link comes from each merchant&apos;s Online ordering text, which is kept as written.</span>
      </p>
      <ul className="flex max-h-96 flex-col divide-y divide-border overflow-y-auto rounded-lg border border-border">
        {rows.map((r) => (
          <MenuRow key={r.merchantId} r={r} check={checks[r.merchantId]} canEdit={canEdit}
            onPick={(link) => pick.mutate({ merchantId: r.merchantId, link }, {
              onError: (e) => toast({ variant: "error", title: "Couldn't save the link", description: e.messages?.[0] ?? e.message }),
            })}
            onRetry={() => runFetch([r.merchantId])} />
        ))}
        {rows.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted-foreground">No merchants.</li>}
      </ul>
    </section>
  );
}

function MenuRow({ r, check, canEdit, onPick, onRetry }: {
  r: MenuStatusRow; check?: { ok: boolean; error?: string | null }; canEdit: boolean; onPick: (link: string) => void; onRetry: () => void;
}) {
  const st = STATUS[r.status];
  const detail =
    r.status === "fetched" ? `${r.validCount ?? 0} items` :
    r.status === "running" && r.progress ? `${r.progress.phase}${r.progress.total ? ` ${r.progress.done}/${r.progress.total}` : ""}` :
    r.status === "failed" ? r.error :
    r.status === "none" ? "Online ordering has no Innowi ordering link" : null;
  return (
    <li className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
      <Link href={`/merchants/${r.merchantId}/menu`} className="min-w-40 flex-1 font-medium text-foreground hover:underline">
        {r.restaurantName}
        {r.merchantCode && <span className="ml-1.5 font-mono text-xs text-muted-foreground">{r.merchantCode}</span>}
      </Link>
      <Badge tone={st.tone} icon={false}>{st.label}</Badge>
      {check && (
        <span className={check.ok ? "inline-flex items-center gap-1 text-xs text-success-subtle-foreground" : "inline-flex items-center gap-1 text-xs text-text-destructive"} title={check.error ?? undefined}>
          {check.ok ? <CircleCheck className="size-3.5" /> : <CircleAlert className="size-3.5" />}
          {check.ok ? "Link works" : check.error ?? "Link doesn't work"}
        </span>
      )}
      {r.status === "pick" && canEdit ? (
        <Select aria-label={`Ordering link for ${r.restaurantName}`} className="h-7 w-auto max-w-72 text-xs" value="" onChange={(e) => e.target.value && onPick(e.target.value)}>
          <option value="">Choose the branch…</option>
          {r.links.map((l) => (
            <option key={l} value={l}>{l.replace(/^https?:\/\/online-ordering\.innowi\.com\/branch\//, "")}</option>
          ))}
        </Select>
      ) : r.link ? (
        <span className="max-w-64 truncate text-xs text-muted-foreground" title={r.link}>{r.link.replace(/^https?:\/\//, "")}</span>
      ) : null}
      {detail && <span className="w-full truncate pl-0.5 text-xs text-muted-foreground sm:w-auto" title={detail}>{detail}</span>}
      {r.status === "failed" && r.link && canEdit && (
        <Button size="xs" variant="ghost" onClick={onRetry} aria-label={`Retry ${r.restaurantName}`}>
          <RefreshCw className="size-3.5" />
          Retry
        </Button>
      )}
    </li>
  );
}

/** The same panel for every merchant, opened from the Merchants list. */
export function MenuBulkDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="Menus" description="Which merchants' menus can be fetched from Innowi Online Ordering, and fetch them." size="3xl">
      {open && <MenuBulkPanel />}
    </Dialog>
  );
}
