"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button, Select } from "@/components/ui";
import { PAGE_SIZE_OPTIONS } from "@/lib/constants";
import type { PageMeta } from "@/types/api";

interface MerchantPaginationProps {
  meta: PageMeta;
  onPageChange: (page: number) => void;
  /** When provided, renders the rows-per-page selector (25 / 50 / 100). */
  onPageSizeChange?: (limit: number) => void;
}

/** Prev / next pager driven by the API's PageMeta, with an optional page-size selector. */
export function MerchantPagination({ meta, onPageChange, onPageSizeChange }: MerchantPaginationProps) {
  const { page, limit, total, pageCount, hasNextPage, hasPreviousPage } = meta;
  const from = total === 0 ? 0 : (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);

  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
      <p className="text-table text-muted-foreground">
        {total === 0 ? (
          "No results"
        ) : (
          <>
            Showing <span className="font-medium text-foreground tabular">{from}</span>–
            <span className="font-medium text-foreground tabular">{to}</span> of{" "}
            <span className="font-medium text-foreground tabular">{total}</span>
          </>
        )}
      </p>

      <div className="flex items-center gap-2">
        {onPageSizeChange && (
          <label className="flex items-center gap-1.5 text-table text-muted-foreground">
            Rows
            <Select
              aria-label="Rows per page"
              value={String(limit)}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              className="w-[76px]"
            >
              {PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </label>
        )}
        <span className="text-table text-muted-foreground">
          Page <span className="font-medium text-foreground tabular">{page}</span> of{" "}
          <span className="font-medium text-foreground tabular">{Math.max(pageCount, 1)}</span>
        </span>
        <div className="flex gap-1">
          <Button
            variant="outline"
            size="sm"
            disabled={!hasPreviousPage}
            onClick={() => onPageChange(page - 1)}
            aria-label="Previous page"
          >
            <ChevronLeft className="size-4" />
            Prev
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!hasNextPage}
            onClick={() => onPageChange(page + 1)}
            aria-label="Next page"
          >
            Next
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
