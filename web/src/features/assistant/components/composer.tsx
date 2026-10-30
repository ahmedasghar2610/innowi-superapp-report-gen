"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { ArrowUp, AudioLines, Mic, Square } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export interface ComposerHandle {
  focus: () => void;
  set: (text: string) => void;
}

interface Props {
  onSend: (text: string) => void;
  onStop: () => void;
  busy: boolean;
  disabled?: boolean;
  placeholder?: string;
  /** Speech-to-text */
  micSupported: boolean;
  listening: boolean;
  interim: string;
  onMic: () => void;
  /** Hands-free conversation (talk, hear the answer, talk again). */
  onVoiceMode?: () => void;
  large?: boolean;
}

/**
 * The question box: grows with the text, Enter sends, Shift+Enter adds a line.
 * The mic dictates into the box and sends when you stop talking; the wave
 * button starts a hands-free voice conversation.
 */
export const Composer = forwardRef<ComposerHandle, Props>(function Composer(
  { onSend, onStop, busy, disabled, placeholder, micSupported, listening, interim, onMic, onVoiceMode, large },
  ref,
) {
  const [text, setText] = useState("");
  const area = useRef<HTMLTextAreaElement>(null);

  useImperativeHandle(ref, () => ({
    focus: () => area.current?.focus(),
    set: (t: string) => {
      setText(t);
      requestAnimationFrame(() => {
        area.current?.focus();
        area.current?.setSelectionRange(t.length, t.length);
      });
    },
  }));

  // Auto-grow up to ~8 lines.
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [text, interim]);

  const shown = listening ? interim : text;
  const canSend = !busy && !disabled && text.trim().length > 0;

  function send() {
    if (!canSend) return;
    onSend(text.trim());
    setText("");
  }

  return (
    <div
      className={cn(
        "group/composer relative rounded-[22px] border border-border bg-card shadow-[0_10px_40px_-12px_rgba(44,103,245,0.25),0_2px_6px_-2px_rgba(16,24,40,0.06)] transition-[border-color,box-shadow] focus-within:border-primary-border focus-within:shadow-[0_12px_44px_-12px_rgba(44,103,245,0.38),0_2px_6px_-2px_rgba(16,24,40,0.06)]",
        listening && "border-primary-border",
      )}
    >
      <label htmlFor="assistant-input" className="sr-only">
        Ask the assistant
      </label>
      <textarea
        id="assistant-input"
        ref={area}
        rows={1}
        value={shown}
        readOnly={listening}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send();
          }
        }}
        placeholder={listening ? "Listening…" : placeholder ?? "Ask anything about your deals, leads, quotes…"}
        className={cn(
          "block w-full resize-none bg-transparent px-5 text-[15px] leading-6 text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed",
          large ? "min-h-[68px] pb-2 pt-5" : "min-h-[52px] pb-1 pt-3.5",
        )}
      />
      <div className="flex items-center justify-between gap-2 px-3 pb-3">
        <div className="flex items-center gap-1 pl-1 text-xs text-muted-foreground">
          {listening ? (
            <span className="inline-flex items-center gap-2 font-medium text-primary">
              <span className="assistant-eq flex h-3.5 items-end gap-[2px]" aria-hidden>
                {[0, 1, 2, 3].map((i) => (
                  <span key={i} className="block h-full w-[3px] rounded-full bg-primary" />
                ))}
              </span>
              Listening — stop talking to send
            </span>
          ) : (
            <span className="hidden sm:inline">Enter to send · Shift + Enter for a new line</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {micSupported && !busy && (
            <button
              type="button"
              onClick={onMic}
              disabled={disabled}
              aria-pressed={listening}
              aria-label={listening ? "Stop dictating" : "Dictate a question"}
              title={listening ? "Stop" : "Speak your question"}
              className={cn(
                "grid size-9 place-items-center rounded-full transition-colors disabled:opacity-50",
                listening ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <Mic className="size-[18px]" />
            </button>
          )}
          {micSupported && onVoiceMode && !busy && !listening && (
            <button
              type="button"
              onClick={onVoiceMode}
              disabled={disabled}
              aria-label="Start a voice conversation"
              title="Voice conversation — talk and hear the answers"
              className="grid size-9 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              <AudioLines className="size-[18px]" />
            </button>
          )}
          {busy ? (
            <button
              type="button"
              onClick={onStop}
              aria-label="Stop answering"
              className="grid size-9 place-items-center rounded-full bg-foreground text-background transition-transform hover:scale-105"
            >
              <Square className="size-3.5 fill-current" />
            </button>
          ) : (
            <button
              type="button"
              onClick={send}
              disabled={!canSend}
              aria-label="Send"
              className="grid size-9 place-items-center rounded-full bg-primary text-primary-foreground shadow-sm transition-[transform,opacity,background-color] hover:scale-105 hover:bg-primary-hover disabled:scale-100 disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none"
            >
              <ArrowUp className="size-[18px]" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
});
