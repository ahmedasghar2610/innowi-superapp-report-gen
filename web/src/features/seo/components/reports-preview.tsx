"use client";

import { Lock, Mail, Megaphone, Code2, Search } from "lucide-react";
import { Button, Card, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui";
import { PreviewBanner, SampleBadge, Section } from "./parts";

/**
 * Reports Center → Schedules and Coherence. UI previews from the prototype:
 * no backend yet (per-audience schedules and signer chains, and the
 * cross-department "coherence" exchange don't exist), so the rows are samples.
 */
export function SchedulesPreview() {
  const rows = [
    ["Kitchen 804", "Client (owner)", "Monthly", "Scheduled → sign → send", "Head of Marketing chain"],
    ["Kitchen 804", "Franchise HQ", "Quarterly", "Review first → sign → send", "Deputy CEO chain"],
    ["Olive Grove Cantina", "Client (owner)", "Bi-weekly", "Scheduled → sign → send", "Head of Marketing chain"],
    ["Innowi SEO team", "Internal team", "Weekly", "Scheduled (no client send)", "—"],
    ["Account Heads", "Internal — coherence", "Monthly", "Review first", "Deputy CEO chain"],
  ];
  return (
    <>
      <PreviewBanner>
        Per-audience schedules and signer chains aren&apos;t built yet. Today each site has one cadence and one recipient list (set in SEO → Site settings), and any
        manager can sign off. The rows below are samples showing how it would work.
      </PreviewBanner>
      <Section title="Schedule matrix" aside={<SampleBadge />}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Client / group</TableHead>
              <TableHead>Audience</TableHead>
              <TableHead>Cadence</TableHead>
              <TableHead>Path</TableHead>
              <TableHead>Signer chain</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow key={i}>
                {r.map((c, j) => (
                  <TableCell key={j} className={j === 0 ? "font-medium" : "text-sm"}>
                    {c}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="flex items-center gap-3">
          <Button size="sm" variant="outline" disabled title="No backend yet">
            Add schedule
          </Button>
          <span className="text-xs text-muted-foreground">Monthly-class = scheduled path · quarterly-class = review, then send · internal rhythms never change client cadences.</span>
        </div>
      </Section>
    </>
  );
}

export function CoherencePreview() {
  const blocks = [
    { icon: Search, title: "SEO", body: "Clicks +9.9% (171 → 188) · branded searches +40% · health 74 · 1 risk flag" },
    { icon: Mail, title: "Email & SMS", body: "2 campaigns · open rate 31% · promo aligned with SEO's top searches ✓" },
    { icon: Megaphone, title: "Performance Ads", body: "Brand terms paused where SEO holds #1–2 ✓ · non-brand cost per lead steady" },
    { icon: Code2, title: "Web Development", body: "2 SEO tasks in flight (server render fix, canonical) · deploy cadence normal" },
  ];
  return (
    <>
      <PreviewBanner>
        The coherence view — every department&apos;s block for one client side by side — needs a shared reporting exchange between modules that isn&apos;t built yet.
        Sample content below. It&apos;s internal only and never goes into a client report.
      </PreviewBanner>
      <Section
        title="Marketing coherence — Kitchen 804"
        aside={
          <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
            <Lock className="size-3.5" /> Account-head level · internal only <SampleBadge />
          </span>
        }
      >
        <div className="grid gap-3 md:grid-cols-2">
          {blocks.map((b) => (
            <Card key={b.title} className="flex flex-col gap-1.5 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <b.icon className="size-4 text-muted-foreground" />
                {b.title}
              </div>
              <p className="text-sm text-muted-foreground">{b.body}</p>
            </Card>
          ))}
        </div>
      </Section>
    </>
  );
}
