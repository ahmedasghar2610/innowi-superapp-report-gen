/** Shapes shared with the API's app/modules/assistant (router.py, registry.py). */

export type ChartType = "bar" | "horizontal_bar" | "line" | "area" | "donut";
export type ChartFormat = "count" | "money" | "percent";

export interface ChartSpec {
  type: ChartType;
  title: string;
  subtitle?: string | null;
  labels: string[];
  series: { name: string; values: (number | null)[] }[];
  format: ChartFormat;
}

export type ActionStatus =
  | "pending"
  | "running"
  | "done"
  | "partial"
  | "failed"
  | "cancelled"
  | "expired"
  | "interrupted";

/** A change the assistant proposed. Nothing happens until its owner clicks Confirm. */
export interface ActionCard {
  id: string;
  name: string;
  title: string;
  items: string[];
  destructive: boolean;
  status: ActionStatus;
  results?: { label: string; ok: boolean; status: number; message?: string }[] | null;
  expiresAt?: string;
  /** How many API calls Confirm makes (one per record for bulk actions). */
  steps?: number;
}

export type Block =
  | { type: "text"; text: string }
  | { type: "chart"; chart: ChartSpec }
  | { type: "action"; action: ActionCard };

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  blocks: Block[];
  tools?: string[];
  createdAt?: string;
  error?: string;
  voice?: boolean;
}

export interface ChatBrief {
  id: string;
  title: string;
  pinned: boolean;
  updatedAt: string;
}

export interface Chat extends ChatBrief {
  messages: ChatMessage[];
}

export interface AssistantStatus {
  configured: boolean;
  provider: string;
  model: string | null;
  dailyLimit: number;
  usedToday: number;
  areas: string[];
  salesScope: "all" | "own" | "unlinked" | null;
  firstName: string | null;
}

/** One server-sent event from POST /assistant/chat. */
export type StreamEvent =
  | { type: "chat"; id: string }
  | { type: "status"; label: string }
  | { type: "text"; text: string }
  | { type: "chart"; chart: ChartSpec }
  | { type: "action"; action: ActionCard }
  | { type: "done"; tools: string[] }
  | { type: "error"; message: string };
