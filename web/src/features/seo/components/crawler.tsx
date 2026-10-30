"use client";

import { useState } from "react";
import Link from "next/link";
import { Copy, KeyRound, Loader2, Plus, ScanSearch, Trash2, X } from "lucide-react";
import {
  Badge,
  Button,
  Dialog,
  Field,
  Input,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableMessageRow,
  TableRow,
  useToast,
  type BadgeTone,
} from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import { useCancelCrawl, useCrawlerKeys, useCrawlerStatus, useCreateCrawlerKey, useQueueCrawl, useRevokeCrawlerKey, useSeoStatus } from "../api";
import { fmtAgo, fmtDateTime } from "../lib";
import type { CrawlerStatus, CrawlJob, CrawlJobStatus } from "../types";

/*
 * Screaming Frog crawls run on a helper PC (helper.py, started with Windows by
 * 3-start-with-windows.bat) that has a licensed Screaming Frog. The Super App
 * only queues them; the helper asks for work every minute, crawls, and sends
 * the export back (modules/seo/crawler.py).
 */

export const CRAWLER_SETTINGS_HREF = "/settings/integrations#sf-crawler";

const JOB: Record<CrawlJobStatus, { label: string; tone: BadgeTone }> = {
  queued: { label: "Waiting", tone: "neutral" },
  running: { label: "Crawling", tone: "accent" },
  saving: { label: "Saving", tone: "accent" },
  done: { label: "Done", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

function helperLine(s: CrawlerStatus): string {
  const online = s.helpers.filter((h) => h.online);
  if (online.length) return `${online.map((h) => h.helperName || h.name).join(", ")} online`;
  if (!s.helpers.length) return "No helper PC set up yet";
  return `No helper online · last seen ${fmtAgo(s.lastSeenAt)}`;
}

/** Under the Search Console strip on every SEO page: helper online?, queue, and "Crawl all sites". */
export function CrawlerStrip() {
  const { toast } = useToast();
  const status = useCrawlerStatus();
  const seoStatus = useSeoStatus();
  const queue = useQueueCrawl();
  const s = status.data;
  if (!s) return <Skeleton className="h-12 w-full" />;
  const canManage = !!seoStatus.data?.canManage;
  const active = s.queued + s.running + s.saving;
  const running = s.recent.find((j) => j.status === "running");
  const saving = s.recent.find((j) => j.status === "saving");
  const online = s.online > 0;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] border border-border bg-card px-4 py-2.5">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
        {s.running + s.saving ? <Loader2 className="size-4 animate-spin" /> : <ScanSearch className="size-4" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
          Screaming Frog crawler
          <Badge tone={online ? "success" : s.helpers.length ? "warning" : "neutral"}>{helperLine(s)}</Badge>
        </div>
        <div className="text-xs text-muted-foreground">
          {running ? (
            <>
              Crawling {running.siteName ?? running.domain} on {running.helper}
              {saving && <> · saving {saving.siteName ?? saving.domain}</>}
              {s.queued > 0 && <> · {s.queued} more waiting</>}
            </>
          ) : saving ? (
            <>
              Saving {saving.siteName ?? saving.domain} and updating its scores
              {s.queued > 0 && <> · {s.queued} more waiting</>}
            </>
          ) : s.queued ? (
            <>
              {s.queued} site{s.queued === 1 ? "" : "s"} waiting
              {online ? " — the helper picks the next one within a minute" : " — they start when a helper PC is on and online"}
            </>
          ) : (
            <>
              Full-site crawls (broken pages, redirects, titles, schema…) for the site scores.{" "}
              {s.recent.find((j) => j.status === "done")?.finishedAt && <>Last crawl finished {fmtAgo(s.recent.find((j) => j.status === "done")!.finishedAt)}.</>}
            </>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        {canManage && (
          <Button
            size="sm"
            variant="outline"
            loading={queue.isPending}
            onClick={() =>
              queue.mutate(
                { all: true },
                {
                  onSuccess: (r) =>
                    toast({
                      variant: "success",
                      title: r.queued ? `${r.queued} site${r.queued === 1 ? "" : "s"} queued for crawling` : "Every site is already queued",
                      description: online ? "The helper crawls them one at a time; scores update as each one finishes." : "No helper is online right now — they start when one is.",
                    }),
                  onError: (e) => toast({ variant: "error", title: "Couldn't queue the crawls", description: e.messages?.[0] ?? e.message }),
                },
              )
            }
            title="Queue a Screaming Frog crawl of every active site (sites already waiting are skipped)"
          >
            <ScanSearch className="size-4" />
            {active ? "Crawl remaining sites" : "Crawl all sites"}
          </Button>
        )}
        {canManage && (
          <Link
            href={CRAWLER_SETTINGS_HREF}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <KeyRound className="size-4" />
            {s.helpers.length ? "Helpers" : "Set up a helper"}
          </Link>
        )}
      </div>
    </div>
  );
}

/** "Crawl now" for one site, with the state of its latest crawl job. */
export function CrawlNow({ siteId, compact = false }: { siteId: string; compact?: boolean }) {
  const { toast } = useToast();
  const status = useCrawlerStatus();
  const seoStatus = useSeoStatus();
  const queue = useQueueCrawl();
  const cancel = useCancelCrawl();
  const job = status.data?.sites[siteId];
  const busy = job && (job.status === "queued" || job.status === "running" || job.status === "saving");
  const canManage = !!seoStatus.data?.canManage;
  const online = (status.data?.online ?? 0) > 0;

  return (
    <div className={cn("flex flex-wrap items-center gap-2", compact && "text-xs")}>
      {job && <JobBadge job={job} />}
      {canManage && !busy && (
        <Button
          size="sm"
          variant="outline"
          loading={queue.isPending}
          onClick={() =>
            queue.mutate(
              { siteIds: [siteId] },
              {
                onSuccess: () =>
                  toast({
                    variant: "success",
                    title: "Crawl queued",
                    description: online ? "The helper starts it within a minute." : "No helper is online — it starts when one is.",
                  }),
                onError: (e) => toast({ variant: "error", title: "Couldn't queue the crawl", description: e.messages?.[0] ?? e.message }),
              },
            )
          }
        >
          <ScanSearch className="size-4" />
          Crawl now
        </Button>
      )}
      {canManage && job?.status === "queued" && (
        <Button size="sm" variant="ghost" loading={cancel.isPending} onClick={() => cancel.mutate(job.id)} title="Take it out of the queue">
          <X className="size-4" />
          Cancel
        </Button>
      )}
    </div>
  );
}

function JobBadge({ job }: { job: CrawlJob }) {
  const s = JOB[job.status];
  const when =
    job.status === "running"
      ? `on ${job.helper ?? "a helper"} since ${fmtAgo(job.claimedAt)}`
      : job.status === "saving"
        ? "updating the scores…"
        : job.status === "queued"
        ? `since ${fmtAgo(job.requestedAt)}`
        : fmtAgo(job.finishedAt);
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground" title={job.message ?? undefined}>
      <Badge tone={s.tone} icon={job.status === "running" || job.status === "saving" ? false : undefined}>
        {(job.status === "running" || job.status === "saving") && <Loader2 className="size-3 animate-spin" />}
        {s.label}
      </Badge>
      {when}
      {job.status === "failed" && job.message && <span className="max-w-md truncate text-text-destructive">{job.message}</span>}
    </span>
  );
}

/* ---------------------------------------------------------------- settings ---- */

/** Settings → Integrations: the helper PCs' keys (one per PC, shown once), and recent crawls. */
export function CrawlerSettings() {
  const { toast } = useToast();
  const keys = useCrawlerKeys();
  const status = useCrawlerStatus();
  const create = useCreateCrawlerKey();
  const revoke = useRevokeCrawlerKey();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [created, setCreated] = useState<{ name: string; key: string } | null>(null);
  const [confirm, setConfirm] = useState<{ id: string; name: string } | null>(null);

  const close = () => {
    setOpen(false);
    setName("");
    setCreated(null);
  };

  return (
    <div id="sf-crawler" className="flex scroll-mt-24 flex-col gap-4">
      <ol className="list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
        <li>On the PC with the licensed Screaming Frog, put the <b>SF-Helper</b> folder somewhere permanent (e.g. <code>C:\SF-Helper</code>) and install Python 3.10+.</li>
        <li>
          Create a key here and paste it into <code>config.json</code> as <code>crawler_key</code> (set <code>api_base</code> to this Super App&apos;s address +{" "}
          <code>/api/v1</code>).
        </li>
        <li>
          Run <b>1-check.bat</b>, then <b>3-start-with-windows.bat</b>. From then on the helper starts with Windows and crawls whatever is queued on the SEO pages
          (&quot;Crawl all sites&quot; / &quot;Crawl now&quot;).
        </li>
      </ol>

      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-medium text-muted-foreground">Helper PCs</div>
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="size-4" />
          New key
        </Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Key</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Helper</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {keys.isPending ? (
            <TableMessageRow colSpan={5}>
              <Skeleton className="h-8 w-full" />
            </TableMessageRow>
          ) : !keys.data?.length ? (
            <TableMessageRow colSpan={5}>
              <p className="py-4 text-center text-sm text-muted-foreground">No helper keys yet — create one for each PC that will crawl.</p>
            </TableMessageRow>
          ) : (
            keys.data.map((k) => (
              <TableRow key={k.id} className={cn(k.revokedAt && "opacity-60")}>
                <TableCell className="font-medium">{k.name}</TableCell>
                <TableCell className="font-mono text-xs">sfk_…{k.hint}</TableCell>
                <TableCell>
                  {k.revokedAt ? (
                    <Badge tone="neutral">Revoked</Badge>
                  ) : k.online ? (
                    <Badge tone="success">Online</Badge>
                  ) : k.lastSeenAt ? (
                    <span className="text-xs text-muted-foreground">Last seen {fmtAgo(k.lastSeenAt)}</span>
                  ) : (
                    <span className="text-xs text-muted-foreground">Never connected</span>
                  )}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {k.helperName ? `${k.helperName}${k.helperVersion ? ` · v${k.helperVersion}` : ""}` : "—"}
                </TableCell>
                <TableCell>
                  {!k.revokedAt && (
                    <Button size="sm" variant="ghost" aria-label={`Revoke ${k.name}`} title="Revoke: this PC can't ask for crawls any more" onClick={() => setConfirm({ id: k.id, name: k.name })}>
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      {(status.data?.recent.length ?? 0) > 0 && (
        <div className="flex flex-col gap-2">
          <div className="text-xs font-medium text-muted-foreground">Recent crawls</div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Site</TableHead>
                <TableHead>Result</TableHead>
                <TableHead>Requested</TableHead>
                <TableHead>Helper</TableHead>
                <TableHead align="right">URLs</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {status.data!.recent.slice(0, 8).map((j) => (
                <TableRow key={j.id}>
                  <TableCell>{j.siteName ?? j.domain}</TableCell>
                  <TableCell>
                    <Badge tone={JOB[j.status].tone}>{JOB[j.status].label}</Badge>
                    {j.status === "failed" && j.message && <div className="mt-1 max-w-sm text-xs text-muted-foreground">{j.message}</div>}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs">{fmtDateTime(j.requestedAt)}</TableCell>
                  <TableCell className="text-xs">{j.helper ?? "—"}</TableCell>
                  <TableCell align="right">{j.urls ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog
        open={open}
        onClose={close}
        title={created ? `Key for ${created.name}` : "New helper key"}
        description={created ? "Copy it now — it is shown only once. Paste it into config.json as crawler_key on that PC." : "One key per PC, so each can be switched off on its own."}
        footer={
          created ? (
            <Button onClick={close}>Done</Button>
          ) : (
            <>
              <Button variant="outline" onClick={close}>
                Cancel
              </Button>
              <Button
                loading={create.isPending}
                disabled={!name.trim()}
                onClick={() =>
                  create.mutate(name.trim(), {
                    onSuccess: (r) => setCreated({ name: r.name, key: r.key }),
                    onError: (e) => toast({ variant: "error", title: "Couldn't create the key", description: e.messages?.[0] ?? e.message }),
                  })
                }
              >
                Create key
              </Button>
            </>
          )
        }
      >
        {created ? (
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded-md border border-border bg-muted px-3 py-2 font-mono text-xs">{created.key}</code>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void navigator.clipboard?.writeText(created.key);
                toast({ variant: "success", title: "Key copied" });
              }}
            >
              <Copy className="size-4" />
              Copy
            </Button>
          </div>
        ) : (
          <Field label="Name" hint="Which PC it's for, e.g. “Usama laptop”">
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Usama laptop" data-autofocus />
          </Field>
        )}
      </Dialog>

      <Dialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        tone="danger"
        title={confirm ? `Revoke the key for ${confirm.name}?` : ""}
        description="That PC's helper can no longer ask for crawls. Crawls already imported stay."
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              loading={revoke.isPending}
              onClick={() =>
                confirm &&
                revoke.mutate(confirm.id, {
                  onSuccess: () => {
                    toast({ variant: "success", title: "Key revoked" });
                    setConfirm(null);
                  },
                })
              }
            >
              Revoke
            </Button>
          </>
        }
      />
    </div>
  );
}
