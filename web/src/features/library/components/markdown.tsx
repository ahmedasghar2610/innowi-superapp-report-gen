import { Fragment, type ReactNode } from "react";

/**
 * A small, safe Markdown renderer for Library pages. It builds React elements
 * (never HTML strings), so page text can't inject markup or scripts. Supports
 * what the team needs for guidelines and SOPs:
 *
 *   # / ## / ### headings · paragraphs · - or * bullets · 1. numbered lists
 *   > quotes · --- rules · **bold** · *italic* · `code`
 *   [links](https://…) (http, https and mailto only) · bare https:// URLs
 *   Colour swatches: a hex code like #1F6F5C gets a small chip beside it.
 */
export function Markdown({ source }: { source: string }) {
  const blocks = parseBlocks(source);
  if (blocks.length === 0) return <p className="text-sm text-muted-foreground">This page is empty.</p>;
  return <div className="flex flex-col gap-3 text-sm leading-relaxed text-foreground">{blocks}</div>;
}

function parseBlocks(src: string): ReactNode[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const out: ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      const cls =
        level === 1 ? "mt-2 text-lg font-semibold" : level === 2 ? "mt-2 text-base font-semibold" : "mt-1 text-sm font-semibold";
      const Tag = (level === 1 ? "h2" : level === 2 ? "h3" : "h4") as "h2" | "h3" | "h4";
      out.push(
        <Tag key={key++} className={cls}>
          {inline(h[2])}
        </Tag>,
      );
      i++;
      continue;
    }
    if (/^(-{3,}|\*{3,})\s*$/.test(line)) {
      out.push(<hr key={key++} className="border-border" />);
      i++;
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*]\s+/, ""));
      out.push(
        <ul key={key++} className="list-disc space-y-1 pl-5">
          {items.map((t, j) => (
            <li key={j}>{inline(t)}</li>
          ))}
        </ul>,
      );
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*\d+[.)]\s+/, ""));
      out.push(
        <ol key={key++} className="list-decimal space-y-1 pl-5">
          {items.map((t, j) => (
            <li key={j}>{inline(t)}</li>
          ))}
        </ol>,
      );
      continue;
    }
    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) quote.push(lines[i++].replace(/^>\s?/, ""));
      out.push(
        <blockquote key={key++} className="border-l-2 border-border pl-3 text-muted-foreground">
          {inline(quote.join(" "))}
        </blockquote>,
      );
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,3}\s|>\s?|\s*[-*]\s+|\s*\d+[.)]\s+|-{3,}\s*$)/.test(lines[i])
    ) {
      para.push(lines[i++]);
    }
    out.push(
      <p key={key++}>
        {para.map((p, j) => (
          <Fragment key={j}>
            {j > 0 ? <br /> : null}
            {inline(p)}
          </Fragment>
        ))}
      </p>,
    );
  }
  return out;
}

const TOKEN =
  /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|https?:\/\/[^\s)]+|#[0-9a-fA-F]{6}\b|\*[^*\s][^*]*\*)/g;

function safeHref(href: string): string | null {
  return /^(https?:\/\/|mailto:)/i.test(href) ? href : null;
}

function inline(text: string): ReactNode[] {
  const parts = text.split(TOKEN);
  return parts.map((part, i) => {
    if (!part) return null;
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4)
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`"))
      return (
        <code key={i} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
          {part.slice(1, -1)}
        </code>
      );
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
    if (link) {
      const href = safeHref(link[2]);
      return href ? (
        <a key={i} href={href} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
          {link[1]}
        </a>
      ) : (
        <span key={i}>{link[1]}</span>
      );
    }
    if (/^https?:\/\//.test(part))
      return (
        <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="break-all text-primary hover:underline">
          {part}
        </a>
      );
    if (/^#[0-9a-fA-F]{6}$/.test(part))
      return (
        <span key={i} className="inline-flex items-center gap-1 whitespace-nowrap">
          <span className="inline-block size-3.5 rounded-sm border border-border align-middle" style={{ background: part }} aria-hidden />
          {part.toUpperCase()}
        </span>
      );
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) return <em key={i}>{part.slice(1, -1)}</em>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}
