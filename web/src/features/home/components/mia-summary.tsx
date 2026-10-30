"use client";

import Link from "next/link";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui";
import { useMia } from "@/features/mia/mia-context";
import type { SummarySegment } from "../data/command-center.mock";

/**
 * 2 · AI Executive Summary (Figma "MIA summary block", node 13:64):
 * 22px MIA mark · "MIA · Executive summary" 12/16 semibold · confidence pill ·
 * "Ask MIA" 28px outline button · body 14/20 with Signal Blue underlined
 * drill-in links.
 */
export function MiaSummary({ confidence, segments }: { confidence: string; segments: SummarySegment[] }) {
  const { openMia } = useMia();
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-card px-5 py-4" aria-labelledby="mia-summary-title">
      <div className="flex items-center gap-2">
        <span className="grid size-[22px] shrink-0 place-items-center rounded-[5px] bg-primary-subtle text-primary" aria-hidden>
          <Sparkles className="size-4" />
        </span>
        <h2 id="mia-summary-title" className="whitespace-pre text-xs font-semibold leading-4 text-foreground">{`MIA  ·  Executive summary`}</h2>
        <span className="inline-flex items-center rounded-full bg-muted py-[3px] pl-2 pr-2.5 text-xs font-medium leading-4 text-muted-foreground">
          <span className="whitespace-pre">{`Confidence  ${confidence}`}</span>
        </span>
        <Button size="sm" variant="outline" className="ml-2.5" onClick={() => openMia()}>
          Ask MIA
        </Button>
      </div>
      <p className="text-sm leading-5 text-foreground">
        {segments.map((s, i) =>
          s.href ? (
            <Link key={i} href={s.href} className="font-medium text-primary underline decoration-solid underline-offset-2">
              {s.text}
            </Link>
          ) : (
            <span key={i}>{s.text}</span>
          ),
        )}
      </p>
    </section>
  );
}
