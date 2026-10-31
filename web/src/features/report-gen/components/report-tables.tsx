"use client";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui";
import { cellText, columnLabel, type RenderableTable } from "../format";

/**
 * The adapter tables inside a section, rendered from their runtime shape.
 *
 * `Section.tables` is `Record<string, unknown>` — each adapter names and shapes
 * its own tables. Rows of objects become a grid; a plain object becomes a
 * figure / value list. A new adapter table appears here with no code change.
 */
export function ReportTable({ t }: { t: RenderableTable }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <h4 className="text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">{t.title}</h4>
      {t.kind === "grid" ? (
        <Table>
          <TableHeader>
            <TableRow>
              {t.columns.map((c, i) => (
                <TableHead key={c} align={t.numeric[i] ? "right" : "left"}>
                  {columnLabel(c)}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {t.rows.map((row, i) => (
              <TableRow key={i}>
                {t.columns.map((c, j) => (
                  <TableCell key={c} align={t.numeric[j] ? "right" : "left"} className="text-xs">
                    {cellText(c, row[c])}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Figure</TableHead>
              <TableHead align="right">Value</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {t.pairs.map((p) => (
              <TableRow key={p.label}>
                <TableCell className="text-xs">{p.label}</TableCell>
                <TableCell align="right" className="text-xs">
                  {p.value}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
