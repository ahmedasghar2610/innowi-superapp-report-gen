"use client";

import { useState } from "react";
import {
  Archive,
  ArchiveRestore,
  Download,
  File,
  FileText,
  Image,
  Images,
  Trash2,
  Upload,
  Video,
  type LucideIcon,
} from "lucide-react";
import { Badge, Button, Card, EmptyState, ErrorState, Skeleton, useToast } from "@/components/ui";
import { useBrandAssets, useDeleteBrandAsset, useUpdateBrandAsset } from "@/features/merchants/api";
import { BRAND_ASSET_TYPE, type BrandAsset, type BrandAssetType } from "@/features/merchants/types";
import { brandAssetType as brandAssetTypeLabels } from "@/lib/enums";
import { api, isApiError } from "@/lib/api/client";
import { formatDate } from "@/lib/format";
import { ConfirmDeleteDialog } from "../shared/confirm-delete-dialog";
import { UploadBrandAssetDrawer } from "./upload-brand-asset-drawer";

const TYPE_ICON: Record<BrandAssetType, LucideIcon> = {
  LOGO: Image,
  IMAGE: Image,
  MENU: FileText,
  BRAND_GUIDELINES: FileText,
  VIDEO: Video,
  OTHER: File,
};

/** Anchor styled like `<Button variant="ghost" size="icon-sm">` for the download link. */
const ICON_LINK_CLASS =
  "inline-flex size-7 items-center justify-center rounded-md border border-transparent text-foreground transition-colors " +
  "hover:bg-secondary hover:text-foreground focus-visible:outline-none";

/** Bytes → compact human size (e.g. 248000 → "242 KB"). */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
}

function assetLabel(a: BrandAsset) {
  return a.name || `${brandAssetTypeLabels[a.type] ?? a.type} ${a.id.slice(0, 6)}`;
}

/**
 * "Brand assets" block under the brand profile form: the files the platform
 * holds for the brand (§6.2.5 file slots), grouped by asset class with upload /
 * download / archive / delete against the brand-assets API.
 */
