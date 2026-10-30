"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowUpRight, Check, ChevronDown, Eye, Globe, Loader2, Lock } from "lucide-react";
import { Badge, Button, Dialog, useToast } from "@/components/ui";
import { useCan } from "@/features/auth/use-can";
import { cn } from "@/lib/utils/cn";
import { siteUrl, websitesApi } from "../api/client";
import { useUpdateWebsite } from "../api/websites.queries";
import { WEBSITE_STATUS, isPublicStatus, type Website, type WebsiteStatus } from "../types";
import { WEBSITE_STATUS_META } from "./website-status-badge";

export const PUBLISH_DENIED = "Requires Website publish permission — contact Admin";

/** Does moving `from` → `to` publish, unpublish or take the site down? (API rule, mirrored.) */
export function needsPublishRight(from: WebsiteStatus | undefined, to: WebsiteStatus): boolean {
  const wasPublic = from ? isPublicStatus(from) : false;
  return wasPublic !== isPublicStatus(to) || (to === "inactive" && from !== to);
}

/**
 * Change a website's status from wherever the site is shown (Websites list,
 * cards, the merchant's Website & SEO tab). A chip-style select grouped into
 * "Not public" / "Public"; publishing, unpublishing or taking a site down asks
 * for confirmation first, and roles without `website.publish` see those
 * options disabled with the PRD's message (Super App PRD §17).
 */
