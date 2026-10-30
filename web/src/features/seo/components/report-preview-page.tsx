"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Printer } from "lucide-react";
import { Button, ErrorState, Skeleton } from "@/components/ui";
import { useReport } from "../api";
import { ReportDocument } from "./report-document";
import { DemoBadge, ReportStatusBadge } from "./parts";

/**
 * Full-page client preview: the report exactly as the client receives it
 * (no placeholder sections, nothing editable), with a slim bar to print or go
 * back to the review page. `?print=1` opens the print dialog once it loads.
 */
export function ReportPreviewPage({ id }: { id: string }) {
  const q = useReport(id);
  const r = q.data;
  const autoPrint = useSearchParams().get("print") === "1";
  const printed = useRef(false);

  useEffect(() => {
    if (r?.site) document.title = `${r.site.name} — SEO report ${r.snapshot.period.label}`;
  }, [r]);
  useEffect(() => {
    if (r && autoPrint && !printed.current) {
      printed.current = true;
      const t = setTimeout(() => window.print(), 600);
      return () => clearTimeout(t);
    }
  }, [r, autoPrint]);

  return (
    <div className="min-h-dvh bg-muted/40 print:min-h-0 print:bg-white">
      {/* Paper settings for this page only. A zero page margin stops the browser printing its own
          date / title / URL / page-number lines; the page margins come from the padding on <main>,
          repeated on every page. The developer buttons (React Query devtools, Next.js) are hidden from the printout. */}
      <style>{`@media print {
        @page { size: A4; margin: 0; }
        .report-paper { padding: 12mm 13mm !important; box-decoration-break: clone; -webkit-box-decoration-break: clone; }
        nextjs-portal, .tsqd-parent-container, .tsqd-open-btn-container { display: none !important; }
      }`}</style>
      <header className="sticky top-0 z-10 border-b border-border bg-card/95 backdrop-blur print:hidden">
        <div className="mx-auto flex max-w-[920px] flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
          <Link href={`/web/seo/reports/${id}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" />
            Back to review
          </Link>
          <span className="text-sm font-semibold text-foreground">Client preview</span>
          {r && (
            <>
              <span className="truncate text-sm text-muted-foreground">
                {r.site?.name ?? "Deleted site"} · {r.snapshot.period.label}
              </span>
              <ReportStatusBadge s={r.status} />
              {r.snapshot.isDemo && <DemoBadge />}
            </>
          )}
          <Button size="sm" variant="outline" className="ml-auto" onClick={() => window.print()} disabled={!r}>
            <Printer className="size-4" />
            Print / PDF
          </Button>
        </div>
      </header>
      <main className="report-paper mx-auto max-w-[920px] px-4 py-6 print:max-w-none">
        {q.error ? (
          <ErrorState title="Couldn't load the report" description={q.error.message} />
        ) : !r ? (
          <Skeleton className="h-[40rem] w-full" />
        ) : (
          <ReportDocument r={r} showPlaceholders={false} canEdit={false} />
        )}
      </main>
    </div>
  );
}
