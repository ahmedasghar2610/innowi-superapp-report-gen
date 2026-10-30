"use client";

import { Fragment, useState } from "react";
import { ChevronDown, ChevronRight, Eye, ImageIcon, Video } from "lucide-react";
import { Badge, Button, Dialog, Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import { useAssets } from "../api";
import { CAMPAIGN_STATUS, channelLabel, fmtDay, fmtMoney, fmtNum, fmtPct } from "../lib";
import type { AccountDetail, Asset, Campaign } from "../types";
import { Delta, HeadHint, NoData, RoasChip, RoasValue } from "./parts";

export function CampaignsTab({ d }: { d: AccountDetail }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<Campaign | null>(null);
  const toggle = (id: string) => setOpen((s) => (s.has(id) ? (s.delete(id), new Set(s)) : new Set(s.add(id))));

  if (!d.campaigns.length) return <p className="text-sm text-muted-foreground">No campaigns in this account.</p>;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">Performance Max and other campaign types, as in Google Ads. Expand a row for the full metrics and the n8n analysis.</p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8" />
            <TableHead>Campaign</TableHead>
            <TableHead>Status</TableHead>
            <TableHead align="right">Daily budget</TableHead>
            <TableHead>Start</TableHead>
            <TableHead>End</TableHead>
            <TableHead align="right">Spend</TableHead>
            <TableHead align="right">Impressions</TableHead>
            <TableHead align="right">Clicks</TableHead>
            <TableHead align="right">Orders</TableHead>
            <TableHead align="right">
              <HeadHint label="Cost / order" hint="Spend ÷ orders. N/A with no orders." />
            </TableHead>
            <TableHead align="right">Revenue</TableHead>
            <TableHead align="right">ROI</TableHead>
            <TableHead align="right">ROAS</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {d.campaigns.map((c) => {
            const isOpen = open.has(c.id);
            const st = CAMPAIGN_STATUS[c.status] ?? CAMPAIGN_STATUS.UNKNOWN;
            return (
              <Fragment key={c.id}>
                <TableRow interactive onClick={() => toggle(c.id)} className={cn(isOpen && "border-b-0")}>
                  <TableCell>{isOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}</TableCell>
                  <TableCell className="min-w-56">
                    <div className="font-medium text-foreground">{c.name}</div>
                    <div className="text-xs text-muted-foreground">{channelLabel(c.channelType)}</div>
                  </TableCell>
                  <TableCell>
                    <Badge tone={st.tone}>{st.label}</Badge>
                  </TableCell>
                  <TableCell align="right">{c.dailyBudget == null ? "—" : fmtMoney(c.dailyBudget, { cents: true })}</TableCell>
                  <TableCell className="whitespace-nowrap">{fmtDay(c.startDate)}</TableCell>
                  <TableCell className="whitespace-nowrap">{c.endDate ? fmtDay(c.endDate) : "Ongoing"}</TableCell>
                  <TableCell align="right">
                    {fmtMoney(c.metrics.spend, { cents: false })}
                    {c.previous && <Delta cur={c.metrics.spend} prev={c.previous.metrics.spend} better="none" className="block" title={`Previous: ${fmtMoney(c.previous.metrics.spend, { cents: false })}`} />}
                  </TableCell>
                  <TableCell align="right">{fmtNum(c.metrics.impressions)}</TableCell>
                  <TableCell align="right">{fmtNum(c.metrics.clicks)}</TableCell>
                  <TableCell align="right">
                    {fmtNum(c.metrics.orders)}
                    {c.previous && <Delta cur={c.metrics.orders} prev={c.previous.metrics.orders} className="block" title={`Previous: ${fmtNum(c.previous.metrics.orders)}`} />}
                  </TableCell>
                  <TableCell align="right">{c.costPerOrder == null ? <NoData label="N/A" /> : fmtMoney(c.costPerOrder)}</TableCell>
                  <TableCell align="right">
                    {c.revenue == null ? <NoData label="N/A" /> : fmtMoney(c.revenue, { cents: false })}
                    {c.previous && c.revenue != null && <Delta cur={c.revenue} prev={c.previous.revenue} className="block" title={`Previous: ${fmtMoney(c.previous.revenue, { cents: false })}`} />}
                  </TableCell>
                  <TableCell align="right">{fmtPct(c.roi)}</TableCell>
                  <TableCell align="right">
                    <RoasValue roas={c.roas} status={c.roasStatus} />
                  </TableCell>
                  <TableCell>
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPreview(c);
                      }}
                    >
                      <Eye className="size-4" />
                      Preview Ads
                    </Button>
                  </TableCell>
                </TableRow>
                {isOpen && (
                  <TableRow>
                    <TableCell />
                    <TableCell colSpan={14}>
                      <div className="grid grid-cols-2 gap-3 pb-2 sm:grid-cols-4 lg:grid-cols-7">
                        {(
                          [
                            ["Calls", fmtNum(c.metrics.calls)],
                            ["Directions", fmtNum(c.metrics.directions)],
                            ["Website visits", fmtNum(c.metrics.website)],
                            ["Menu views", fmtNum(c.metrics.menu)],
                            ["Avg ticket size", d.avgTicket == null ? "Not set" : fmtMoney(d.avgTicket)],
                            ["Campaign type", channelLabel(c.channelType)],
                            ["ROAS status", <RoasChip key="s" status={c.roasStatus} />],
                          ] as [string, React.ReactNode][]
                        ).map(([k, v]) => (
                          <div key={k} className="flex flex-col gap-0.5">
                            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{k}</span>
                            <span className="text-sm font-medium text-foreground">{v}</span>
                          </div>
                        ))}
                      </div>
                      {c.analysis && <p className="pb-2 text-sm text-muted-foreground">{c.analysis}</p>}
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
      {preview && <PreviewDialog accountId={d.id} business={d.name} campaign={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

const IMAGE_LABEL: Record<string, string> = {
  SQUARE_MARKETING_IMAGE: "Square image",
  MARKETING_IMAGE: "Landscape image",
  PORTRAIT_MARKETING_IMAGE: "Portrait image",
  LOGO: "Square logo",
  LANDSCAPE_LOGO: "Landscape logo",
};

function Thumb({ a, className }: { a: Asset; className?: string }) {
  const label = a.details.label ?? IMAGE_LABEL[a.fieldType] ?? a.name ?? "Image";
  if (a.imageUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={a.imageUrl} alt={label} className={cn("rounded-md border border-border object-cover", className)} />;
  }
  return (
    <div className={cn("flex flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border bg-muted text-center text-[11px] text-muted-foreground", className)}>
      <ImageIcon className="size-4" />
      {label}
      {a.width && a.height && <span>{a.width}×{a.height}</span>}
    </div>
  );
}

/** One representative combination of the campaign's assets — Performance Max
 *  assembles them automatically, so the live ad varies. Built from the synced
 *  assets (Google's API doesn't render ad previews). */
function PreviewDialog({ accountId, business, campaign, onClose }: { accountId: string; business: string; campaign: Campaign; onClose: () => void }) {
  const assets = useAssets(accountId);
  const mine = (assets.data ?? []).filter((a) => (a.campaignId === campaign.id || a.level === "account") && a.status !== "REMOVED");
  const by = (ft: string[]) => mine.filter((a) => ft.includes(a.fieldType));
  const headlines = by(["HEADLINE"]);
  const longs = by(["LONG_HEADLINE"]);
  const descs = by(["DESCRIPTION"]);
  const images = mine.filter((a) => a.kind === "image" || a.kind === "logo");
  const logo = mine.find((a) => a.kind === "logo");
  const hero = mine.find((a) => a.kind === "image");
  const sitelinks = mine.filter((a) => a.kind === "sitelink");
  const promos = mine.filter((a) => a.kind === "promotion");
  const videos = mine.filter((a) => a.kind === "video");
  const name = by(["BUSINESS_NAME"])[0]?.text ?? business;

  return (
    <Dialog open onClose={onClose} size="3xl" title="Ad preview" description={`${campaign.name} · ${channelLabel(campaign.channelType)}`}>
      {assets.isPending ? (
        <Skeleton className="h-80 w-full" />
      ) : !mine.length ? (
        <p className="text-sm text-muted-foreground">No assets synced for this campaign yet.</p>
      ) : (
        <div className="grid gap-5 md:grid-cols-[18rem_1fr]">
          <div className="flex flex-col gap-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Assembled preview</div>
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              {hero ? <Thumb a={hero} className="aspect-square w-full rounded-none border-0" /> : <div className="aspect-square bg-muted" />}
              <div className="flex flex-col gap-1.5 p-3">
                <div className="flex items-center gap-2">
                  {logo ? <Thumb a={logo} className="size-8 rounded-full text-[0px]" /> : null}
                  <div>
                    <div className="text-sm font-semibold text-foreground">{name}</div>
                    <div className="text-[11px] text-muted-foreground">Ad · Sponsored</div>
                  </div>
                </div>
                <div className="text-sm font-medium text-foreground">{longs[0]?.text ?? headlines[0]?.text}</div>
                <div className="text-xs text-muted-foreground">{descs[0]?.text}</div>
                {promos[0] && (
                  <Badge tone="accent" icon={false} className="w-fit">
                    {promos[0].details.discount ?? promos[0].text}
                    {promos[0].details.code ? ` · ${promos[0].details.code}` : ""}
                  </Badge>
                )}
                <div className="flex flex-wrap gap-1">
                  {sitelinks.filter((s) => s.status === "ENABLED").slice(0, 3).map((s) => (
                    <span key={s.id} className="rounded-full border border-border px-2 py-0.5 text-[11px] text-primary">
                      {s.details.linkText ?? s.text}
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">Performance Max assembles assets automatically, so the live ad will vary. This shows one representative combination.</p>
          </div>
          <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto pr-1 text-sm">
            <List title="Business name" items={[name]} />
            <List title={`Headlines (${headlines.length})`} items={headlines.map((h) => h.text ?? "")} />
            <List title={`Long headlines (${longs.length})`} items={longs.map((h) => h.text ?? "")} />
            <List title={`Descriptions (${descs.length})`} items={descs.map((h) => h.text ?? "")} />
            {images.length > 0 && (
              <div>
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Images & logo ({images.length})</div>
                <div className="grid grid-cols-3 gap-2">
                  {images.map((a) => (
                    <Thumb key={a.id} a={a} className="aspect-square w-full" />
                  ))}
                </div>
              </div>
            )}
            {videos.length > 0 && (
              <div>
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Videos ({videos.length})</div>
                {videos.map((v) => (
                  <div key={v.id} className="flex items-center gap-2 text-foreground">
                    <Video className="size-4 text-muted-foreground" />
                    {v.details.youtubeId ? (
                      <a href={`https://www.youtube.com/watch?v=${v.details.youtubeId}`} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                        {v.name ?? v.details.youtubeId}
                      </a>
                    ) : (
                      v.name
                    )}
                  </div>
                ))}
              </div>
            )}
            {promos.length > 0 && (
              <List title="Google Ads promotions" items={promos.map((p) => [p.text, p.details.code, p.details.startDate ? `${fmtDay(p.details.startDate)} – ${p.details.endDate ? fmtDay(p.details.endDate) : "Ongoing"}` : null].filter(Boolean).join(" · "))} />
            )}
            {sitelinks.length > 0 && (
              <List
                title={`Sitelinks (${sitelinks.length})`}
                items={sitelinks.map((s) => `${s.details.linkText ?? s.text}${s.status === "PAUSED" ? " (paused)" : ""}${s.details.description1 ? ` — ${s.details.description1}` : ""}`)}
              />
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
      <ul className="flex flex-col gap-0.5 text-foreground">
        {items.map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ul>
    </div>
  );
}
