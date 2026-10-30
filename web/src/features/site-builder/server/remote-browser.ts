// Remote-browser (PLAYWRIGHT_WS_ENDPOINT) helpers shared by the crawler and
// the /api/browser-check diagnostic. Managed hosts such as Hostinger web
// hosting cannot run Chromium, so the crawler connects to a hosted browser
// (e.g. Browserless) over WebSocket instead.

export type RemoteEndpoint = {
  /** Cleaned URL actually used for the connection. */
  url: string;
  /** `wss://host` without path/query, for messages. */
  host: string;
  /** Playwright-native server (path contains /playwright) vs. CDP. */
  mode: "playwright" | "cdp";
  /** Token with the middle masked, e.g. "3f1a…9c2e" — never the full value. */
  tokenMasked: string | null;
  tokenLength: number;
  /** Characters that would make a token invalid (quotes, spaces, …). */
  tokenSuspicious: string[];
  /** Cleanups applied to the raw value (for the diagnostic). */
  fixes: string[];
};

/** Read and sanitize PLAYWRIGHT_WS_ENDPOINT. Returns null when not set. */
export function readRemoteEndpoint(raw = process.env.PLAYWRIGHT_WS_ENDPOINT): RemoteEndpoint | null {
  if (!raw) return null;
  const fixes: string[] = [];
  let value = raw.trim();
  if (value !== raw) fixes.push("trimmed surrounding whitespace");
  // Panels sometimes store the literal quotes a user typed around the value.
  const unquoted = value.replace(/^["'`]+|["'`]+$/g, "");
  if (unquoted !== value) {
    fixes.push("removed surrounding quotes");
    value = unquoted;
  }
  // Someone pasted the http(s) dashboard URL instead of the WebSocket URL.
  if (/^https?:\/\//i.test(value)) {
    value = value.replace(/^http/i, "ws");
    fixes.push("changed http(s):// to ws(s)://");
  }
  if (!/^wss?:\/\//i.test(value)) {
    value = `wss://${value}`;
    fixes.push("added wss:// prefix");
  }
  // Whitespace inside the URL (e.g. a line break in the token) is never valid.
  const compact = value.replace(/\s+/g, "");
  if (compact !== value) {
    fixes.push("removed whitespace inside the URL");
    value = compact;
  }

  let host = value;
  let token: string | null = null;
  try {
    const u = new URL(value);
    host = `${u.protocol}//${u.host}`;
    token = u.searchParams.get("token");
  } catch {
    /* keep raw pieces */
  }
  const suspicious: string[] = [];
  if (token) {
    for (const ch of new Set(token)) {
      if (!/[A-Za-z0-9._~-]/.test(ch)) suspicious.push(ch);
    }
  }
  return {
    url: value,
    host,
    mode: /\/playwright(\?|$)/i.test(value) ? "playwright" : "cdp",
    tokenMasked: token ? maskToken(token) : null,
    tokenLength: token?.length ?? 0,
    tokenSuspicious: suspicious,
    fixes,
  };
}

export function maskToken(token: string): string {
  if (token.length <= 8) return `${token[0] ?? ""}…${token[token.length - 1] ?? ""}`;
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}

/** Human hint for a failed connection, based on what we can tell without the secret. */
export function explainConnectError(ep: RemoteEndpoint, reason: string): string {
  if (!ep.tokenMasked) {
    return " PLAYWRIGHT_WS_ENDPOINT has no ?token=… parameter — the value was probably cut off when saved. Re-enter it as one line: wss://production-sfo.browserless.io?token=YOUR_TOKEN";
  }
  if (ep.tokenSuspicious.length) {
    return ` The token contains characters that are never part of an API key (${ep.tokenSuspicious.map((c) => JSON.stringify(c)).join(", ")}). Re-copy it from the dashboard without quotes or spaces.`;
  }
  if (/401|403|Unauthorized|Invalid API key/i.test(reason)) {
    return ` The browser service rejected the token (${ep.tokenMasked}, ${ep.tokenLength} chars). Compare it with the API key on your dashboard, make sure the account's region matches the host (${ep.host}), and that the plan is active. Open /api/browser-check on this site for a full diagnostic.`;
  }
  return "";
}
