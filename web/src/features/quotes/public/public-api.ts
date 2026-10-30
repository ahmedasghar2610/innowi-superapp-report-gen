import type { HardwarePlan, Priced, PublicOffer, PublicRequest, Selection, SignInput } from "../types";

/**
 * The restaurant's quote page talks to the public /public/quotes/{token}
 * endpoints with plain fetch (through the same-origin /api/v1 proxy), not the
 * staff axios client, whose 401 handler would send a visitor to /login.
 */
export class PublicApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/v1/public/quotes/${path}`, {
    cache: "no-store",
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  }).catch(() => null);
  if (!res) throw new PublicApiError(0, "Couldn't reach the server. Check your connection and try again.");
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const m = body?.message;
    throw new PublicApiError(res.status, (Array.isArray(m) ? m.join(" · ") : m) || "Something went wrong. Please try again.");
  }
  return (await res.json()) as T;
}

const enc = encodeURIComponent;

export const publicQuotes = {
  offer: (token: string) => call<PublicOffer>(enc(token)),
  price: (token: string, items: Selection[], hardwarePlan: HardwarePlan) =>
    call<Priced>(`${enc(token)}/price`, { method: "POST", body: JSON.stringify({ items, hardwarePlan }) }),
  submit: (
    token: string,
    body: {
      items: Selection[];
      hardwarePlan: HardwarePlan;
      contact: { name: string; email: string; phone?: string };
      notes?: string;
      /** Set to counter an existing request: it becomes its next revision. */
      requestId?: string;
    },
  ) => call<PublicRequest>(`${enc(token)}/requests`, { method: "POST", body: JSON.stringify(body) }),
  request: (token: string, id: string) => call<PublicRequest>(`${enc(token)}/requests/${enc(id)}`),
  sign: (token: string, id: string, body: SignInput) =>
    call<PublicRequest>(`${enc(token)}/requests/${enc(id)}/sign`, { method: "POST", body: JSON.stringify(body) }),
  decline: (token: string, id: string, body: { name: string; reason?: string }) =>
    call<PublicRequest>(`${enc(token)}/requests/${enc(id)}/decline`, { method: "POST", body: JSON.stringify(body) }),
  pdfUrl: (token: string, id: string) => `/api/v1/public/quotes/${enc(token)}/requests/${enc(id)}/pdf`,
};
