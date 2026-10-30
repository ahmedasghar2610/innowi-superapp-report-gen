"use client";

import { useRefetchOnFocus } from "@/hooks/use-refetch-on-focus";
import { websiteKeys } from "../api/websites.queries";
import { useEffect, useRef, useState } from "react";
import { FileSpreadsheet, FileText, Globe, LayoutGrid, List, Plus, Search, Trash2, X } from "lucide-react";
import {
  Button,
  Card,
  Dialog,
  EmptyState,
  ErrorState,
  SectionHead,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useToast,
} from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import { WEBSITE_STATUS, type MerchantChoice, type Website, type WebsiteStatus, type WebsiteValues } from "../types";
import { WEBSITE_STATUS_META } from "./website-status-badge";
import { useDeleteWebsite, useWebsites } from "../api/websites.queries";
import { CloneWebsitePanel } from "./clone-website-panel";
import { WebsiteFormModal } from "./website-form-modal";
import { WebsiteImportDocxModal } from "./website-import-docx-modal";
import { WebsiteLinkMerchantDialog } from "./website-link-merchant-dialog";
import { WebsiteEditorAccessDialog } from "./website-editor-access-dialog";
import { WebsitesTable } from "./websites-table";
import { WebsitesCards } from "./websites-cards";

type WebsitesView = "table" | "cards";
const VIEW_KEY = "innowi.websites.view";

type WebsiteModuleTab = "mysites" | "clone";

const WEBSITE_MODULE_TABS: { id: WebsiteModuleTab; label: string; icon: typeof Globe }[] = [
  { id: "mysites", label: "My Websites", icon: Globe },
  { id: "clone", label: "Clone a Website", icon: FileSpreadsheet },
];

/**
 * Website module (route: /web/website). Two tabs, styled after the merchant
 * workspace's module row (`merchant-module-tabs.tsx`) — full-width underline
 * tabs rather than a segmented control, so this reads as *the* page-level
 * navigation the same way it does there:
 *
 * - "My Websites" — the intake questionnaire list, live against
 *   `/api/v1/websites` on the Super App API, same backend and auth as every
 *   other module.
 * - "Clone a Website" — start a site from an existing URL or a CSV of SEO
 *   pages instead of the blank questionnaire (see `clone-website-panel.tsx`;
 *   currently UI-only, not yet wired to the Site Builder service).
 */
export function WebsitesPanel() {
  const [tab, setTab] = useState<WebsiteModuleTab>("mysites");

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-semibold tracking-[-0.011em] text-foreground">Website</h1>
        <p className="mt-1 text-xs leading-4 text-muted-foreground">
          Collect everything a merchant site needs — brand, hero, menu, reviews and contact — then hand it to the
          build.
        </p>
      </div>

      <div className="flex gap-5 border-b border-border" role="tablist" aria-label="Website module sections">
        {WEBSITE_MODULE_TABS.map(({ id, label, icon: Icon }) => {
          const active = tab === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(id)}
              className={cn(
                "relative flex shrink-0 items-center gap-1.5 whitespace-nowrap py-3 text-sm font-medium transition-colors",
                active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-4" />
              {label}
              {active && <span className="absolute inset-x-0 -bottom-px h-[2px] rounded-full bg-primary" />}
            </button>
          );
        })}
      </div>

      <div className="mt-4">
        {tab === "mysites" ? <MyWebsitesTab /> : <CloneWebsitePanel />}
      </div>
    </div>
  );
}

