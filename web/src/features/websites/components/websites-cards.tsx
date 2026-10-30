"use client";

import { KeyRound, Mail, MapPin, Pencil, Trash2 } from "lucide-react";
import { Badge, Button } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils/cn";
import type { Website } from "../types";
import { MerchantCell } from "./websites-table";
import { imagePreviewUrl } from "../api/client";
import { WebsiteOpenLink, WebsiteStatusControl } from "./website-status-control";
import { getString, websiteProgress } from "../lib/website-values";

interface WebsitesCardsProps {
  websites: Website[];
  onEdit: (website: Website) => void;
  onDelete: (website: Website) => void;
  onEditorAccess: (website: Website) => void;
  onLink?: (website: Website) => void;
}

function locationOf(website: Website): string {
  const values = website.values;
  return (
    getString(values, "business.city").trim() ||
    getString(values, "business.address").trim() ||
    getString(values, "business.country").trim()
  );
}

const HEX = /^#[0-9a-f]{3,8}$/i;

/**
 * Card view of the saved websites — same data and actions as the table
 * (Visit site, visual editor access, edit, delete), laid out as a grid. The
 * card header uses the site's own hero image or brand colours when set, so
 * sites are easy to tell apart at a glance.
 */
export function WebsitesCards({ websites, onEdit, onDelete, onEditorAccess, onLink }: WebsitesCardsProps) {
  return (
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Websites">
      {websites.map((website) => {
        const values = website.values;
        const progress = websiteProgress(values);
        const pct = Math.round((progress.complete / progress.total) * 100);
        const location = locationOf(website);
        const primary = getString(values, "brand.primary").trim();
        const secondary = getString(values, "brand.secondary").trim();
        const hero = getString(values, "hero.image").trim();
        const logo = getString(values, "brand.logo").trim();
        const heroSrc = hero ? imagePreviewUrl(hero) : "";
        const logoSrc = logo ? imagePreviewUrl(logo) : "";
        const bg = HEX.test(primary)
          ? `linear-gradient(135deg, ${primary}, ${HEX.test(secondary) ? secondary : primary})`
          : undefined;

        return (
          <li key={website.id} className="min-w-0">
            <article className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-background shadow-sm transition-shadow hover:shadow-md">
              <button
                type="button"
                onClick={() => onEdit(website)}
                aria-label={`Edit ${website.name}`}
                className={cn(
                  "relative flex h-32 w-full items-center justify-center overflow-hidden bg-muted focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent",
                  !bg && !heroSrc && "bg-primary-subtle",
                )}
                style={bg && !heroSrc ? { background: bg } : undefined}
              >
                {heroSrc ? (
                  // eslint-disable-next-line @next/next/no-img-element -- user-uploaded, arbitrary host
                  <img src={heroSrc} alt="" className="absolute inset-0 size-full object-cover" loading="lazy" />
                ) : null}
                {logoSrc ? (
                  // eslint-disable-next-line @next/next/no-img-element -- user-uploaded, arbitrary host
                  <img
                    src={logoSrc}
                    alt=""
                    className="relative max-h-16 max-w-[60%] rounded-md bg-background/85 object-contain p-2"
                    loading="lazy"
                  />
                ) : !heroSrc ? (
                  <span
                    aria-hidden
                    className={cn("text-3xl font-semibold", bg ? "text-white/90" : "text-primary-subtle-foreground")}
                  >
                    {website.name.trim().charAt(0).toUpperCase() || "?"}
                  </span>
                ) : null}
                {website.editorUpdatedAt && (
                  <Badge tone={website.editorBound ? "neutral" : "warning"} className="absolute left-2 top-2">
                    {website.editorBound ? "Visually edited" : "Edited in /admin"}
                  </Badge>
                )}
              </button>

              <div className="flex flex-1 flex-col gap-3 p-4">
                <div className="min-w-0">
                  <button
                    type="button"
                    onClick={() => onEdit(website)}
                    className="block max-w-full truncate text-left font-medium text-foreground hover:text-primary"
                  >
                    {website.name}
                  </button>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    /{website.slug}
                    {website.tagline ? ` · ${website.tagline}` : ""}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <WebsiteStatusControl website={website} />
                  <MerchantCell website={website} onLink={onLink} />
                </div>

                <div className="flex flex-col gap-1.5 text-xs text-muted-foreground">
                  <span className="inline-flex min-w-0 items-center gap-1.5">
                    <MapPin className="size-3.5 shrink-0" aria-hidden />
                    <span className="truncate">{location || "No location yet"}</span>
                  </span>
                  <span className="inline-flex min-w-0 items-center gap-1.5">
                    <Mail className="size-3.5 shrink-0" aria-hidden />
                    <span className="truncate">{website.contactEmail || "No contact email"}</span>
                  </span>
                </div>

                <div>
                  <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                    <span>Sections complete</span>
                    <span className="tabular">
                      {progress.complete}/{progress.total}
                    </span>
                  </div>
                  <span
                    className="block h-1.5 w-full overflow-hidden rounded-full bg-muted"
                    role="progressbar"
                    aria-label={`${website.name} sections complete`}
                    aria-valuemin={0}
                    aria-valuemax={progress.total}
                    aria-valuenow={progress.complete}
                  >
                    <span
                      className={cn("block h-full rounded-full", pct === 100 ? "bg-success" : "bg-primary")}
                      style={{ width: `${pct}%` }}
                    />
                  </span>
                </div>

                <div className="mt-auto flex items-center justify-between gap-2 border-t border-border pt-3">
                  <span className="truncate text-xs text-muted-foreground" title="Last updated">
                    {formatDateTime(website.updatedAt)}
                  </span>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <WebsiteOpenLink website={website} />
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Visual editor for ${website.name}`}
                      title="Visual editor (/admin)"
                      onClick={() => onEditorAccess(website)}
                    >
                      <KeyRound className="size-4" />
                    </Button>
                    <Button variant="ghost" size="icon-sm" aria-label={`Edit ${website.name}`} onClick={() => onEdit(website)}>
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Delete ${website.name}`}
                      className="text-muted-foreground hover:text-text-destructive"
                      onClick={() => onDelete(website)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
              </div>
            </article>
          </li>
        );
      })}
    </ul>
  );
}
