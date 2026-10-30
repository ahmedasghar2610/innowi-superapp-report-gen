"use client";

import { useState } from "react";
import { BookOpen } from "lucide-react";
import { Button, Dialog } from "@/components/ui";
import { SeverityBadge } from "./parts";

/** The detection rules the API runs on every sync (app/modules/seo/rules.py), in plain words. */
const RULES: { sev: "S1" | "S2" | "S3"; team: string; title: string; when: string }[] = [
  { sev: "S1", team: "SEO", title: "Organic visibility dropped", when: "Google clicks fell sharply week on week" },
  { sev: "S1", team: "Web Development", title: "Conversion tracking broken", when: "GA4 recorded no visits for several days while Google still sent clicks" },
  { sev: "S1", team: "Web Development", title: "Money page returning an error", when: "A top page answers 4xx/5xx or can't be reached" },
  { sev: "S1", team: "SEO", title: "Top page dropped out of Google's index", when: "URL Inspection says a top page isn't indexed" },
  { sev: "S2", team: "SEO", title: "Search Console data not refreshing", when: "No new data for the site for several days" },
  { sev: "S2", team: "Web Development", title: "Page set to noindex", when: "A page that earns clicks carries noindex" },
  { sev: "S2", team: "Web Development", title: "Canonical points off-domain", when: "The canonical tag sends Google to another site" },
  { sev: "S2", team: "Web Development", title: "Home page slow on mobile / Core Web Vitals failing", when: "PageSpeed mobile score under 50, or field CWV failing" },
  { sev: "S2", team: "SEO", title: "Ranking drop", when: "A tracked keyword lost several positions since the last check" },
  { sev: "S2", team: "SEO", title: "Title tag missing", when: "Pages with no <title>" },
  { sev: "S3", team: "SEO", title: "Title / meta too long or missing, missing H1, thin content, image alt text", when: "On-page hygiene from the page check" },
  { sev: "S3", team: "SEO", title: "No restaurant schema on the home page", when: "No Restaurant / LocalBusiness structured data" },
  { sev: "S3", team: "Analytics", title: "GA4 or Search Console not linked", when: "The site has no property linked" },
  { sev: "S3", team: "SEO", title: "Business Profile links elsewhere", when: "The linked GBP listing's website isn't this site" },
];

export function HowItDecides() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <BookOpen className="size-4" />
        How the rules decide
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} size="xl" title="How Intelligence decides" description="Plain rules over synced data — no guessing, nothing invented.">
        <div className="flex flex-col gap-5 text-sm">
          <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-foreground">
            <li>
              <b>Detect</b> — every sync re-runs the rules below on Search Console, GA4, PageSpeed, the page checks, keyword ranks and the linked GBP listing.
            </li>
            <li>
              <b>Explain</b> — each finding states what happened, the evidence (numbers, pages), the fix and which team usually does it, with confidence, impact and
              effort.
            </li>
            <li>
              <b>Act</b> — someone creates the task, works it and marks it fixed. Severity sets the response time: S1 same business day, S2 within 48 h, S3 within a
              week.
            </li>
            <li>
              <b>Verify</b> — a finding marked fixed is only closed when the next sync no longer sees the problem; otherwise it goes back to in progress. Findings that
              clear by themselves close as &quot;cleared&quot;.
            </li>
          </ol>
          <div className="flex flex-col gap-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">The rules</div>
            {RULES.map((r) => (
              <div key={r.title} className="flex items-start gap-2 rounded-lg border border-border p-2.5">
                <SeverityBadge s={r.sev} />
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-foreground">{r.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {r.when} · {r.team}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Not detected yet (no data source): backlink risk, citation / NAP drift, redirect chains across the whole site, AI-engine visibility.
          </p>
        </div>
      </Dialog>
    </>
  );
}
