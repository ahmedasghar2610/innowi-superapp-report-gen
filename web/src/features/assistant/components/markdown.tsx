"use client";

import { memo, useRef, useState } from "react";
import Link from "next/link";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy, Download, ExternalLink } from "lucide-react";
import { copyText, download, tableToCsv, tableToTsv } from "../utils";

/**
 * Renders the assistant's markdown. Deliberately conservative, because the
 * text can quote data typed into Salesforce or a partner form:
 * - no raw HTML (react-markdown ignores it by default) and no images at all,
 *   so an answer can never load a URL by itself;
 * - in-app paths ("/sales/deals/...") become client-side links;
 * - only Innowi's own sites open as outside links; other addresses show as text.
 */

function TableBlock({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLTableElement>(null);
  const [copied, setCopied] = useState(false);
  return (
    <div className="group/table my-3 overflow-hidden rounded-[var(--radius-lg)] border border-border">
      <div className="overflow-x-auto">
        <table ref={ref} className="w-full border-collapse text-left text-[13px]">
          {children}
        </table>
      </div>
      <div className="flex items-center justify-end gap-1 border-t border-border bg-muted/60 px-2 py-1">
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-background hover:text-foreground"
          onClick={async () => {
            if (ref.current && (await copyText(tableToTsv(ref.current)))) {
              setCopied(true);
              setTimeout(() => setCopied(false), 1600);
            }
          }}
          title="Copy as cells — pastes straight into Excel or Google Sheets"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? "Copied" : "Copy table"}
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-background hover:text-foreground"
          onClick={() => ref.current && download("table.csv", tableToCsv(ref.current), "text/csv;charset=utf-8")}
        >
          <Download className="size-3.5" />
          CSV
        </button>
      </div>
    </div>
  );
}

/**
 * Outside sites a link may open with one click: Innowi's own and its Salesforce.
 * Anything else is shown as text (label + address) so it can be copied but
 * not followed by accident. Answers can quote text typed into public forms
 * (partner leads, quote requests), and a link someone planted there could
 * otherwise carry data out with a single click.
 */
const TRUSTED_HOSTS = [/(^|\.)innowi\.com$/i, /(^|\.)myinnowi\.com$/i, /^innowi33\.(lightning\.force|my\.salesforce)\.com$/i];

function internalPath(url: string): boolean {
  // "/sales/deals/006..." yes; "//evil.com" and "/\evil.com" (both read as other sites) no.
  return /^\/(?![\/\\])[^\s\\]*$/.test(url);
}

function trustedExternal(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && TRUSTED_HOSTS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

const components: Components = {
  a: ({ href, children }) => {
    const url = href ?? "";
    if (internalPath(url)) {
      return (
        <Link href={url} className="font-medium text-primary underline decoration-primary/30 underline-offset-2 hover:decoration-primary">
          {children}
        </Link>
      );
    }
    if (trustedExternal(url)) {
      return (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="inline-flex items-center gap-0.5 font-medium text-primary underline decoration-primary/30 underline-offset-2 hover:decoration-primary"
        >
          {children}
          <ExternalLink className="size-3" aria-hidden />
        </a>
      );
    }
    if (/^mailto:[^?]*$|^tel:/i.test(url)) {
      return (
        <a href={url} className="font-medium text-primary underline decoration-primary/30 underline-offset-2">
          {children}
        </a>
      );
    }
    // Untrusted address: visible, copyable, not clickable.
    const label = typeof children === "string" ? children : null;
    return (
      <span title={url}>
        {children}
        {url && label !== url && <span className="text-muted-foreground"> ({url})</span>}
      </span>
    );
  },
  img: () => null,
  table: ({ children }) => <TableBlock>{children}</TableBlock>,
  thead: ({ children }) => <thead className="bg-muted/70 text-xs uppercase tracking-wide text-muted-foreground">{children}</thead>,
  th: ({ children, style }) => (
    <th className="whitespace-nowrap px-3 py-2 font-semibold" style={style}>
      {children}
    </th>
  ),
  td: ({ children, style }) => (
    <td className="border-t border-border px-3 py-2 align-top text-foreground" style={style}>
      {children}
    </td>
  ),
  tr: ({ children }) => <tr className="transition-colors hover:bg-muted/40">{children}</tr>,
  h1: ({ children }) => <h2 className="mb-2 mt-5 text-lg font-semibold text-foreground first:mt-0">{children}</h2>,
  h2: ({ children }) => <h3 className="mb-2 mt-5 text-base font-semibold text-foreground first:mt-0">{children}</h3>,
  h3: ({ children }) => <h4 className="mb-1.5 mt-4 text-sm font-semibold text-foreground first:mt-0">{children}</h4>,
  p: ({ children }) => <p className="my-2 leading-7 first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5 marker:text-muted-foreground">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5 marker:text-muted-foreground">{children}</ol>,
  li: ({ children }) => <li className="pl-1 leading-7">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  blockquote: ({ children }) => (
    <blockquote className="my-3 border-l-2 border-primary/40 pl-3 text-muted-foreground">{children}</blockquote>
  ),
  hr: () => <hr className="my-4 border-border" />,
  code: ({ children, className }) =>
    className ? (
      <code className={className}>{children}</code>
    ) : (
      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground">{children}</code>
    ),
  pre: ({ children }) => (
    <pre className="my-3 overflow-x-auto rounded-[var(--radius-lg)] border border-border bg-muted p-3 font-mono text-xs leading-5">
      {children}
    </pre>
  ),
};

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {text}
    </ReactMarkdown>
  );
});
