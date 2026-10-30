"use client";

import { useRef, useState } from "react";
import { AlertTriangle, Check, ClipboardCopy, Copy, Download, FileText, RotateCcw, Square, Volume2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { ActionCard, ChatMessage } from "../types";
import { copyRich, copyText, download, messageText, slug } from "../utils";
import { ActionCardView } from "./action-card";
import { AssistantChart } from "./chart";
import { Markdown } from "./markdown";
import { Orb } from "./orb";

export function UserMessage({ message }: { message: ChatMessage }) {
  return (
    <div className="sa-rise flex justify-end">
      <div className="max-w-[85%] whitespace-pre-wrap rounded-[20px] rounded-br-md bg-primary-subtle px-4 py-2.5 text-[15px] leading-6 text-primary-subtle-foreground">
        {messageText(message)}
      </div>
    </div>
  );
}

interface AssistantProps {
  message: ChatMessage;
  streaming?: boolean;
  status?: string | null;
  question?: string;
  onRetry?: () => void;
  speak?: { supported: boolean; speaking: boolean; onSpeak: () => void; onStop: () => void };
  onActionChange?: (next: ActionCard) => void;
}

export function AssistantMessage({ message, streaming, status, question, onRetry, speak, onActionChange }: AssistantProps) {
  const body = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState<"text" | "doc" | null>(null);
  const text = messageText(message);
  const hasContent = message.blocks.length > 0;
  const thinking = streaming && !hasContent;

  async function flash(kind: "text" | "doc", ok: boolean) {
    if (!ok) return;
    setCopied(kind);
    setTimeout(() => setCopied(null), 1600);
  }

  return (
    <div className="flex gap-3 sm:gap-4">
      <Orb state={thinking ? "thinking" : speak?.speaking ? "speaking" : "idle"} size={30} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        {/* Lookups that ran, then the one running now. */}
        {(message.tools?.length || status) && (
          <div className="mb-2 flex flex-wrap items-center gap-1.5 text-xs">
            {(message.tools ?? []).map((t, i) => (
              <span key={t + i} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
                <Check className="size-3 text-success" aria-hidden />
                {t}
              </span>
            ))}
            {status && streaming && <span className="assistant-shimmer px-1 font-medium">{status}…</span>}
          </div>
        )}
        {thinking && !status && <div className="assistant-shimmer text-sm font-medium">Thinking…</div>}

        <div ref={body} className={cn("text-[15px] text-foreground", streaming && "assistant-streaming")}>
          {message.blocks.map((b, i) =>
            b.type === "text" ? (
              <div key={i} className={cn(streaming && i === message.blocks.length - 1 && "assistant-caret-host")}>
                <Markdown text={b.text} />
              </div>
            ) : b.type === "chart" ? (
              <AssistantChart key={i} chart={b.chart} />
            ) : (
              <ActionCardView key={b.action.id} action={b.action} onChange={(next) => onActionChange?.(next)} />
            ),
          )}
        </div>

        {message.error && (
          <div className="mt-3 flex items-start gap-2 rounded-[var(--radius-lg)] border border-border bg-warning-soft px-3 py-2 text-sm text-warning-text">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <div className="flex-1">{message.error}</div>
            {onRetry && (
              <button type="button" onClick={onRetry} className="inline-flex items-center gap-1 font-medium hover:underline">
                <RotateCcw className="size-3.5" /> Retry
              </button>
            )}
          </div>
        )}

        {!streaming && hasContent && (
          <div className="mt-2 flex flex-wrap items-center gap-0.5 text-muted-foreground">
            <ActionButton
              label={copied === "text" ? "Copied" : "Copy"}
              icon={copied === "text" ? Check : Copy}
              onClick={async () => flash("text", await copyText(text))}
              title="Copy the answer as text (markdown)"
            />
            <ActionButton
              label={copied === "doc" ? "Copied" : "Copy as doc"}
              icon={copied === "doc" ? Check : ClipboardCopy}
              onClick={async () => {
                const html = body.current?.innerHTML ?? "";
                flash("doc", await copyRich(`<div>${question ? `<h2>${escapeHtml(question)}</h2>` : ""}${html}</div>`, text));
              }}
              title="Copy with formatting — paste into Google Docs, Word or an email"
            />
            <ActionButton
              label="Download"
              icon={Download}
              onClick={() =>
                download(`${slug(question ?? "answer")}.md`, `${question ? `# ${question}\n\n` : ""}${text}\n`)
              }
              title="Download as a Markdown document"
            />
            {speak?.supported &&
              (speak.speaking ? (
                <ActionButton label="Stop" icon={Square} onClick={speak.onStop} title="Stop reading" />
              ) : (
                <ActionButton label="Read aloud" icon={Volume2} onClick={speak.onSpeak} title="Read this answer aloud" />
              ))}
            {onRetry && !message.error && (
              <ActionButton label="Retry" icon={RotateCcw} onClick={onRetry} title="Ask again" />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ActionButton({
  label,
  icon: Icon,
  onClick,
  title,
}: {
  label: string;
  icon: typeof FileText;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs hover:bg-muted hover:text-foreground"
    >
      <Icon className="size-3.5" aria-hidden />
      {label}
    </button>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
