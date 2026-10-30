"use client";

import { Search, Plus, Pencil, Trash2 } from "lucide-react";
import { Button, Card, EmptyState, ErrorState, Skeleton } from "@/components/ui";
import { useKeywords } from "@/features/merchants/api";
import { useCrudManager } from "@/features/merchants/hooks/use-crud-manager";
import { KEYWORD_TYPE } from "@/features/merchants/types/enums";
import { keywordType } from "@/lib/enums";
import type { Keyword, KeywordType } from "@/features/merchants/types";
import { KeywordFormDrawer } from "./keyword-form-drawer";
import { DeleteKeywordDialog } from "./delete-keyword-dialog";

/**
 * Keywords tab (route: /merchants/[merchantId]/keywords). Lists the merchant's
 * search terms with create / edit / delete, live against the keywords API.
 *
 * Rendered as one Card with a labelled section per keyword type (Primary,
 * Secondary, Location — the workbook's three columns), each term shown as a
 * chip. Groups with no terms still render so the structure is visible.
 */
export function KeywordsPanel({ merchantId }: { merchantId: string }) {
  const { data: rows, isPending, isError, error, refetch } = useKeywords(merchantId);

  const { formOpen, editing, deleting, openCreate, openEdit, closeForm, requestDelete, cancelDelete } =
    useCrudManager<Keyword>();

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold leading-6 text-foreground">Keywords</h2>
          <p className="mt-0.5 text-xs leading-4 text-muted-foreground">
            Search terms this merchant targets — defined once here, read by SEO and Ads.
          </p>
        </div>
        <Button variant="default" size="sm" onClick={openCreate}>
          <Plus className="size-4" />
          New keyword
        </Button>
      </div>

      {isError ? (
        <Card>
          <ErrorState title="Couldn't load keywords" error={error} onRetry={() => refetch()} />
        </Card>
      ) : isPending ? (
        <KeywordsSkeleton />
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={Search}
            title="No keywords yet"
            description="Add the primary, secondary and location search terms this merchant wants to rank for."
            action={
              <Button variant="default" size="sm" onClick={openCreate}>
                <Plus className="size-4" />
                New keyword
              </Button>
            }
          />
        </Card>
      ) : (
        <Card>
          <div className="divide-y divide-border">
            {KEYWORD_TYPE.map((type) => (
              <KeywordGroup
                key={type}
                type={type}
                keywords={rows.filter((k) => k.type === type)}
                onEdit={openEdit}
                onDelete={requestDelete}
              />
            ))}
          </div>
        </Card>
      )}

      <KeywordFormDrawer merchantId={merchantId} open={formOpen} onClose={closeForm} keyword={editing} />
      <DeleteKeywordDialog merchantId={merchantId} keyword={deleting} onClose={cancelDelete} />
    </div>
  );
}

function KeywordGroup({
  type,
  keywords,
  onEdit,
  onDelete,
}: {
  type: KeywordType;
  keywords: Keyword[];
  onEdit: (k: Keyword) => void;
  onDelete: (k: Keyword) => void;
}) {
  return (
    <section className="p-4">
      <div className="mb-2.5 flex items-center gap-2">
        <h3 className="text-table font-semibold text-foreground">{keywordType[type] ?? type}</h3>
        <span className="text-xs text-muted-foreground">
          {keywords.length} {keywords.length === 1 ? "term" : "terms"}
        </span>
      </div>

      {keywords.length === 0 ? (
        <p className="text-table text-muted-foreground">No {(keywordType[type] ?? type).toLowerCase()} keywords.</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {keywords.map((k) => (
            <li
              key={k.id}
              className="inline-flex items-center gap-0.5 rounded-full border border-border bg-muted py-0.5 pr-0.5 pl-3 text-table text-foreground"
            >
              <span className="pr-1.5">{k.term}</span>
              <Button variant="ghost" size="icon-sm" aria-label={`Edit ${k.term}`} onClick={() => onEdit(k)}>
                <Pencil className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Delete ${k.term}`}
                className="text-muted-foreground hover:text-text-destructive"
                onClick={() => onDelete(k)}
              >
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function KeywordsSkeleton() {
  return (
    <Card>
      <div className="divide-y divide-border">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="p-4">
            <Skeleton className="h-3.5 w-24" />
            <div className="mt-3 flex flex-wrap gap-2">
              <Skeleton className="h-7 w-28 rounded-full" />
              <Skeleton className="h-7 w-36 rounded-full" />
              <Skeleton className="h-7 w-24 rounded-full" />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
