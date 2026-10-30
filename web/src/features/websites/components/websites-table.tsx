"use client";

import Link from "next/link";
import { Building2, KeyRound, Link2, MapPin, Pencil, Trash2 } from "lucide-react";
import {
  Badge,
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils/cn";
import type { Website } from "../types";
import { getString, websiteProgress } from "../lib/website-values";
import { WebsiteOpenLink, WebsiteStatusControl } from "./website-status-control";

interface WebsitesTableProps {
  websites: Website[];
  onEdit: (website: Website) => void;
  onDelete: (website: Website) => void;
  /** Open the /admin editor access dialog (password, rebuild from form). */
  onEditorAccess: (website: Website) => void;
  /** Link an unassigned site to a merchant. */
  onLink?: (website: Website) => void;
}

/** "Lancaster, CA" — what tells two merchant sites apart at a glance (zip dropped to keep the column narrow). */
function locationOf(website: Website): string {
  const values = website.values;
  const city = getString(values, "business.city").trim() || getString(values, "business.address").trim() || getString(values, "business.country").trim();
  return city.replace(/\s*\d{5}(?:-\d{4})?$/, "");
}

/**
 * The saved websites, newest first, with a completeness bar per row.
 *
 * "Visit site" opens the published page (public statuses only); every other
 * status gets "Preview", a signed 24-hour link. Status is changed in place.
 */
export function WebsitesTable({ websites, onEdit, onDelete, onEditorAccess, onLink }: WebsitesTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Website</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Merchant</TableHead>
          <TableHead>Location</TableHead>
          <TableHead>Progress</TableHead>
          <TableHead>Updated</TableHead>
          <TableHead align="right">Actions</TableHead>
        </TableRow>
      </TableHeader>

      <TableBody>
        {websites.map((website) => {
          const progress = websiteProgress(website.values);
          const pct = Math.round((progress.complete / progress.total) * 100);

          return (
            <TableRow key={website.id}>
              <TableCell>
                <button
                  type="button"
                  onClick={() => onEdit(website)}
                  className="block max-w-[220px] truncate text-left font-medium text-foreground hover:text-primary"
                >
                  {website.name}
                </button>
                <span className="mt-0.5 block max-w-[220px] truncate text-xs text-muted-foreground" title={website.tagline || undefined}>
                  /{website.slug}
                </span>
                {website.editorUpdatedAt && (
                  <Badge tone={website.editorBound ? "neutral" : "warning"} className="mt-1" title={website.editorBound ? "Visually edited — still synced with the form" : "Visually edited — form changes don't show until rebuilt"}>
                    {website.editorBound ? "Visually edited" : "Edited in /admin"}
                  </Badge>
                )}
              </TableCell>

              <TableCell>
                <WebsiteStatusControl website={website} />
              </TableCell>

              <TableCell>
                <MerchantCell website={website} onLink={onLink} />
              </TableCell>

              <TableCell>
                {locationOf(website) ? (
                  <span className="inline-flex max-w-[160px] items-center gap-1.5 whitespace-nowrap text-muted-foreground">
                    <MapPin className="size-4 shrink-0" aria-hidden />
                    <span className="truncate">{locationOf(website)}</span>
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>

              <TableCell>
                <div className="flex items-center gap-2">
                  <span className="h-1.5 w-14 overflow-hidden rounded-full bg-muted">
                    <span
                      className={cn("block h-full rounded-full", pct === 100 ? "bg-success" : "bg-primary")}
                      style={{ width: `${pct}%` }}
                    />
                  </span>
                  <span className="tabular text-xs text-muted-foreground">
                    {progress.complete}/{progress.total}
                  </span>
                </div>
              </TableCell>

              <TableCell>
                <span className="whitespace-nowrap text-muted-foreground" title={website.updatedAt}>{formatDate(website.updatedAt)}</span>
              </TableCell>

              <TableCell align="right">
                <div className="flex justify-end gap-0.5">
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
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Edit ${website.name}`}
                    onClick={() => onEdit(website)}
                  >
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
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

/** Who owns the site — a link to the merchant, or "Unassigned" + a link action. */
export function MerchantCell({ website, onLink }: { website: Website; onLink?: (website: Website) => void }) {
  if (website.merchantId) {
    return (
      <Link
        href={`/merchants/${website.merchantId}/website`}
        className="inline-flex max-w-[160px] items-center gap-1.5 text-foreground hover:text-primary"
        title="Open the merchant's Website tab"
      >
        <Building2 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="truncate">{website.merchantName ?? website.merchantId}</span>
      </Link>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <Badge tone="warning">Unassigned</Badge>
      {onLink && (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => onLink(website)}
          aria-label={`Link ${website.name} to a merchant`}
          title="Link to a merchant"
        >
          <Link2 className="size-4" />
        </Button>
      )}
    </span>
  );
}