export function WebsiteStatusControl({ website, size = "sm" }: { website: Website; size?: "sm" | "md" }) {
  const { toast } = useToast();
  const can = useCan();
  const canPublish = can("website.publish");
  const canEdit = can("website.edit");
  const update = useUpdateWebsite();
  const [pending, setPending] = useState<WebsiteStatus | null>(null);
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  const current = website.status;
  const meta = WEBSITE_STATUS_META[current] ?? WEBSITE_STATUS_META.in_creation;
  const Icon = update.isPending ? Loader2 : meta.icon;

  const apply = (next: WebsiteStatus) => {
    update.mutate(
      { id: website.id, input: { status: next } },
      {
        onSuccess: () => {
          setPending(null);
          toast({
            variant: "success",
            title: `${website.name}: ${WEBSITE_STATUS_META[next].label}`,
            description: isPublicStatus(next) ? "The site is public at its URL." : "The site isn't public.",
          });
        },
        onError: (err) => {
          setPending(null);
          toast({ variant: "error", title: "Couldn't change the status", description: err.messages.join(" · ") });
        },
      },
    );
  };

  const choose = (next: WebsiteStatus) => {
    if (next === current) return;
    if (needsPublishRight(current, next)) setPending(next);
    else apply(next);
  };

  const target = pending ? WEBSITE_STATUS_META[pending] : null;
  const goingPublic = pending ? isPublicStatus(pending) && !isPublicStatus(current) : false;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        title={`${meta.label} — ${meta.hint}`}
        aria-label={`Status for ${website.name}: ${meta.label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={update.isPending || !canEdit}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 font-semibold leading-none transition-opacity hover:opacity-90",
          size === "sm" ? "py-0.5 text-xs" : "py-1 text-sm",
          "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent disabled:cursor-default disabled:hover:opacity-100",
          meta.chip,
          update.isPending && "opacity-70",
        )}
      >
        <Icon className={cn("size-4 shrink-0", update.isPending && "animate-spin")} aria-hidden />
        {meta.label}
        {canEdit && <ChevronDown className="size-3.5 shrink-0 opacity-70" aria-hidden />}
      </button>

      {open && (
        <StatusMenu
          anchor={btnRef}
          current={current}
          canPublish={canPublish}
          onPick={(s) => {
            setOpen(false);
            choose(s);
          }}
          onClose={() => setOpen(false)}
        />
      )}

      <Dialog
        open={Boolean(pending)}
        onClose={() => setPending(null)}
        tone={pending === "inactive" ? "danger" : goingPublic ? "success" : "warning"}
        icon={<Globe />}
        title={
          pending === "inactive"
            ? `Take ${website.name} offline?`
            : goingPublic
              ? `Publish ${website.name}?`
              : `Unpublish ${website.name}?`
        }
        description={
          pending === "inactive"
            ? `Visitors to ${siteUrl(website.slug)} will see that the site is unavailable. Nothing is deleted — set it back to Live any time.`
            : goingPublic
              ? `It will be public at ${siteUrl(website.slug)} (${target?.label}).`
              : `Visitors will see a "coming soon" page instead of the site until it is published again. Staff can still preview it.`
        }
        dismissible={!update.isPending}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPending(null)} disabled={update.isPending}>
              Cancel
            </Button>
            <Button
              variant={pending === "inactive" ? "destructive" : "default"}
              onClick={() => pending && apply(pending)}
              loading={update.isPending}
            >
              {pending === "inactive" ? "Take offline" : goingPublic ? "Publish" : `Set to ${target?.label}`}
            </Button>
          </>
        }
      />
    </>
  );
}

/**
 * The status list, portalled to <body> with fixed positioning so table
 * overflow can't clip it. Grouped Not public / Public; options that need
 * `website.publish` are shown disabled with the PRD message. Closes on
 * outside click, Escape, scroll or resize.
 */
function StatusMenu({
  anchor,
  current,
  canPublish,
  onPick,
  onClose,
}: {
  anchor: React.RefObject<HTMLButtonElement | null>;
  current: WebsiteStatus;
  canPublish: boolean;
  onPick: (s: WebsiteStatus) => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const place = useCallback(() => {
    const btn = anchor.current;
    const menu = menuRef.current;
    if (!btn || !menu) return;
    const r = btn.getBoundingClientRect();
    const h = menu.offsetHeight;
    const w = menu.offsetWidth;
    const below = r.bottom + 4 + h <= window.innerHeight - 8;
    const top = below ? r.bottom + 4 : Math.max(8, r.top - 4 - h);
    const left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8);
    setPos({ top, left });
  }, [anchor]);

  useLayoutEffect(place, [place]);

  useEffect(() => {
    menuRef.current?.querySelector<HTMLButtonElement>('button[aria-checked="true"]')?.focus();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || anchor.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        anchor.current?.focus();
        return;
      }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>("button:not([disabled])") ?? []);
      const i = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = e.key === "ArrowDown" ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
      items[next]?.focus();
    };
    const onMove = (e: Event) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onClose);
    };
  }, [anchor, onClose]);

  const group = (label: string, statuses: readonly WebsiteStatus[]) => (
    <div role="group" aria-label={label} className="py-1">
      <p className="px-3 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      {statuses.map((s) => {
        const m = WEBSITE_STATUS_META[s];
        const ItemIcon = m.icon;
        const selected = s === current;
        const denied = !canPublish && !selected && needsPublishRight(current, s);
        return (
          <button
            key={s}
            type="button"
            role="menuitemradio"
            aria-checked={selected}
            disabled={denied}
            title={denied ? PUBLISH_DENIED : m.hint}
            onClick={() => onPick(s)}
            className={cn(
              "flex w-full items-start gap-2 px-3 py-1.5 text-left text-sm text-foreground",
              "hover:bg-muted focus-visible:bg-muted focus-visible:outline-none",
              selected && "bg-primary-subtle",
              denied && "cursor-not-allowed opacity-50 hover:bg-transparent",
            )}
          >
            <ItemIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{m.label}</span>
              <span className="block text-xs text-muted-foreground">{denied ? PUBLISH_DENIED : m.hint}</span>
            </span>
            {selected ? (
              <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
            ) : denied ? (
              <Lock className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            ) : null}
          </button>
        );
      })}
    </div>
  );

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label="Website status"
      style={{ position: "fixed", top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
      className="z-[110] max-h-[70vh] w-72 overflow-y-auto rounded-lg border border-border bg-background py-1 shadow-lg"
    >
      {group("Not public", WEBSITE_STATUS.filter((s) => !isPublicStatus(s)))}
      <div className="mx-3 border-t border-border" />
      {group("Public", WEBSITE_STATUS.filter((s) => isPublicStatus(s)))}
    </div>,
    document.body,
  );
}

/**
 * "Visit site" for a public site; "Preview" (a signed 24-hour link) for one
 * that isn't public yet — the plain URL would only show "coming soon".
 */
export function WebsiteOpenLink({ website }: { website: Website }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  if (isPublicStatus(website.status)) {
    return (
      <a
        href={siteUrl(website.slug)}
        target="_blank"
        rel="noreferrer"
        aria-label={`Visit ${website.name}`}
        title="Open the published site in a new tab"
        className="inline-flex rounded-full transition-opacity hover:opacity-90"
      >
        <Badge tone="primary">
          Visit site
          <ArrowUpRight aria-hidden />
        </Badge>
      </a>
    );
  }

  const open = async () => {
    // Open the tab synchronously (popup blockers), then point it at the link.
    const tab = window.open("about:blank", "_blank");
    setBusy(true);
    try {
      const { url } = await websitesApi.previewLink(website.id);
      if (tab) tab.location.href = url;
      else window.open(url, "_blank", "noopener");
    } catch {
      tab?.close();
      toast({ variant: "error", title: "Couldn't create a preview link" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={open}
      disabled={busy}
      aria-label={`Preview ${website.name}`}
      title="Not public yet — open a private preview (link valid 24 hours)"
      className="inline-flex rounded-full transition-opacity hover:opacity-90 disabled:opacity-60"
    >
      <Badge tone="neutral" icon={busy ? Loader2 : Eye}>
        Preview
      </Badge>
    </button>
  );
}
