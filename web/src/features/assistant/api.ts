"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { API_BASE_URL } from "@/lib/constants";
import type { ActionCard, AssistantStatus, Chat, ChatBrief, StreamEvent } from "./types";

export const assistantKeys = {
  all: ["assistant"] as const,
  status: () => [...assistantKeys.all, "status"] as const,
  chats: () => [...assistantKeys.all, "chats"] as const,
  chat: (id: string) => [...assistantKeys.all, "chat", id] as const,
};

export function useAssistantStatus() {
  return useQuery({ queryKey: assistantKeys.status(), queryFn: () => api.get<AssistantStatus>("/assistant/status") });
}

export function useChats() {
  return useQuery({ queryKey: assistantKeys.chats(), queryFn: () => api.get<ChatBrief[]>("/assistant/chats") });
}

export function fetchChat(id: string) {
  return api.get<Chat>(`/assistant/chats/${encodeURIComponent(id)}`);
}

export function useRenameChat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; title?: string; pinned?: boolean }) =>
      api.patch<ChatBrief>(`/assistant/chats/${encodeURIComponent(id)}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: assistantKeys.chats() }),
  });
}

export function useDeleteChat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/assistant/chats/${encodeURIComponent(id)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: assistantKeys.chats() }),
  });
}

/** Carry out (or drop) a proposed action. The API runs it as the signed-in person. */
export interface Revealed {
  label: string;
  [key: string]: string | number | boolean;
}

/** Returns the updated card, plus any show-once values (a new link, a temporary password). */
export function confirmAction(id: string) {
  return api.post<{ action: ActionCard; revealed?: Revealed[] }>(`/assistant/actions/${encodeURIComponent(id)}/confirm`);
}

export function getAction(id: string) {
  return api.get<{ action: ActionCard }>(`/assistant/actions/${encodeURIComponent(id)}`).then((r) => r.action);
}

export function cancelAction(id: string) {
  return api.post<{ action: ActionCard }>(`/assistant/actions/${encodeURIComponent(id)}/cancel`).then((r) => r.action);
}

export class StreamError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * POST /assistant/chat and hand each server-sent event to `onEvent` as it
 * arrives. Uses fetch (not axios) because axios can't read a streamed body in
 * the browser. Goes through the same-origin /api/v1 proxy, which attaches the
 * login and passes the stream through unbuffered.
 */
export async function streamChat(
  body: { message: string; chatId?: string | null; voice?: boolean },
  onEvent: (ev: StreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/assistant/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(body),
    credentials: "same-origin",
    signal,
  });
  if (!res.ok || !res.body) {
    let message = "The assistant couldn't answer right now.";
    try {
      const data = await res.json();
      const m = data?.message ?? data?.detail;
      if (typeof m === "string") message = m;
      else if (Array.isArray(m) && typeof m[0] === "string") message = m[0];
    } catch {
      /* not JSON */
    }
    if (res.status === 401 && typeof window !== "undefined") window.location.href = "/login";
    throw new StreamError(message, res.status);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let cut: number;
    while ((cut = buffer.indexOf("\n\n")) >= 0) {
      const chunk = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      const ev = parseEvent(chunk);
      if (ev) onEvent(ev);
    }
  }
  buffer += decoder.decode();
  const last = parseEvent(buffer);
  if (last) onEvent(last);
}

function parseEvent(chunk: string): StreamEvent | null {
  const data = chunk
    .split("\n")
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice(5).trimStart())
    .join("\n");
  if (!data) return null;
  try {
    return JSON.parse(data) as StreamEvent;
  } catch {
    return null;
  }
}
