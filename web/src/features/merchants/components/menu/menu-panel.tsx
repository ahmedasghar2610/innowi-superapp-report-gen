"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Circle,
  CircleAlert,
  CircleCheck,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  ImageOff,
  Images,
  LoaderCircle,
  RefreshCw,
  Search,
  Utensils,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Select,
  Skeleton,
  StatTile,
  useToast,
} from "@/components/ui";
import { useExtractMenu, useMerchantMenu } from "@/features/merchants/api";
import { invalidateProfileDerived } from "@/features/merchants/api/invalidate-profile-derived";
import type { MenuItem, MerchantMenu } from "@/features/merchants/types";
import { menu as menuApi } from "@/lib/api/resources/menu";
import { isApiError } from "@/lib/api/client";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils/cn";

const HIDDEN_REASON: Record<string, string> = {
  NO_IMAGE: "No photo",
  LOGO_GRAPHIC: "Logo graphic",
  REPEATED_GRAPHIC: "Placeholder photo",
};

const ORDERING_PLACEHOLDER = "https://online-ordering.innowi.com/branch/restaurant-name";

function formatPrice(price: number | null): string {
  if (price === null || price === undefined) return "";
  return price.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
}

/**
 * Menu tab (route: /merchants/[merchantId]/menu). Pulls the merchant's menu —
 * items, prices, categories and photos — from their Innowi Online Ordering
 * page (backend: routers/menu.py + menu_extractor.py, a port of the desktop
 * "Innowi Menu Scraper"). Logo copies and stock placeholder photos are hidden
 * by default and can be shown with "Show hidden".
 */
export function MenuPanel({ merchantId }: { merchantId: string }) {
  const { data, isPending, isError, error, refetch } = useMerchantMenu(merchantId);

  if (isError) {
    return (
      <Card className="mt-4">
        <ErrorState title="Couldn't load the menu" error={error} onRetry={() => refetch()} />
      </Card>
    );
  }
  if (isPending || !data) return <MenuSkeleton />;
  return <MenuView merchantId={merchantId} data={data} />;
}

function MenuView({ merchantId, data }: { merchantId: string; data: MerchantMenu }) {
  const [editing, setEditing] = useState(false);
  const running = data.lastStatus === "RUNNING";
  const showForm = !running && (!data.exists || editing);
  useCompletionNotice(merchantId, data);

  return (
    <div className="mt-4 flex flex-col gap-4">
      {data.exists ? (
        <SourceCard data={data} merchantId={merchantId} onChangeLink={() => setEditing((v) => !v)} editing={editing} />
      ) : null}
      {running ? <MenuLoading data={data} /> : null}
      {!running && data.lastStatus === "FAILED" && data.lastError ? (
        <div className="flex items-start gap-2.5 rounded-lg border border-border bg-destructive-subtle px-4 py-3 text-sm text-text-destructive">
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-medium">Last extraction failed{data.lastAttemptAt ? ` · ${formatDateTime(data.lastAttemptAt)}` : ""}</p>
            <p className="mt-0.5">{data.lastError}</p>
            {data.exists ? <p className="mt-0.5 text-muted-foreground">The menu below is from the previous successful run.</p> : null}
          </div>
        </div>
      ) : null}
      {showForm ? <ExtractForm merchantId={merchantId} data={data} onDone={() => setEditing(false)} /> : null}
      {running && !data.exists ? <MenuGridSkeleton /> : null}
      {data.exists ? (
        <div className={cn("flex flex-col gap-4 transition-opacity", running && "pointer-events-none opacity-50")}>
          <MenuItems data={data} />
        </div>
      ) : null}
    </div>
  );
}

/** Toast + refresh the merchant views when a background run finishes. */
function useCompletionNotice(merchantId: string, data: MerchantMenu) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const prev = useRef(data.lastStatus);
  useEffect(() => {
    const was = prev.current;
    prev.current = data.lastStatus;
    if (was !== "RUNNING" || data.lastStatus === "RUNNING") return;
    if (data.lastStatus === "OK") {
      toast({
        variant: "success",
        title: "Menu loaded",
        description: `${data.stats.total} items · ${data.stats.valid} with photos`,
      });
      // The link may have been saved to the merchant's "Online ordering".
      invalidateProfileDerived(qc, merchantId);
    } else if (data.lastStatus === "FAILED") {
      toast({ variant: "error", title: "Couldn't load the menu", description: data.lastError ?? undefined });
    }
  }, [data.lastStatus, data.lastError, data.stats.total, data.stats.valid, merchantId, qc, toast]);
}

/* ----------------------------------------------------------------- loading */

const STEPS: { key: string; label: string }[] = [
  { key: "connecting", label: "Connecting to Innowi Online Ordering" },
  { key: "menu", label: "Reading the menu — items, prices, categories" },
  { key: "images", label: "Checking every photo" },
  { key: "saving", label: "Saving" },
];