/** The original "My Websites" panel — table, search and the intake modal. */
function MyWebsitesTab() {
  const { toast } = useToast();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Website | undefined>(undefined);
  /** Answers handed over by the .docx import's "Review in full form". */
  const [imported, setImported] = useState<WebsiteValues | undefined>(undefined);
  const [importedMerchant, setImportedMerchant] = useState<MerchantChoice | undefined>(undefined);
  const [importOpen, setImportOpen] = useState(false);
  const [editorAccess, setEditorAccess] = useState<Website | null>(null);
  const [deleting, setDeleting] = useState<Website | null>(null);
  const [linking, setLinking] = useState<Website | null>(null);
  /** "All" or only sites with no merchant yet. */
  const [ownership, setOwnership] = useState<"all" | "unassigned">("all");
  /** Lifecycle status filter ("" = any). */
  const [statusFilter, setStatusFilter] = useState<WebsiteStatus | "">("");

  // What's typed vs. the debounced term actually sent to the API.
  const [term, setTerm] = useState("");
  // Table or card layout — remembered per browser.
  const [view, setViewState] = useState<WebsitesView>("table");
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(VIEW_KEY);
      if (saved === "cards" || saved === "table") setViewState(saved);
    } catch {
      /* storage unavailable */
    }
  }, []);
  const setView = (next: WebsitesView) => {
    setViewState(next);
    try {
      window.localStorage.setItem(VIEW_KEY, next);
    } catch {
      /* storage unavailable */
    }
  };
  const [search, setSearch] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const handleTerm = (value: string) => {
    setTerm(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setSearch(value.trim()), 300);
  };

  const clearFilters = () => {
    if (timer.current) clearTimeout(timer.current);
    setTerm("");
    setSearch("");
    setOwnership("all");
    setStatusFilter("");
  };

  // Pages edited in a site's visual editor (another tab) change these answers.
  useRefetchOnFocus([websiteKeys.lists()]);

  const hasFilters = Boolean(search) || ownership !== "all" || Boolean(statusFilter);
  const { data, isPending, isError, error, refetch } = useWebsites({
    q: search,
    unassigned: ownership === "unassigned" ? true : undefined,
    status: statusFilter || undefined,
  });
  const rows = data?.data ?? [];

  const remove = useDeleteWebsite();

  const openCreate = () => {
    setEditing(undefined);
    setImported(undefined);
    setFormOpen(true);
  };

  const openEdit = (website: Website) => {
    setEditing(website);
    setImported(undefined);
    setFormOpen(true);
  };

  const openImportedInForm = (values: WebsiteValues, merchant: MerchantChoice) => {
    setImportOpen(false);
    setEditing(undefined);
    setImported(values);
    setImportedMerchant(merchant);
    setFormOpen(true);
  };

  const confirmDelete = () => {
    if (!deleting) return;
    const { id, name } = deleting;
    remove.mutate(id, {
      onSuccess: () => {
        toast({ variant: "success", title: "Website deleted", description: name });
        setDeleting(null);
      },
      onError: (err) =>
        toast({ variant: "error", title: "Couldn't delete", description: err.messages.join(" · ") }),
    });
  };

  return (
    <section className="flex flex-col gap-3" aria-label="My Websites">
      <SectionHead
        title="My Websites"
        description="Open a website to edit its answers, or start a new one."
        action={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
              <FileText className="size-4" />
              Import from .docx
            </Button>
            <Button variant="default" size="sm" onClick={openCreate}>
              <Plus className="size-4" />
              New website
            </Button>
          </div>
        }
      />

      {(rows.length > 0 || hasFilters) && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full max-w-[280px]">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={term}
              onChange={(e) => handleTerm(e.target.value)}
              placeholder="Search websites…"
              aria-label="Search websites by name, tagline, slug or contact"
              className="h-7 w-full rounded-sm border border-border bg-background pl-8 pr-3 text-xs font-medium leading-4 text-foreground placeholder:font-normal placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent"
            />
          </div>

          <select
            value={ownership}
            onChange={(e) => setOwnership(e.target.value as "all" | "unassigned")}
            aria-label="Filter by merchant link"
            className="h-7 rounded-sm border border-border bg-background px-2 text-xs font-medium text-foreground focus-visible:border-primary focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent"
          >
            <option value="all">All websites</option>
            <option value="unassigned">Unassigned only</option>
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as WebsiteStatus | "")}
            aria-label="Filter by status"
            className="h-7 rounded-sm border border-border bg-background px-2 text-xs font-medium text-foreground focus-visible:border-primary focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent"
          >
            <option value="">Any status</option>
            {WEBSITE_STATUS.map((st) => (
              <option key={st} value={st}>
                {WEBSITE_STATUS_META[st].label}
              </option>
            ))}
          </select>

          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              <X className="size-4" />
              Clear
            </Button>
          )}

          <div className="ml-auto inline-flex gap-1 rounded-lg border border-border bg-muted p-1" role="group" aria-label="Layout">
            {(
              [
                { id: "table", label: "Table", icon: List },
                { id: "cards", label: "Cards", icon: LayoutGrid },
              ] as const
            ).map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                aria-pressed={view === id}
                onClick={() => setView(id)}
                className={cn(
                  "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent",
                  view === id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-3.5" aria-hidden />
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {isError ? (
        <Card>
          <ErrorState
            title="Couldn't load websites"
            description={`${error.messages.join(" · ")} — check that the Website Intake API is running.`}
            onRetry={() => refetch()}
          />
        </Card>
      ) : isPending ? (
        <WebsitesTableSkeleton />
      ) : rows.length === 0 ? (
        <Card>
          {hasFilters ? (
            <EmptyState
              icon={Globe}
              title="No websites match your filters"
              description="Try a different search term or clear the filters."
              action={
                <Button variant="outline" size="sm" onClick={clearFilters}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={Globe}
              title="No websites yet"
              description="Import a website content .docx, or start one and walk through the sections — business details, brand, hero, about, offerings, social proof and contact."
              action={
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
                    <FileText className="size-4" />
                    Import from .docx
                  </Button>
                  <Button variant="default" size="sm" onClick={openCreate}>
                    <Plus className="size-4" />
                    New website
                  </Button>
                </div>
              }
            />
          )}
        </Card>
      ) : (
        view === "cards" ? (
          <WebsitesCards websites={rows} onEdit={openEdit} onDelete={setDeleting} onEditorAccess={setEditorAccess} onLink={setLinking} />
        ) : (
          <WebsitesTable websites={rows} onEdit={openEdit} onDelete={setDeleting} onEditorAccess={setEditorAccess} onLink={setLinking} />
        )
      )}

      <WebsiteFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        website={editing}
        initialValues={imported}
        initialStep={imported ? "review" : "first"}
        initialMerchant={importedMerchant}
      />

      <WebsiteEditorAccessDialog website={editorAccess} onClose={() => setEditorAccess(null)} />

      <WebsiteLinkMerchantDialog website={linking} onClose={() => setLinking(null)} />

      <WebsiteImportDocxModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onOpenInForm={openImportedInForm}
      />

      <Dialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        tone="danger"
        icon={<Trash2 />}
        title="Delete this website?"
        description={deleting ? `"${deleting.name}" and every answer captured for it will be removed.` : undefined}
        dismissible={!remove.isPending}
        hideClose={remove.isPending}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)} disabled={remove.isPending}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete} loading={remove.isPending}>
              Delete
            </Button>
          </>
        }
      />
    </section>
  );
}

/** Skeleton matching the table layout during the initial load. */
function WebsitesTableSkeleton() {
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
        {Array.from({ length: 4 }).map((_, i) => (
          <TableRow key={i}>
            <TableCell>
              <Skeleton className="h-3.5 w-40" />
              <Skeleton className="mt-1.5 h-3 w-24" />
            </TableCell>
            <TableCell>
              <Skeleton className="h-5 w-24 rounded-full" />
            </TableCell>
            <TableCell>
              <Skeleton className="h-3.5 w-28" />
            </TableCell>
            <TableCell>
              <Skeleton className="h-3.5 w-32" />
            </TableCell>
            <TableCell>
              <Skeleton className="h-3.5 w-28" />
            </TableCell>
            <TableCell>
              <Skeleton className="h-3.5 w-24" />
            </TableCell>
            <TableCell align="right">
              <Skeleton className="ml-auto h-3.5 w-14" />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