export function BrandAssetsSection({ merchantId }: { merchantId: string }) {
  const { toast } = useToast();
  const { data: assets, isPending, isError, error, refetch } = useBrandAssets(merchantId);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [deleting, setDeleting] = useState<BrandAsset | null>(null);

  const update = useUpdateBrandAsset();
  const del = useDeleteBrandAsset();

  function fail(title: string, err: unknown) {
    toast({
      variant: "error",
      title,
      description: isApiError(err) ? err.messages[0] : "Something went wrong. Please try again.",
    });
  }

  function toggleStatus(a: BrandAsset) {
    const next = a.status === "ACTIVE" ? "ARCHIVED" : "ACTIVE";
    update.mutate(
      { merchantId, id: a.id, input: { status: next } },
      {
        onSuccess: () =>
          toast({
            variant: "success",
            title: next === "ARCHIVED" ? "Asset archived" : "Asset restored",
            description: assetLabel(a),
          }),
        onError: (err) => fail(next === "ARCHIVED" ? "Couldn't archive asset" : "Couldn't restore asset", err),
      },
    );
  }

  function confirmDelete() {
    if (!deleting) return;
    const target = deleting;
    del.mutate(
      { merchantId, id: target.id },
      {
        onSuccess: () => {
          toast({ variant: "success", title: "Asset deleted", description: assetLabel(target) });
          setDeleting(null);
        },
        onError: (err) => fail("Couldn't delete asset", err),
      },
    );
  }

  const groups = BRAND_ASSET_TYPE.map((type) => ({
    type,
    items: (assets ?? []).filter((a) => a.type === type),
  })).filter((g) => g.items.length > 0);

  return (
    <section className="mt-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold leading-6 text-foreground">Brand assets</h2>
          <p className="mt-0.5 text-xs leading-4 text-muted-foreground">
            Logo, menu, images and guidelines the platform holds — these satisfy the §6.2.5 file slots.
          </p>
        </div>
        <Button variant="default" size="sm" onClick={() => setUploadOpen(true)}>
          <Upload className="size-4" />
          Upload asset
        </Button>
      </div>

      {isError ? (
        <Card>
          <ErrorState title="Couldn't load brand assets" error={error} onRetry={() => refetch()} />
        </Card>
      ) : isPending ? (
        <BrandAssetsSkeleton />
      ) : groups.length === 0 ? (
        <Card>
          <EmptyState
            icon={Images}
            title="No brand assets yet"
            description="Upload the logo and menu first; they're required for a complete profile."
            action={
              <Button variant="default" size="sm" onClick={() => setUploadOpen(true)}>
                <Upload className="size-4" />
                Upload asset
              </Button>
            }
          />
        </Card>
      ) : (
        <Card>
          <div className="divide-y divide-border">
            {groups.map((g) => (
              <div key={g.type}>
                <div className="bg-muted px-4 py-2 text-xs font-semibold text-muted-foreground">
                  {brandAssetTypeLabels[g.type] ?? g.type}
                  <span className="ml-1.5 font-normal normal-case tracking-normal">({g.items.length})</span>
                </div>
                <div className="divide-y divide-border">
                  {g.items.map((a) => (
                    <AssetRow
                      key={a.id}
                      asset={a}
                      busy={update.isPending && update.variables?.id === a.id}
                      onToggleStatus={() => toggleStatus(a)}
                      onDelete={() => setDeleting(a)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <UploadBrandAssetDrawer merchantId={merchantId} open={uploadOpen} onClose={() => setUploadOpen(false)} />
      <ConfirmDeleteDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Delete asset"
        description="The file will be removed from storage."
        busy={del.isPending}
        onConfirm={confirmDelete}
      >
        {deleting ? <>“{assetLabel(deleting)}” will be permanently deleted. This can’t be undone.</> : null}
      </ConfirmDeleteDialog>
    </section>
  );
}

function AssetRow({
  asset: a,
  busy,
  onToggleStatus,
  onDelete,
}: {
  asset: BrandAsset;
  busy: boolean;
  onToggleStatus: () => void;
  onDelete: () => void;
}) {
  const Icon = TYPE_ICON[a.type];
  const label = assetLabel(a);
  const archived = a.status === "ARCHIVED";
  const meta = [
    a.mimeType,
    a.sizeBytes != null ? formatBytes(a.sizeBytes) : null,
    formatDate(a.createdAt),
    a.uploadedBy,
  ].filter(Boolean);

  return (
    <div className="flex flex-wrap items-center gap-4 p-4">
      <div className="grid size-10 shrink-0 place-items-center rounded-full bg-accent text-primary-hover">
        <Icon className="size-5" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={archived ? "font-medium text-muted-foreground" : "font-medium text-foreground"}>{label}</span>
          <Badge tone={archived ? "neutral" : "success"}>{archived ? "Archived" : "Active"}</Badge>
        </div>
        <div className="mt-1 text-table text-muted-foreground">{meta.join(" · ")}</div>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {a.hasFile && a.downloadPath && (
          <a
            href={api.fileUrl(a.downloadPath)}
            download={a.name ?? undefined}
            aria-label={`Download ${label}`}
            className={ICON_LINK_CLASS}
            onClick={(e) => e.stopPropagation()}
          >
            <Download className="size-4" />
          </a>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={archived ? `Restore ${label}` : `Archive ${label}`}
          title={archived ? "Restore" : "Archive"}
          disabled={busy}
          onClick={onToggleStatus}
        >
          {archived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Delete ${label}`}
          className="text-muted-foreground hover:text-text-destructive"
          onClick={onDelete}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
    </div>
  );
}

function BrandAssetsSkeleton() {
  return (
    <Card>
      <div className="divide-y divide-border">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 p-4">
            <Skeleton className="size-10 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1">
              <Skeleton className="h-3.5 w-40" />
              <Skeleton className="mt-2 h-3 w-64" />
            </div>
            <Skeleton className="h-7 w-24 shrink-0" />
          </div>
        ))}
      </div>
    </Card>
  );
}