function stepIndex(phase: string | undefined): number {
  if (phase === "done") return 3;
  const i = STEPS.findIndex((s) => s.key === phase);
  return i < 0 ? 0 : i;
}

function percent(p: MerchantMenu["progress"]): number {
  if (!p) return 4;
  switch (p.phase) {
    case "connecting":
      return 6;
    case "menu":
      return 15;
    case "images":
      return p.total > 0 ? 20 + Math.round((75 * p.done) / p.total) : 20;
    default:
      return 97;
  }
}

function MenuLoading({ data }: { data: MerchantMenu }) {
  const p = data.progress;
  const current = stepIndex(p?.phase);
  const pct = percent(p);
  const link = data.sourceUrl ?? data.merchantOnlineOrdering;

  return (
    <Card aria-live="polite" aria-busy="true">
      <div className="flex items-start gap-3 px-[18px] pt-4">
        <div className="grid size-10 shrink-0 place-items-center rounded-[11px] bg-accent text-primary">
          <LoaderCircle className="size-5 animate-spin" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-foreground">
            {data.exists ? "Refreshing the menu…" : "Loading the menu…"}
          </h3>
          <p className="mt-0.5 truncate text-table text-muted-foreground">
            {link ? <>From {link.replace(/^https?:\/\//, "")}</> : "From Innowi Online Ordering"}
            {data.exists ? " · the current menu stays until the new one is ready" : ""}
          </p>
        </div>
        <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">{pct}%</span>
      </div>

      <div className="px-[18px] pt-3">
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary transition-[width] duration-700 ease-out" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <ol className="grid gap-2 px-[18px] py-4 text-sm sm:grid-cols-2">
        {STEPS.map((step, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <li key={step.key} className={cn("flex items-center gap-2", !done && !active && "text-muted-foreground")}>
              {done ? (
                <CircleCheck className="size-4 shrink-0 text-success-subtle-foreground" />
              ) : active ? (
                <LoaderCircle className="size-4 shrink-0 animate-spin text-primary" />
              ) : (
                <Circle className="size-4 shrink-0" />
              )}
              <span className={cn(active && "font-medium text-foreground")}>
                {step.label}
                {step.key === "images" && p?.phase === "images" && p.total > 0 ? (
                  <span className="tabular-nums text-muted-foreground"> · {p.done} / {p.total}</span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

function MenuGridSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-hidden>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[92px] rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-4 w-28" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-card">
            <Skeleton className="aspect-[4/3] w-full rounded-none" />
            <div className="flex items-center justify-between gap-3 px-3 py-3">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-10" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ source */

function SourceCard({
  data,
  merchantId,
  onChangeLink,
  editing,
}: {
  data: MerchantMenu;
  merchantId: string;
  onChangeLink: () => void;
  editing: boolean;
}) {
  const { toast } = useToast();
  const extract = useExtractMenu();
  const running = data.lastStatus === "RUNNING";

  function reExtract() {
    extract.mutate(
      {
        merchantId,
        input: {
          link: data.sourceUrl ?? undefined,
          excludeCatering: data.excludeCatering,
          filterGraphics: data.filterGraphics,
          saveLink: false,
        },
      },
      {
        onError: (err) =>
          toast({ variant: "error", title: "Couldn't refresh the menu", description: isApiError(err) ? err.messages[0] : undefined }),
      },
    );
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-4 px-[18px] py-4">
        <div className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-xl border border-border bg-muted">
          {data.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={data.logoUrl} alt="" className="size-full object-contain" />
          ) : (
            <Utensils className="size-6 text-muted-foreground" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold text-foreground">{data.restaurantName || "Menu"}</h3>
          {data.sourceUrl ? (
            <a
              href={data.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex max-w-full items-center gap-1 truncate text-xs text-primary hover:underline"
            >
              <span className="truncate">{data.sourceUrl.replace(/^https?:\/\//, "")}</span>
              <ExternalLink className="size-3 shrink-0" />
            </a>
          ) : null}
          <p className="mt-0.5 text-xs text-muted-foreground">
            Extracted {formatDateTime(data.extractedAt)}
            {data.extractedBy ? ` by ${data.extractedBy}` : ""}
            {data.excludeCatering ? " · catering skipped" : ""}
            {!data.filterGraphics ? " · placeholder filter off" : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onChangeLink} disabled={extract.isPending || running}>
            {editing ? "Cancel" : "Change link"}
          </Button>
          <a
            href={menuApi.exportUrl(merchantId, "valid")}
            className="inline-flex h-7 items-center gap-1 rounded-sm border border-border bg-card px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-accent [&_svg]:size-4"
          >
            <Download />
            Export CSV
          </a>
          <Button variant="default" size="sm" onClick={reExtract} loading={extract.isPending || running}>
            {!(extract.isPending || running) && <RefreshCw />}
            {running ? "Loading…" : "Re-extract"}
          </Button>
        </div>
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------- form */

function ExtractForm({ merchantId, data, onDone }: { merchantId: string; data: MerchantMenu; onDone: () => void }) {
  const extract = useExtractMenu();
  const initialLink = data.sourceUrl ?? data.merchantLink ?? "";
  const choices = data.merchantLinks ?? [];
  const [link, setLink] = useState(initialLink);
  const [excludeCatering, setExcludeCatering] = useState(data.excludeCatering);
  const [filterGraphics, setFilterGraphics] = useState(data.filterGraphics);
  const [saveLink, setSaveLink] = useState(true);
  const [fieldError, setFieldError] = useState<string | undefined>();

  useEffect(() => setLink(initialLink), [initialLink]);

  const savedNotUsable = !!data.merchantOnlineOrdering && !data.merchantLinkUsable && choices.length < 2;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setFieldError(undefined);
    if (!link.trim()) {
      setFieldError("Paste the merchant's Innowi online-ordering link.");
      return;
    }
    extract.mutate(
      { merchantId, input: { link: link.trim(), excludeCatering, filterGraphics, saveLink } },
      {
        onSuccess: () => onDone(),
        onError: (err) => {
          const msg = isApiError(err) ? err.messages[0] : "Something went wrong. Please try again.";
          setFieldError(msg);
        },
      },
    );
  }

  return (
    <Card>
      <form onSubmit={submit}>
        {!data.exists ? (
          <div className="flex items-start gap-3 border-b border-border px-[18px] py-4">
            <div className="grid size-10 shrink-0 place-items-center rounded-[11px] bg-muted text-muted-foreground">
              <Utensils className="size-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-foreground">Extract the menu</h3>
              <p className="mt-0.5 text-table text-muted-foreground">
                Pulls every item, price, category and photo from the merchant&apos;s Innowi Online Ordering page.
              </p>
            </div>
          </div>
        ) : null}
        <div className="flex flex-col gap-4 px-[18px] py-4">
          <Field
            label="Innowi online-ordering link"
            htmlFor="menu-link"
            error={fieldError}
            hint={
              choices.length > 1 && !data.merchantLink
                ? `"Online ordering" has ${choices.length} Innowi links — pick the branch the menu should come from.`
                : savedNotUsable
                  ? `"Online ordering" (${(data.merchantOnlineOrdering ?? "").slice(0, 80)}) has no Innowi ordering link — paste it here.`
                  : "e.g. https://online-ordering.innowi.com/branch/coffeeheist — the branch name alone works too."
            }
          >
            <Input
              id="menu-link"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder={ORDERING_PLACEHOLDER}
              aria-invalid={!!fieldError}
              disabled={extract.isPending}
              autoComplete="off"
            />
          </Field>
          {choices.length > 1 && (
            <div className="-mt-2 flex flex-wrap gap-1.5" aria-label="Innowi links in Online ordering">
              {choices.map((c) => (
                <Button key={c} type="button" size="xs" variant={link === c ? "default" : "outline"} onClick={() => setLink(c)} disabled={extract.isPending}>
                  {c.replace(/^https?:\/\/online-ordering\.innowi\.com\/branch\//, "")}
                </Button>
              ))}
            </div>
          )}
          <div className="flex flex-col gap-2 text-sm text-foreground">
            <Check checked={filterGraphics} onChange={setFilterGraphics} disabled={extract.isPending}>
              Hide logo copies and placeholder photos
              <span className="text-muted-foreground"> (recommended)</span>
            </Check>
            <Check checked={excludeCatering} onChange={setExcludeCatering} disabled={extract.isPending}>
              Skip catering categories
            </Check>
            <Check checked={saveLink} onChange={setSaveLink} disabled={extract.isPending}>
              Save this link as the merchant&apos;s &ldquo;Online ordering&rdquo; when it&apos;s empty
              <span className="text-muted-foreground"> (existing text is kept)</span>
            </Check>
          </div>
          <div className="flex items-center gap-3">
            <Button type="submit" variant="default" loading={extract.isPending}>
              {!extract.isPending && <Utensils />}
              {data.exists ? "Extract from this link" : "Extract menu"}
            </Button>
            <span className="text-xs text-muted-foreground">Runs in the background — usually under a minute.</span>
          </div>
        </div>
      </form>
    </Card>
  );
}

function Check({
  checked,
  onChange,
  disabled,
  children,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className={cn("flex cursor-pointer items-center gap-2", disabled && "cursor-default opacity-60")}>
      <input
        type="checkbox"
        className="size-4 rounded border-border accent-[var(--primary)]"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{children}</span>
    </label>
  );
}

/* ------------------------------------------------------------------- items */

function MenuItems({ data }: { data: MerchantMenu }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [showHidden, setShowHidden] = useState(false);

  const hiddenCount = data.items.filter((i) => i.status !== "VALID").length;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.items.filter(
      (i) =>
        (showHidden || i.status === "VALID") &&
        (!category || (i.category ?? "") === category) &&
        (!q || i.name.toLowerCase().includes(q) || (i.description ?? "").toLowerCase().includes(q)),
    );
  }, [data.items, query, category, showHidden]);

  const groups = useMemo(() => {
    const order = [...data.categories, ""];
    const map = new Map<string, MenuItem[]>();
    for (const it of filtered) {
      const key = it.category ?? "";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(it);
    }
    return order.filter((c) => map.has(c)).map((c) => ({ name: c || "Other", items: map.get(c)! }));
  }, [filtered, data.categories]);

  const categoryCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of data.items) {
      if (!showHidden && it.status !== "VALID") continue;
      m.set(it.category ?? "", (m.get(it.category ?? "") ?? 0) + 1);
    }
    return m;
  }, [data.items, showHidden]);

  const s = data.stats;

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Menu items" icon={Utensils} value={s.total} />
        <StatTile label="With photos" icon={Images} value={s.valid} />
        <StatTile label="Placeholder photos hidden" icon={EyeOff} value={s.graphicSkipped} hint="Copies of the logo, or one stock image used by more than five items" />
        <StatTile label="No photo" icon={ImageOff} value={s.noImage} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search menu items" className="pl-8" aria-label="Search menu items" />
        </div>
        <Select value={category} onChange={(e) => setCategory(e.target.value)} className="w-auto min-w-[200px]" aria-label="Category">
          <option value="">All categories ({showHidden ? s.total : s.valid})</option>
          {data.categories
            .filter((c) => categoryCounts.has(c))
            .map((c) => (
              <option key={c} value={c}>
                {c} ({categoryCounts.get(c)})
              </option>
            ))}
        </Select>
        {hiddenCount > 0 ? (
          <Button variant="outline" size="default" onClick={() => setShowHidden((v) => !v)}>
            {showHidden ? <EyeOff /> : <Eye />}
            {showHidden ? "Hide filtered items" : `Show hidden (${hiddenCount})`}
          </Button>
        ) : null}
      </div>

      {groups.length === 0 ? (
        <Card>
          <EmptyState
            icon={Search}
            title="No items match"
            description={query || category ? "Try a different search or category." : "Every item was filtered out — use “Show hidden” to see them."}
          />
        </Card>
      ) : (
        groups.map((g) => (
          <section key={g.name}>
            <div className="mb-2 flex items-baseline gap-2">
              <h3 className="text-sm font-semibold text-foreground">{g.name}</h3>
              <span className="text-xs text-muted-foreground">{g.items.length}</span>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {g.items.map((it) => (
                <MenuItemCard key={it.id} item={it} />
              ))}
            </div>
          </section>
        ))
      )}
    </>
  );
}

function MenuItemCard({ item }: { item: MenuItem }) {
  const [broken, setBroken] = useState(false);
  const hidden = item.status !== "VALID";
  const showImage = item.imageUrl && !broken && item.status !== "NO_IMAGE";
  return (
    <Card className={cn("flex flex-col", hidden && "opacity-70")}>
      <div className="relative aspect-[4/3] overflow-hidden bg-muted">
        {showImage ? (
          <a href={item.imageUrl!} target="_blank" rel="noreferrer" title="Open full-size photo" className="block size-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={item.imageUrl!}
              alt={item.name}
              loading="lazy"
              className="size-full object-cover"
              onError={() => setBroken(true)}
            />
          </a>
        ) : (
          <div className="grid size-full place-items-center text-muted-foreground">
            <ImageOff className="size-6" />
          </div>
        )}
        {hidden ? (
          <Badge tone="warning" className="absolute left-2 top-2">
            {HIDDEN_REASON[item.status] ?? item.status}
          </Badge>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col gap-0.5 px-3 py-2.5">
        <div className="flex items-start justify-between gap-2">
          <p className="line-clamp-2 text-sm font-medium leading-5 text-foreground">{item.name}</p>
          {item.price !== null ? (
            <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">{formatPrice(item.price)}</span>
          ) : null}
        </div>
        {item.description ? <p className="line-clamp-2 text-xs text-muted-foreground">{item.description}</p> : null}
      </div>
    </Card>
  );
}

function MenuSkeleton() {
  return (
    <div className="mt-4 flex flex-col gap-4">
      <Skeleton className="h-[88px] w-full rounded-[var(--radius-card)]" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[92px] rounded-lg" />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {Array.from({ length: 10 }).map((_, i) => (
          <Skeleton key={i} className="aspect-[4/5] rounded-[var(--radius-card)]" />
        ))}
      </div>
    </div>
  );
}
