"use client";

// Right-panel "Accessibility" tab: issue list from a11y-audit.ts with
// select-in-canvas and inline quick fixes. Relative imports only.
import { useState } from "react";
import type { FixKind, Issue, Severity } from "./a11y-audit";
import { summarize } from "./a11y-audit";

type Props = {
  issues: Issue[];
  scanning: boolean;
  selectedId: string | null;
  onRescan: () => void;
  onSelect: (sbId: string) => void;
  onFix: (issue: Issue, fix: FixKind, value?: string) => void;
};

const SEVERITY_LABEL: Record<Severity, string> = {
  critical: "Critical",
  serious: "Serious",
  moderate: "Moderate",
  minor: "Minor",
};

const KIND_TITLE: Record<Issue["kind"], string> = {
  "alt-missing": "Missing alt text",
  "alt-guess": "Alt text needs review",
  "alt-filename": "Alt text is a file name",
  "empty-link": "Link without a name",
  "empty-button": "Button without a name",
  "generic-link": "Vague link text",
  "no-h1": "No H1 heading",
  "multi-h1": "Multiple H1 headings",
  "heading-skip": "Skipped heading level",
  "empty-heading": "Empty heading",
  "no-label": "Unlabelled form field",
  "iframe-title": "Embed without title",
  "dup-id": "Duplicate id",
  contrast: "Low text contrast",
  "target-size": "Small click target",
  "positive-tabindex": "Positive tabindex",
  "new-window": "New tab without noopener",
};

export default function A11yPanel({ issues, scanning, selectedId, onRescan, onSelect, onFix }: Props) {
  const [filter, setFilter] = useState<Severity | "all">("all");
  const summary = summarize(issues);
  const shown = filter === "all" ? issues : issues.filter((i) => i.severity === filter);

  return (
    <div className="sbve-panel-body sbve-a11y">
      <section className="sbve-section">
        <div className="sbve-a11y-head">
          <h3>Accessibility check</h3>
          <button type="button" className="sbve-btn small" onClick={onRescan} disabled={scanning}>
            {scanning ? "Scanning…" : "Re-scan"}
          </button>
        </div>
        <p className="sbve-hint" style={{ marginTop: 4 }}>
          WCAG 2.1 AA checks on this page. Fix what you can here; contrast and size changes go through the Style panel.
        </p>
        <div className="sbve-a11y-summary" role="group" aria-label="Filter by severity">
          <button type="button" className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>
            All <b>{summary.total}</b>
          </button>
          {(["critical", "serious", "moderate", "minor"] as Severity[]).map((s) => (
            <button key={s} type="button" className={`sev-${s}${filter === s ? " active" : ""}`} onClick={() => setFilter(s)} disabled={summary[s] === 0}>
              {SEVERITY_LABEL[s]} <b>{summary[s]}</b>
            </button>
          ))}
        </div>
      </section>

      {issues.length === 0 ? (
        <section className="sbve-section">
          <div className="sbve-a11y-ok">
            <strong>No issues found</strong>
            <p className="sbve-hint">Automated checks pass. Still review manually: keyboard operation, reading order, and video captions cannot be detected automatically.</p>
          </div>
        </section>
      ) : (
        <ul className="sbve-a11y-list">
          {shown.map((issue) => (
            <IssueRow key={issue.key} issue={issue} selected={!!issue.sbId && issue.sbId === selectedId} onSelect={onSelect} onFix={onFix} />
          ))}
        </ul>
      )}
    </div>
  );
}

function IssueRow({ issue, selected, onSelect, onFix }: { issue: Issue; selected: boolean; onSelect: (id: string) => void; onFix: Props["onFix"] }) {
  const [value, setValue] = useState(issue.value ?? "");
  const [open, setOpen] = useState(false);
  const needsInput = issue.fixes.includes("alt") || issue.fixes.includes("aria-label") || issue.fixes.includes("title");

  return (
    <li className={`sbve-a11y-item sev-${issue.severity}${selected ? " selected" : ""}`}>
      <button type="button" className="sbve-a11y-title" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className={`sbve-a11y-dot sev-${issue.severity}`} aria-hidden="true" />
        <span className="t">
          <span className="k">{KIND_TITLE[issue.kind]}</span>
          <span className="l">{issue.label}</span>
        </span>
        <span className="w" title={`WCAG ${issue.wcag}`}>
          {issue.wcag}
        </span>
      </button>
      {open ? (
        <div className="sbve-a11y-detail">
          <p className="m">{issue.message}</p>
          <p className="sbve-hint">{issue.help}</p>
          <div className="sbve-row">
            {issue.sbId ? (
              <button type="button" className="sbve-btn small" onClick={() => onSelect(issue.sbId)}>
                Select in canvas
              </button>
            ) : null}
          </div>
          {needsInput ? (
            <div className="sbve-a11y-fix">
              <label className="sbve-label" htmlFor={`fix-${issue.key}`}>
                {issue.fixes.includes("alt") ? "Alt text" : issue.fixes.includes("title") ? "Title" : "Label (aria-label)"}
              </label>
              <div className="sbve-row">
                <input id={`fix-${issue.key}`} className="sbve-input" value={value} onChange={(e) => setValue(e.target.value)} placeholder={issue.fixes.includes("alt") ? "Describe the image" : "Short description"} />
                <button
                  type="button"
                  className="sbve-btn small primary"
                  disabled={!value.trim()}
                  onClick={() => onFix(issue, issue.fixes.includes("alt") ? "alt" : issue.fixes.includes("title") ? "title" : "aria-label", value)}
                >
                  Apply
                </button>
              </div>
              {issue.fixes.includes("decorative") ? (
                <button type="button" className="sbve-btn small ghost" onClick={() => onFix(issue, "decorative")}>
                  Mark as decorative (alt=&quot;&quot;)
                </button>
              ) : null}
            </div>
          ) : null}
          {issue.fixes.includes("heading-level") ? (
            <div className="sbve-a11y-fix">
              <label className="sbve-label" htmlFor={`fix-${issue.key}`}>Heading level</label>
              <div className="sbve-row">
                <select id={`fix-${issue.key}`} className="sbve-input" value={value} onChange={(e) => setValue(e.target.value)}>
                  {[1, 2, 3, 4, 5, 6].map((n) => (
                    <option key={n} value={String(n)}>
                      H{n}
                    </option>
                  ))}
                </select>
                <button type="button" className="sbve-btn small primary" onClick={() => onFix(issue, "heading-level", value)}>
                  Apply
                </button>
              </div>
            </div>
          ) : null}
          {issue.fixes.includes("remove-tabindex") ? (
            <button type="button" className="sbve-btn small" onClick={() => onFix(issue, "remove-tabindex")}>
              Set tabindex=&quot;0&quot;
            </button>
          ) : null}
          {issue.fixes.includes("rel-noopener") ? (
            <button type="button" className="sbve-btn small" onClick={() => onFix(issue, "rel-noopener")}>
              Add rel=&quot;noopener&quot;
            </button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
