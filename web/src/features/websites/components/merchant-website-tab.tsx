"use client";

import { useMemo, useState } from "react";
import { ExternalLink, FileText, Globe, KeyRound, Link2, Pencil, Plus, Unlink } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardBody,
  Dialog,
  EmptyState,
  ErrorState,
  Skeleton,
  useToast,
} from "@/components/ui";
import { useMerchant } from "@/features/merchants/api/merchants.queries";
import { formatDateTime } from "@/lib/format";
import { siteAdminUrl, siteUrl } from "../api/client";
import { useMerchantWebsites, useUnlinkWebsite, useWebsitePrefill, useWebsites } from "../api/websites.queries";
import type { MerchantChoice, Website, WebsiteValues } from "../types";
import { WebsiteEditorAccessDialog } from "./website-editor-access-dialog";
import { WebsiteFormModal } from "./website-form-modal";
import { WebsiteImportDocxModal } from "./website-import-docx-modal";
import { WebsiteLinkMerchantDialog } from "./website-link-merchant-dialog";
import { WebsiteStatusBadge } from "./website-status-badge";
import { WebsiteOpenLink, WebsiteStatusControl } from "./website-status-control";

/**
 * Merchant Workspace › Website tab. Three states (PRD §25 Website, §5.2
 * Profiling as source of truth):
 *
 *   none     — no site anywhere: create one (pre-filled from the Profile),
 *              import a .docx, or link an unassigned site.
 *   external — the Profile only holds a URL to a site we didn't build:
 *              show it, and offer to build a managed one.
 *   managed  — one or more sites built in the Website module and linked
 *              here: status, visit, edit, editor access, unlink.
 */
