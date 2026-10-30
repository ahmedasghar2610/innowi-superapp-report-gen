"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  BarChart3,
  Building2,
  CalendarCheck,
  FileText,
  Handshake,
  History as HistoryIcon,
  KeyRound,
  LifeBuoy,
  Lock,
  Sparkles,
  Store,
  Trophy,
  UserPlus,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { assistantKeys, fetchChat, streamChat, StreamError, useAssistantStatus } from "./api";
import type { AssistantStatus, Block, ChatMessage, StreamEvent } from "./types";
import { Composer, type ComposerHandle } from "./components/composer";
import { ChatHistory } from "./components/history";
import { AssistantMessage, UserMessage } from "./components/message";
import { Orb, type OrbState } from "./components/orb";
import { VoiceOverlay } from "./components/voice-overlay";
import { greeting, messageText } from "./utils";
import { useSpeechInput, useSpeechOutput } from "./voice";

/**
 * / — the SuperApp assistant, the first screen after sign-in.
 *
 * Ask in words (typed or spoken) about anything the SuperApp holds: the
 * Salesforce copy, partner leads, quotes, merchants, websites. The API answers
 * with the AI model through fixed, read-only lookups that follow the person's role,
 * so a Sales Executive only ever gets their own Salesforce records.
 */
export function AssistantPage() {
  return (
    <Suspense fallback={null}>
      <Assistant />
    </Suspense>
  );
}

interface Suggestion {
  icon: typeof Sparkles;
  title: string;
  prompt: string;
}

function suggestionsFor(status: AssistantStatus | undefined): Suggestion[] {
  if (!status) return [];
  const has = (label: string) => status.areas.includes(label);
  const sales: Suggestion[] = [];
  const other: Suggestion[] = [];
  if (status.salesScope === "own") {
    sales.push(
      { icon: CalendarCheck, title: "My day", prompt: "What's on my plate today? Visits due, overdue visits and deals that need attention." },
      { icon: Handshake, title: "Deals going quiet", prompt: "Which of my open deals haven't changed in over 30 days?" },
      { icon: BarChart3, title: "My wins by month", prompt: "Chart how many deals I won each month this year." },
      { icon: LifeBuoy, title: "Restaurants needing care", prompt: "Which of my restaurants are in Red health or have open support cases?" },
    );
  } else if (status.salesScope === "all") {
    sales.push(
      { icon: BarChart3, title: "Pipeline right now", prompt: "How does the pipeline look right now? Show open deals by stage with amounts." },
      { icon: Trophy, title: "Top performers", prompt: "Who won the most deals in the last 90 days? Show a ranking." },
      { icon: Handshake, title: "New deals trend", prompt: "Chart new deals created per month over the last 12 months." },
      { icon: LifeBuoy, title: "Support hot spots", prompt: "Which restaurants have the most open support cases?" },
    );
  }
  if (has("Looking up merchants")) {
    other.push({ icon: Store, title: "Merchant health", prompt: "Give me a health breakdown of our merchants and list any in Red." });
  }
  if (has("Looking up partner leads")) {
    other.push({ icon: UserPlus, title: "Partner leads", prompt: "Summarize partner leads from the last 30 days: how many, by status and source, and which are unassigned." });
  }
  if (has("Looking up quotes")) {
    other.push({ icon: FileText, title: "Open quotes", prompt: "Which quote requests are waiting on us, and what are they worth?" });
  }
  if (has("Looking up websites")) {
    other.push({ icon: Building2, title: "Website pipeline", prompt: "Which restaurant websites are in progress or under review?" });
  }
  if (has("Reading the audit log")) {
    other.push({ icon: HistoryIcon, title: "Recent changes", prompt: "Who changed what in the SuperApp this week?" });
  }
  // A mix: up to 3 sales ideas when there are other areas too, never more than 6 in all.
  const picked = [...sales.slice(0, other.length ? 3 : 4), ...other].slice(0, 6);
  if (picked.length < 3) {
    picked.push({ icon: Sparkles, title: "What can you do?", prompt: "What kinds of questions can you answer for me?" });
  }
  // Even counts keep the card grid tidy (2 x 2 or 3 x 2).
  return picked.length >= 6 ? picked.slice(0, 6) : picked.length >= 4 ? picked.slice(0, 4) : picked;
}

