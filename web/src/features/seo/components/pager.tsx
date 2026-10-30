"use client";

import { useState } from "react";
import { MerchantPagination } from "@/features/merchants/components/merchant-pagination";

/**
 * The Super App's table footer ("Showing 1–25 of 80 · Rows [25] · Page 1 of 4 · Prev / Next"),
 * the same bar the Merchants list uses. `TablePager` takes the numbers (server-paged tables);
 * `usePager` pages an in-memory list and returns the visible rows plus the bar.
 */
export function TablePager({
  total,
  page,
  limit,
  onPage,
  onLimit,
}: {
  total: number;
  /** 1-based. */
  page: number;
  limit: number;
  onPage: (page: number) => void;
  onLimit?: (limit: number) => void;
}) {
  const pageCount = Math.max(1, Math.ceil(total / limit));
  const p = Math.min(Math.max(page, 1), pageCount);
  return (
    <div className="print:hidden [&>div]:mt-0">
      <MerchantPagination
        meta={{ page: p, limit, total, pageCount, hasPreviousPage: p > 1, hasNextPage: p < pageCount }}
        onPageChange={onPage}
        onPageSizeChange={onLimit}
      />
    </div>
  );
}

export function usePager<T>(rows: readonly T[], initialLimit = 25) {
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(initialLimit);
  const pageCount = Math.max(1, Math.ceil(rows.length / limit));
  const safe = Math.min(page, pageCount); // filters can shrink the list under the current page
  return {
    rows: rows.slice((safe - 1) * limit, safe * limit),
    /** Back to page 1 — call when a filter or sort changes. */
    reset: () => setPage(1),
    bar: (
      <TablePager
        total={rows.length}
        page={safe}
        limit={limit}
        onPage={setPage}
        onLimit={(n) => {
          setLimit(n);
          setPage(1);
        }}
      />
    ),
  };
}
