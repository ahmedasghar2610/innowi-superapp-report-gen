"use client";

import { useMemo, useState } from "react";
import { Check, Copy, ExternalLink, ImageIcon } from "lucide-react";
import { Badge, Button, Card, Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableMessageRow, TableRow } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import { useAssets } from "../api";
import { CAMPAIGN_STATUS } from "../lib";
import type { Asset } from "../types";

const GROUPS: { key: string; label: string; match: (a: Asset) => boolean }[] = [
  { key: "images", label: "Images", match: (a) => a.kind === "image" },
  { key: "logos", label: "Logos", match: (a) => a.kind === "logo" },
  { key: "videos", label: "Videos", match: (a) => a.kind === "video" },
  { key: "headlines", label: "Headlines", match: (a) => a.fieldType === "HEADLINE" },
  { key: "long", label: "Long Headlines", match: (a) => a.fieldType === "LONG_HEADLINE" },
  { key: "descriptions", label: "Descriptions", match: (a) => a.fieldType === "DESCRIPTION" },
  { key: "business", label: "Business name", match: (a) => a.fieldType === "BUSINESS_NAME" },
  { key: "sitelinks", label: "Sitelinks", match: (a) => a.kind === "sitelink" },
  { key: "promotions", label: "Promotions", match: (a) => a.kind === "promotion" },
  { key: "callouts", label: "Callouts", match: (a) => a.kind === "callout" },
];

function Status({ s }: { s: Asset["status"] }) {
  const x = s === "ENABLED" ? { label: "Enabled", tone: "success" as const } : CAMPAIGN_STATUS[s] ?? CAMPAIGN_STATUS.UNKNOWN;
  return <Badge tone={x.tone}>{x.label}</Badge>;
}

function useAssetData(accountId: string) {
  const q = useAssets(accountId);
  return { ...q, rows: q.data ?? [] };
}

export function AssetsTab({ accountId }: { accountId: string }) {
  const { rows, isPending } = useAssetData(accountId);
  const groups = GROUPS.map((g) => ({ ...g, items: rows.filter(g.match) })).filter((g) => g.items.length);
  const [key, setKey] = useState<string | null>(null);
  const active = groups.find((g) => g.key === key) ?? groups[0];
  if (isPending) return <Skeleton className="h-64 w-full" />;
  if (!rows.length) return <p className="text-sm text-muted-foreground">No assets synced for this account yet.</p>;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1.5">
        {groups.map((g) => (
          <button
            key={g.key}
            type="button"
            aria-pressed={active?.key === g.key}
            onClick={() => setKey(g.key)}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium",
              active?.key === g.key ? "border-primary bg-accent text-primary-subtle-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            {g.label} <span className="tabular-nums opacity-70">{g.items.length}</span>
          </button>
        ))}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Asset</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Preview</TableHead>
            <TableHead>Campaign</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {active?.items.map((a) => (
            <TableRow key={a.id}>
              <TableCell className="max-w-md">
                <div className="truncate font-medium text-foreground">{a.name ?? a.text ?? a.details.linkText ?? `Asset ${a.googleId}`}</div>
                {a.name && a.text && <div className="truncate text-xs text-muted-foreground">{a.text}</div>}
              </TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground">{a.fieldType.toLowerCase().replace(/_/g, " ")}</TableCell>
              <TableCell>
                {a.kind === "image" || a.kind === "logo" ? (
                  a.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={a.imageUrl} alt={a.name ?? "asset"} className="h-10 w-14 rounded border border-border object-cover" />
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <ImageIcon className="size-4" />
                      {a.width && a.height ? `${a.width}×${a.height}` : "—"}
                    </span>
                  )
                ) : a.kind === "promotion" ? (
                  <span className="text-xs">{[a.details.discount, a.details.code].filter(Boolean).join(" · ")}</span>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell className="text-muted-foreground">{a.campaignName ?? "Whole account"}</TableCell>
              <TableCell>
                <Status s={a.status} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="text-xs text-muted-foreground">Google Ads doesn&apos;t report when an asset was added, so there is no date column. Last refreshed with the account.</p>
    </div>
  );
}

function CopyLine({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <li className="flex items-start gap-2 py-1.5">
      <span className="flex-1 text-sm text-foreground">{text}</span>
      <Button
        size="xs"
        variant="ghost"
        onClick={() => {
          void navigator.clipboard?.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        }}
      >
        {done ? <Check className="size-4" /> : <Copy className="size-4" />}
        {done ? "Copied" : "Copy"}
      </Button>
    </li>
  );
}

/** The ad text, de-duplicated across campaigns, ready to copy. */
export function ContentTab({ accountId }: { accountId: string }) {
  const { rows, isPending } = useAssetData(accountId);
  const blocks = useMemo(
    () =>
      (
        [
          ["Headlines", "HEADLINE"],
          ["Long headlines", "LONG_HEADLINE"],
          ["Descriptions", "DESCRIPTION"],
          ["Callouts", "CALLOUT"],
        ] as const
      ).map(([label, ft]) => ({ label, items: [...new Set(rows.filter((a) => a.fieldType === ft && a.status !== "REMOVED" && a.text).map((a) => a.text!))] })),
    [rows],
  );
  if (isPending) return <Skeleton className="h-64 w-full" />;
  if (!blocks.some((b) => b.items.length)) return <p className="text-sm text-muted-foreground">No ad text synced for this account yet.</p>;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {blocks
        .filter((b) => b.items.length)
        .map((b) => (
          <Card key={b.label} className="p-4">
            <div className="text-sm font-semibold text-foreground">
              {b.label} <span className="text-muted-foreground">{b.items.length}</span>
            </div>
            <ul className="mt-1 divide-y divide-border">
              {b.items.map((t) => (
                <CopyLine key={t} text={t} />
              ))}
            </ul>
          </Card>
        ))}
    </div>
  );
}

export function SitelinksTab({ accountId }: { accountId: string }) {
  const { rows, isPending } = useAssetData(accountId);
  const links = rows.filter((a) => a.kind === "sitelink");
  if (isPending) return <Skeleton className="h-48 w-full" />;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Sitelink title</TableHead>
          <TableHead>Description</TableHead>
          <TableHead>Destination URL</TableHead>
          <TableHead>Campaign</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {links.map((s) => (
          <TableRow key={s.id}>
            <TableCell className="font-medium">{s.details.linkText ?? s.text}</TableCell>
            <TableCell className="text-muted-foreground">{[s.details.description1, s.details.description2].filter(Boolean).join(" · ") || "—"}</TableCell>
            <TableCell>
              {s.details.finalUrl ? (
                <a href={s.details.finalUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                  {s.details.finalUrl.replace(/^https?:\/\//, "")}
                  <ExternalLink className="size-3.5" />
                </a>
              ) : (
                "—"
              )}
            </TableCell>
            <TableCell className="text-muted-foreground">{s.campaignName ?? "Whole account"}</TableCell>
            <TableCell>
              <Status s={s.status} />
            </TableCell>
          </TableRow>
        ))}
        {!links.length && (
          <TableMessageRow colSpan={5}>
            <p className="py-6 text-center text-sm text-muted-foreground">No sitelinks on this account.</p>
          </TableMessageRow>
        )}
      </TableBody>
    </Table>
  );
}
