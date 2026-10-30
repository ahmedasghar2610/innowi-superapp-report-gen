import { ChevronsUpDown, ChevronUp, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils/cn";

/*
 * Geometry and type come from the DS "Data Table" page (node 73:225), read via
 * get_design_context on the table body (2132:2225). That page is the component
 * spec and it overrides the earlier reading of the Typography page, which had
 * headers inferred as Caption 12/16 muted. The component itself specifies:
 *
 *   header cell   h 40px · px 8px · 14/20 · weight 500 · --foreground · NO fill
 *   body cell     h 37px · p  8px · 14/20 · weight 400 · --foreground
 *   row           border-b 1px --border, none on the last
 *   container     1px --border, radius-md (8px)
 *
 * The header keeps `bg-card` rather than being transparent only because it is
 * sticky — a transparent sticky header lets rows scroll visibly underneath it.
 * `bg-card` is the same white the DS draws the table on, so it matches; the
 * previous `bg-muted` grey band was not in the spec.
 */

/** Scroll container + bordered surface for a table. */
export function Table({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("overflow-x-auto rounded-[var(--radius-card)] border border-border bg-card", className)} {...props}>
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  );
}

export function TableHeader({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={className} {...props} />;
}

export function TableBody({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={className} {...props} />;
}

export interface TableRowProps extends React.HTMLAttributes<HTMLTableRowElement> {
  /** Adds hover + pointer affordance for clickable rows. */
  interactive?: boolean;
}
export function TableRow({ className, interactive, ...props }: TableRowProps) {
  return (
    <tr
      className={cn(
        "border-b border-border last:border-0",
        interactive && "cursor-pointer transition-colors hover:bg-secondary",
        className,
      )}
      {...props}
    />
  );
}

export type SortDirection = "asc" | "desc" | false;

export interface TableHeadProps extends React.ThHTMLAttributes<HTMLTableCellElement> {
  align?: "left" | "right" | "center";
  sortable?: boolean;
  /** Current sort direction for this column, or `false` when not sorted. */
  sortDirection?: SortDirection;
  onSort?: () => void;
}
export function TableHead({
  className,
  align = "left",
  sortable,
  sortDirection = false,
  onSort,
  children,
  ...props
}: TableHeadProps) {
  const alignClass = align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left";
  const Icon = sortDirection === "asc" ? ChevronUp : sortDirection === "desc" ? ChevronDown : ChevronsUpDown;
  return (
    <th
      scope="col"
      aria-sort={sortDirection === "asc" ? "ascending" : sortDirection === "desc" ? "descending" : undefined}
      className={cn(
        "sticky top-0 z-[1] h-10 whitespace-nowrap border-b border-border bg-card px-2 text-sm font-medium text-foreground",
        alignClass,
        className,
      )}
      {...props}
    >
      {sortable ? (
        <button
          type="button"
          onClick={onSort}
          className={cn(
            "inline-flex items-center gap-1 font-medium hover:text-foreground",
            sortDirection && "text-foreground",
            align === "right" && "flex-row-reverse",
          )}
        >
          {children}
          <Icon className="size-4 opacity-70" />
        </button>
      ) : (
        children
      )}
    </th>
  );
}

export interface TableCellProps extends React.TdHTMLAttributes<HTMLTableCellElement> {
  align?: "left" | "right" | "center";
}
export function TableCell({ className, align = "left", ...props }: TableCellProps) {
  const alignClass = align === "right" ? "text-right tabular" : align === "center" ? "text-center" : "text-left";
  return <td className={cn("p-2 align-middle text-foreground", alignClass, className)} {...props} />;
}

/** Full-width message row (empty / loading / error inside a table body). */
export function TableMessageRow({ colSpan, children }: { colSpan: number; children: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-2 py-0">
        {children}
      </td>
    </tr>
  );
}
