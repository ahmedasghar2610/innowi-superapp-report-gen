import type { Block, ChatMessage } from "./types";

/** Copy plain text. Falls back to a hidden textarea where the Clipboard API is blocked. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/**
 * Copy formatted: pastes into Google Docs, Word, Outlook or Gmail with
 * headings, bold and tables intact, and as markdown into plain-text fields.
 */
export async function copyRich(html: string, text: string): Promise<boolean> {
  try {
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([text], { type: "text/plain" }),
        }),
      ]);
      return true;
    }
  } catch {
    /* fall through to plain text */
  }
  return copyText(text);
}

export function download(filename: string, content: string, type = "text/markdown;charset=utf-8") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function blocksText(blocks: Block[]): string {
  return blocks
    .map((b) =>
      b.type === "text"
        ? b.text
        : b.type === "chart"
          ? `\n_[Chart: ${b.chart.title}]_\n`
          : `\n_[Action: ${b.action.title} (${b.action.status})]_\n`,
    )
    .join("")
    .trim();
}

export function messageText(m: ChatMessage): string {
  return blocksText(m.blocks);
}

export function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 50) || "answer"
  );
}

/** Table element → CSV (for "Download CSV" on tables in answers). */
export function tableToCsv(table: HTMLTableElement): string {
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return Array.from(table.rows)
    .map((r) => Array.from(r.cells).map((c) => esc(c.innerText.trim())).join(","))
    .join("\n");
}

/** Table element → tab-separated text (pastes into a spreadsheet as cells). */
export function tableToTsv(table: HTMLTableElement): string {
  return Array.from(table.rows)
    .map((r) => Array.from(r.cells).map((c) => c.innerText.trim().replace(/\t|\n/g, " ")).join("\t"))
    .join("\n");
}

export function greeting(now = new Date()): string {
  const h = now.getHours();
  if (h < 5) return "Working late";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

export function relativeDay(iso: string, now = new Date()): "Today" | "Yesterday" | "Previous 7 days" | "Older" {
  const d = new Date(iso);
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const t = d.getTime();
  if (t >= start) return "Today";
  if (t >= start - 86_400_000) return "Yesterday";
  if (t >= start - 7 * 86_400_000) return "Previous 7 days";
  return "Older";
}