export function MerchantWebsiteTab({ merchantId }: { merchantId: string }) {
  const { toast } = useToast();
  const merchant = useMerchant(merchantId);
  const sites = useMerchantWebsites(merchantId);
  const prefill = useWebsitePrefill(merchantId);
  const unlink = useUnlinkWebsite();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Website | undefined>(undefined);
  const [importOpen, setImportOpen] = useState(false);
  const [editorAccess, setEditorAccess] = useState<Website | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [unlinking, setUnlinking] = useState<Website | null>(null);
  /** Answers handed over by the .docx import's "Review in full form". */
  const [imported, setImported] = useState<WebsiteValues | undefined>(undefined);

  const merchantName = merchant.data?.restaurantName ?? "";
  // Memoised: the modals reset their state whenever this identity changes.
  const fixedMerchant = useMemo<MerchantChoice>(
    () => ({ mode: "existing", merchantId, merchantName }),
    [merchantId, merchantName],
  );

  const openCreate = () => {
    setEditing(undefined);
    setImported(undefined);
    setFormOpen(true);
  };
  const openEdit = (w: Website) => {
    setEditing(w);
    setFormOpen(true);
  };

  const confirmUnlink = () => {
    if (!unlinking) return;
    unlink.mutate(
      { id: unlinking.id, previousMerchantId: merchantId },
      {
        onSuccess: () => {
          toast({ variant: "success", title: "Website unlinked", description: `${unlinking.name} is now unassigned.` });
          setUnlinking(null);
        },
        onError: (err) => toast({ variant: "error", title: "Couldn't unlink", description: err.messages.join(" · ") }),
      },
    );
  };

  if (sites.isPending) {
    return (
      <Card>
        <CardBody className="flex flex-col gap-3">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-3.5 w-72" />
          <Skeleton className="h-9 w-40" />
        </CardBody>
      </Card>
    );
  }
  if (sites.isError) {
    return (
      <Card>
        <ErrorState title="Couldn't load this merchant's website" description={sites.error.messages.join(" · ")} onRetry={() => sites.refetch()} />
      </Card>
    );
  }

  const data = sites.data;

  return (
    <div className="flex flex-col gap-4">
      {data.state === "none" && (
        <Card>
          <EmptyState
            icon={Globe}
            title="No website yet"
            description="Start one from this merchant's Profile — name, address, phone and hours are filled in already — import a content .docx, or link a site that was created before this merchant."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="default" size="sm" onClick={openCreate} disabled={prefill.isPending}>
                  <Plus className="size-4" />
                  Create website
                </Button>
                <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
                  <FileText className="size-4" />
                  Import from .docx
                </Button>
                <Button variant="outline" size="sm" onClick={() => setLinkOpen(true)}>
                  <Link2 className="size-4" />
                  Link existing site
                </Button>
              </div>
            }
          />
        </Card>
      )}

      {data.state === "external" && (
        <Card>
          <CardBody className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="neutral">External website</Badge>
              {data.externalPlatform && <span className="text-table text-muted-foreground">{data.externalPlatform}</span>}
            </div>
            <a
              href={data.externalUrl ?? "#"}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground hover:text-primary"
            >
              <ExternalLink className="size-4" aria-hidden />
              {data.externalUrl}
            </a>
            <p className="text-table text-muted-foreground">
              This site wasn&apos;t built here, so there is nothing to edit — the URL lives on the merchant Profile.
              Build a managed site to take it over, or link one already created in the Website module.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="default" size="sm" onClick={openCreate}>
                <Plus className="size-4" />
                Build a managed site
              </Button>
              <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
                <FileText className="size-4" />
                Import from .docx
              </Button>
              <Button variant="outline" size="sm" onClick={() => setLinkOpen(true)}>
                <Link2 className="size-4" />
                Link existing site
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {data.state === "managed" && (
        <>
          <div className="flex items-center justify-between gap-2">
            <p className="text-table text-muted-foreground">
              {data.websites.length === 1 ? "One managed website." : `${data.websites.length} managed websites.`} Business
              name, contact, address and hours come from this merchant&apos;s Profile.
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setLinkOpen(true)}>
                <Link2 className="size-4" />
                Link another
              </Button>
              <Button variant="default" size="sm" onClick={openCreate}>
                <Plus className="size-4" />
                New website
              </Button>
            </div>
          </div>

          {data.websites.map((w) => (
            <Card key={w.id}>
              <CardBody className="flex flex-col gap-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => openEdit(w)}
                        className="truncate text-base font-semibold text-foreground hover:text-primary"
                      >
                        {w.name}
                      </button>
                      <WebsiteStatusControl website={w} />
                      {w.editorUpdatedAt && (
                        <Badge tone={w.editorBound ? "neutral" : "warning"}>
                          {w.editorBound ? "Visually edited" : "Edited in /admin — rebuild to sync"}
                        </Badge>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {siteUrl(w.slug)} · updated {formatDateTime(w.updatedAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-1">
                    <WebsiteOpenLink website={w} />
                    <a
                      href={siteAdminUrl(w.slug)}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                      title="Open the site's /admin editor"
                    >
                      <Pencil className="size-3.5" />
                      Visual editor
                    </a>
                  </div>
                </div>

                <div className="flex flex-wrap gap-1 border-t border-border pt-3">
                  <Button variant="ghost" size="sm" onClick={() => openEdit(w)}>
                    <Pencil className="size-4" />
                    Edit website
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setEditorAccess(w)}>
                    <KeyRound className="size-4" />
                    Editor access
                  </Button>
                  <span className="flex-1" />
                  <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setUnlinking(w)}>
                    <Unlink className="size-4" />
                    Unlink
                  </Button>
                </div>
              </CardBody>
            </Card>
          ))}
        </>
      )}

      <WebsiteFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        website={editing}
        initialValues={editing ? undefined : imported ?? prefill.data?.values}
        initialStep={imported ? "review" : "first"}
        initialMerchant={editing ? undefined : fixedMerchant}
        initialProfileFields={prefill.data?.profileFields}
        merchantFixed
      />

      <WebsiteImportDocxModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        fixedMerchant={fixedMerchant}
        onOpenInForm={(values) => {
          setImportOpen(false);
          setEditing(undefined);
          setImported(values);
          setFormOpen(true);
        }}
      />

      <WebsiteEditorAccessDialog website={editorAccess} onClose={() => setEditorAccess(null)} />

      <LinkExistingDialog open={linkOpen} onClose={() => setLinkOpen(false)} merchantId={merchantId} merchantName={merchantName} />

      <Dialog
        open={Boolean(unlinking)}
        onClose={() => setUnlinking(null)}
        icon={<Unlink />}
        title="Unlink this website?"
        description={
          unlinking
            ? `"${unlinking.name}" stays as it is, but becomes unassigned. Its business details stop following this merchant's Profile.`
            : undefined
        }
        dismissible={!unlink.isPending}
        footer={
          <>
            <Button variant="ghost" onClick={() => setUnlinking(null)} disabled={unlink.isPending}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmUnlink} loading={unlink.isPending}>
              Unlink
            </Button>
          </>
        }
      />
    </div>
  );
}

/**
 * "Link existing site" from the workspace: pick one of the unassigned sites,
 * then the normal link dialog (conflict prompt) runs against this merchant.
 */
function LinkExistingDialog({
  open,
  onClose,
  merchantId,
  merchantName,
}: {
  open: boolean;
  onClose: () => void;
  merchantId: string;
  merchantName: string;
}) {
  const unassigned = useWebsites({ unassigned: true, limit: 50 });
  const [picked, setPicked] = useState<Website | null>(null);

  return (
    <>
      <Dialog
        open={open && !picked}
        onClose={onClose}
        icon={<Link2 />}
        title={`Link an existing website to ${merchantName}`}
        description="Only sites without a merchant are listed. Linking runs the usual check for differing business details."
      >
        {unassigned.isPending ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : unassigned.isError ? (
          <p className="text-sm text-text-destructive">{unassigned.error.messages.join(" · ")}</p>
        ) : (unassigned.data?.data.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">There are no unassigned websites right now.</p>
        ) : (
          <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
            {unassigned.data!.data.map((w) => (
              <button
                key={w.id}
                type="button"
                onClick={() => setPicked(w)}
                className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-left hover:bg-muted/50"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-foreground">{w.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">/{w.slug}</span>
                </span>
                <WebsiteStatusBadge status={w.status} />
              </button>
            ))}
          </div>
        )}
      </Dialog>

      <PresetLinkDialog website={picked} merchantId={merchantId} merchantName={merchantName} onClose={() => { setPicked(null); onClose(); }} />
    </>
  );
}

/** The link dialog with the merchant already chosen. */
function PresetLinkDialog({
  website,
  merchantId,
  merchantName,
  onClose,
}: {
  website: Website | null;
  merchantId: string;
  merchantName: string;
  onClose: () => void;
}) {
  const preset = useMemo<MerchantChoice>(() => ({ mode: "existing", merchantId, merchantName }), [merchantId, merchantName]);
  return <WebsiteLinkMerchantDialog website={website} onClose={onClose} preset={preset} />;
}