let tempId = 0;
const nextId = () => `local-${Date.now()}-${tempId++}`;

function Assistant() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const qc = useQueryClient();
  const status = useAssistantStatus();
  const composer = useRef<ComposerHandle>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const ownChatRef = useRef<string | null>(null);
  const inFlight = useRef(false);
  const [announce, setAnnounce] = useState("");

  const urlChat = params.get("c");
  const [chatId, setChatId] = useState<string | null>(urlChat);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingChat, setLoadingChat] = useState(false);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [toolStatus, setToolStatus] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [atBottom, setAtBottom] = useState(true);

  // Voice
  const [voiceMode, setVoiceMode] = useState(false);
  const voiceModeRef = useRef(false);
  voiceModeRef.current = voiceMode;
  const output = useSpeechOutput();
  const sendRef = useRef<(text: string, opts?: { voice?: boolean }) => void>(() => {});
  const input = useSpeechInput({ onFinal: (text) => sendRef.current(text, { voice: voiceModeRef.current }) });

  const busy = streamingId !== null;
  const configured = status.data?.configured ?? true;
  const left = status.data && status.data.dailyLimit > 0 ? status.data.dailyLimit - status.data.usedToday : null;
  const limitReached = left !== null && left <= 0;

  // ---- open a saved chat from the URL (?c=...) ---------------------------
  useEffect(() => {
    if (urlChat === chatId && (messages.length > 0 || !urlChat)) return;
    if (urlChat && urlChat === ownChatRef.current) {
      setChatId(urlChat);
      return;
    }
    abortRef.current?.abort();
    setChatId(urlChat);
    if (!urlChat) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    setLoadingChat(true);
    fetchChat(urlChat)
      .then((c) => !cancelled && setMessages(c.messages))
      .catch(() => {
        if (!cancelled) {
          setMessages([]);
          router.replace(pathname, { scroll: false });
        }
      })
      .finally(() => !cancelled && setLoadingChat(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlChat]);

  // A question handed over from elsewhere (?ask=...), e.g. "Ask MIA about this merchant".
  useEffect(() => {
    const ask = params.get("ask");
    if (ask) {
      composer.current?.set(ask);
      router.replace(urlChat ? `${pathname}?c=${urlChat}` : pathname, { scroll: false });
    } else {
      composer.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- scrolling --------------------------------------------------------
  const scrollToBottom = useCallback((smooth = true) => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, []);
  useEffect(() => {
    if (atBottom) scrollToBottom(false);
  }, [messages, atBottom, scrollToBottom]);
  useEffect(() => {
    if (!loadingChat) scrollToBottom(false);
  }, [loadingChat, scrollToBottom]);

  // ---- asking -----------------------------------------------------------
  const patchAssistant = useCallback((id: string, fn: (m: ChatMessage) => ChatMessage) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? fn(m) : m)));
  }, []);

  const send = useCallback(
    async (text: string, opts: { voice?: boolean } = {}) => {
      const question = text.trim();
      // A ref, not state: two Enter presses (or a dictation ending) in the same frame must not send twice.
      if (!question || inFlight.current || loadingChat || limitReached || !configured) return;
      inFlight.current = true;
      output.stop();
      const userMsg: ChatMessage = { id: nextId(), role: "user", blocks: [{ type: "text", text: question }] };
      const replyId = nextId();
      const reply: ChatMessage = { id: replyId, role: "assistant", blocks: [], tools: [] };
      setMessages((prev) => [...prev, userMsg, reply]);
      setStreamingId(replyId);
      setToolStatus(null);
      setAtBottom(true);
      requestAnimationFrame(() => scrollToBottom());

      const ctrl = new AbortController();
      abortRef.current = ctrl;
      let current: string | null = null;
      let finalText = "";
      let failed = false;
      const settleStatus = () => {
        if (current) {
          const label = current;
          if (label !== "Drawing a chart") patchAssistant(replyId, (m) => ({ ...m, tools: [...(m.tools ?? []), label] }));
          current = null;
          setToolStatus(null);
        }
      };
      const onEvent = (ev: StreamEvent) => {
        switch (ev.type) {
          case "chat":
            if (!chatId) {
              ownChatRef.current = ev.id;
              setChatId(ev.id);
              router.replace(`${pathname}?c=${ev.id}`, { scroll: false });
            }
            break;
          case "status":
            settleStatus();
            current = ev.label;
            setToolStatus(ev.label);
            break;
          case "text":
            settleStatus();
            finalText += ev.text;
            patchAssistant(replyId, (m) => {
              const blocks: Block[] = [...m.blocks];
              const last = blocks[blocks.length - 1];
              if (last && last.type === "text") blocks[blocks.length - 1] = { type: "text", text: last.text + ev.text };
              else blocks.push({ type: "text", text: ev.text });
              return { ...m, blocks };
            });
            break;
          case "chart":
            settleStatus();
            patchAssistant(replyId, (m) => ({ ...m, blocks: [...m.blocks, { type: "chart", chart: ev.chart }] }));
            break;
          case "action":
            // A proposed change: a card with Confirm / Cancel. Nothing has happened yet.
            current = null;
            setToolStatus(null);
            patchAssistant(replyId, (m) => ({ ...m, blocks: [...m.blocks, { type: "action", action: ev.action }] }));
            break;
          case "done":
            current = null;
            setToolStatus(null);
            patchAssistant(replyId, (m) => ({ ...m, tools: ev.tools }));
            break;
          case "error":
            failed = true;
            current = null;
            setToolStatus(null);
            patchAssistant(replyId, (m) => ({ ...m, error: ev.message }));
            break;
        }
      };
      try {
        await streamChat({ message: question, chatId, voice: opts.voice }, onEvent, ctrl.signal);
      } catch (err) {
        failed = true;
        const aborted = err instanceof DOMException && err.name === "AbortError";
        patchAssistant(replyId, (m) => ({
          ...m,
          error: aborted ? "Stopped." : err instanceof StreamError ? err.message : "Couldn't reach the assistant. Check your connection and try again.",
        }));
        if (!aborted && err instanceof StreamError && err.status === 503) qc.invalidateQueries({ queryKey: assistantKeys.status() });
      } finally {
        inFlight.current = false;
        setStreamingId(null);
        setToolStatus(null);
        abortRef.current = null;
        qc.invalidateQueries({ queryKey: assistantKeys.chats() });
        qc.invalidateQueries({ queryKey: assistantKeys.status() });
      }
      if (!failed && finalText.trim()) setAnnounce(finalText.replace(/[*_`#|>-]/g, " ").slice(0, 600));
      if (voiceModeRef.current) {
        if (!failed && finalText.trim()) {
          output.speak(replyId, finalText, () => voiceModeRef.current && input.start());
        } else {
          input.start();
        }
      }
    },
    [loadingChat, limitReached, configured, chatId, pathname, router, qc, output, input, patchAssistant, scrollToBottom],
  );
  sendRef.current = send;

  const stop = () => abortRef.current?.abort();

  const newChat = () => {
    abortRef.current?.abort();
    output.stop();
    ownChatRef.current = null;
    setMessages([]);
    setChatId(null);
    setHistoryOpen(false);
    router.replace(pathname, { scroll: false });
    requestAnimationFrame(() => composer.current?.focus());
  };

  const openChat = (id: string) => {
    setHistoryOpen(false);
    if (id === chatId) return;
    ownChatRef.current = null;
    router.replace(`${pathname}?c=${id}`, { scroll: false });
  };

  const retry = (assistantIndex: number) => {
    const q = messages
      .slice(0, assistantIndex)
      .reverse()
      .find((m) => m.role === "user");
    if (q) send(messageText(q));
  };

  // ---- voice mode -------------------------------------------------------
  const startVoice = () => {
    setVoiceMode(true);
    output.stop();
    input.start();
  };
  const endVoice = useCallback(() => {
    setVoiceMode(false);
    input.cancel();
    output.stop();
  }, [input, output]);
  const voicePhase: OrbState = input.listening
    ? "listening"
    : busy
      ? "thinking"
      : output.speakingId
        ? "speaking"
        : "idle";
  const onVoiceMic = () => {
    if (input.listening) input.stop();
    else {
      output.stop();
      input.start();
    }
  };

  const suggestions = useMemo(() => suggestionsFor(status.data), [status.data]);
  const empty = messages.length === 0 && !loadingChat;
  const firstName = status.data?.firstName;

  const composerEl = (
    <Composer
      ref={composer}
      large={empty}
      busy={busy}
      disabled={!configured || limitReached || loadingChat}
      onSend={(t) => send(t)}
      onStop={stop}
      micSupported={input.supported}
      listening={input.listening && !voiceMode}
      interim={input.interim}
      onMic={() => (input.listening ? input.stop() : input.start())}
      onVoiceMode={startVoice}
      placeholder={limitReached ? "You've reached today's question limit" : undefined}
    />
  );

  return (
    <div className="relative flex h-full min-h-0">
      {/* Conversation list: docked on large screens, a drawer below. */}
      <aside className="hidden w-64 shrink-0 border-r border-border bg-sidebar/60 xl:block">
        <ChatHistory activeId={chatId} onSelect={openChat} onNew={newChat} onDeleted={(id) => id === chatId && newChat()} />
      </aside>
      {historyOpen && (
        <div className="fixed inset-0 z-50 xl:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setHistoryOpen(false)} aria-hidden />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw] border-r border-border bg-background shadow-xl">
            <button
              type="button"
              aria-label="Close conversations"
              onClick={() => setHistoryOpen(false)}
              className="absolute right-2 top-3 grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-muted"
            >
              <X className="size-4" />
            </button>
            <ChatHistory activeId={chatId} onSelect={openChat} onNew={newChat} onDeleted={(id) => id === chatId && newChat()} />
          </div>
        </div>
      )}

      <section className="relative flex min-w-0 flex-1 flex-col">
        {empty && <div className="assistant-glow pointer-events-none absolute inset-x-0 top-0 h-[520px]" aria-hidden />}

        {/* Small top row: history toggle + new chat (the docked list covers this on xl). */}
        <div className="relative z-10 flex items-center justify-between gap-2 border-b border-border/60 bg-background/80 px-4 py-1.5 backdrop-blur xl:hidden">
          <button
            type="button"
            onClick={() => setHistoryOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <HistoryIcon className="size-4" /> Chats
          </button>
          {!empty && (
            <button
              type="button"
              onClick={newChat}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Sparkles className="size-4" /> New chat
            </button>
          )}
        </div>

        <div
          ref={scroller}
          className="relative min-h-0 flex-1 overflow-y-auto"
          onScroll={(e) => {
            const el = e.currentTarget;
            setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
          }}
        >
          {empty ? (
            <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col justify-center px-4 pb-10 pt-8 sm:px-6">
              <div className="sa-rise flex flex-col items-center text-center">
                <Orb size={64} state={input.listening ? "listening" : "idle"} />
                <h1 className="mt-6 text-3xl font-semibold tracking-[-0.02em] text-foreground sm:text-4xl">
                  <span className="assistant-gradient-text">
                    {greeting()}
                    {firstName ? `, ${firstName}` : ""}
                  </span>
                </h1>
                <p className="mt-3 max-w-xl text-[15px] leading-6 text-muted-foreground">
                  Ask me anything about your deals, visits, restaurants, partner leads, quotes and merchants. I read the
                  live SuperApp data and answer in seconds. Type it or just say it.
                </p>
              </div>

              {!configured && (
                <div className="sa-rise mx-auto mt-6 flex max-w-xl items-start gap-3 rounded-[var(--radius-xl)] border border-border bg-warning-soft px-4 py-3 text-sm text-warning-text">
                  <KeyRound className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <p>
                    The assistant isn&apos;t switched on yet. An admin needs to add the AI service settings
                    (<code className="font-mono text-xs">ASSISTANT_API_URL</code>, <code className="font-mono text-xs">ASSISTANT_API_KEY</code> and <code className="font-mono text-xs">ASSISTANT_MODEL</code>) to the SuperApp API and redeploy it.
                  </p>
                </div>
              )}

              <div className="sa-rise mt-8" style={{ animationDelay: "80ms" }}>
                {composerEl}
              </div>

              {suggestions.length > 0 && configured && (
                <div className={cn("mt-6 grid gap-2.5 sm:grid-cols-2", suggestions.length % 3 === 0 && "lg:grid-cols-3")}>
                  {suggestions.map((s, i) => (
                    <button
                      key={s.title}
                      type="button"
                      onClick={() => send(s.prompt)}
                      disabled={busy || limitReached}
                      className="sa-rise group flex items-start gap-3 rounded-[var(--radius-xl)] border border-border bg-card/80 p-3.5 text-left shadow-[0_1px_2px_rgba(16,24,40,0.04)] backdrop-blur transition-all hover:-translate-y-0.5 hover:border-primary-border hover:shadow-[0_8px_24px_-12px_rgba(44,103,245,0.35)] disabled:opacity-50"
                      style={{ animationDelay: `${140 + i * 50}ms` }}
                    >
                      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary-subtle text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                        <s.icon className="size-4" aria-hidden />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-foreground">{s.title}</span>
                        <span className="mt-0.5 line-clamp-2 block text-xs leading-5 text-muted-foreground">{s.prompt}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}

              <p className="mt-8 flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
                <Lock className="size-3" aria-hidden />
                It only sees what your login can see{status.data?.salesScope === "own" ? " (your own Salesforce records)" : ""}
                , and changes nothing until you click Confirm. Salesforce data refreshes every 15 minutes.
              </p>
            </div>
          ) : (
            <div className="mx-auto w-full max-w-3xl px-4 pb-6 pt-4 sm:px-6">
              {loadingChat ? (
                <div className="space-y-6 pt-6">
                  {[0, 1].map((i) => (
                    <div key={i} className="space-y-3">
                      <div className="ml-auto h-10 w-2/3 animate-pulse rounded-2xl bg-muted" />
                      <div className="h-24 w-full animate-pulse rounded-2xl bg-muted/70" />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col gap-7">
                  {messages.map((m, i) =>
                    m.role === "user" ? (
                      <UserMessage key={m.id} message={m} />
                    ) : (
                      <AssistantMessage
                        key={m.id}
                        message={m}
                        streaming={m.id === streamingId}
                        status={m.id === streamingId ? toolStatus : null}
                        question={messages[i - 1]?.role === "user" ? messageText(messages[i - 1]) : undefined}
                        onRetry={busy ? undefined : () => retry(i)}
                        onActionChange={(next) =>
                          setMessages((prev) =>
                            prev.map((msg) => ({
                              ...msg,
                              blocks: msg.blocks.map((blk) =>
                                blk.type === "action" && blk.action.id === next.id ? { ...blk, action: next } : blk,
                              ),
                            })),
                          )
                        }
                        speak={{
                          supported: output.supported,
                          speaking: output.speakingId === m.id,
                          onSpeak: () => output.speak(m.id, messageText(m)),
                          onStop: output.stop,
                        }}
                      />
                    ),
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {!empty && (
          <div className="relative px-4 pb-4 pt-2 sm:px-6">
            <div className="pointer-events-none absolute inset-x-0 -top-8 h-8 bg-gradient-to-t from-background to-transparent" aria-hidden />
            {!atBottom && (
              <button
                type="button"
                onClick={() => scrollToBottom()}
                aria-label="Scroll to the latest message"
                className="absolute -top-12 left-1/2 grid size-8 -translate-x-1/2 place-items-center rounded-full border border-border bg-card text-muted-foreground shadow-md hover:text-foreground"
              >
                <ArrowDown className="size-4" />
              </button>
            )}
            <div className="mx-auto max-w-3xl">
              {composerEl}
              <p className="mt-2 text-center text-[11px] text-muted-foreground">
                {left !== null && left <= 10
                  ? `${Math.max(0, left)} question${left === 1 ? "" : "s"} left today · `
                  : ""}
                Answers come from live SuperApp data. Check important numbers before sharing.
              </p>
            </div>
          </div>
        )}
        {input.error && !voiceMode && (
          <div role="alert" className="absolute bottom-28 left-1/2 z-20 -translate-x-1/2 rounded-lg border border-border bg-popover px-3 py-2 text-sm text-foreground shadow-lg">
            {input.error}
            <button type="button" className="ml-3 text-muted-foreground hover:text-foreground" onClick={input.clearError}>
              Dismiss
            </button>
          </div>
        )}
      </section>

      {voiceMode && (
        <VoiceOverlay
          phase={voicePhase}
          transcript={input.listening ? input.interim : ""}
          caption={voicePhase === "thinking" && toolStatus ? toolStatus : null}
          error={input.error}
          onMic={onVoiceMic}
          onClose={endVoice}
        />
      )}
      <span className="sr-only" aria-live="polite">
        {busy ? "The assistant is answering" : announce}
      </span>
    </div>
  );
}
