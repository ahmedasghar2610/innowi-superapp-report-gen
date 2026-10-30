"use client";

import { useCallback, useEffect, useState } from "react";
import { BrandMark } from "@/components/brand/brand-mark";
import { Spinner } from "@/components/ui";
import { formatDate } from "@/lib/format";
import type { HardwarePlan, PublicOffer, PublicRequest } from "../types";
import { Builder } from "./builder";
import { Proposal } from "./proposal";
import { PublicApiError, publicQuotes } from "./public-api";

function useRequestParam(): [string | null, (id: string | null) => void] {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    setId(new URLSearchParams(window.location.search).get("r"));
  }, []);
  const set = (next: string | null) => {
    setId(next);
    const url = new URL(window.location.href);
    if (next) url.searchParams.set("r", next);
    else url.searchParams.delete("r");
    window.history.replaceState(null, "", url.toString());
  };
  return [id, set];
}

/** Route /q/[token]: the restaurant's build-your-own quote page. */
export function QuotePage({ token }: { token: string }) {
  const [offer, setOffer] = useState<PublicOffer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requestId, setRequestId] = useRequestParam();
  const [request, setRequest] = useState<PublicRequest | null>(null);
  const [editFrom, setEditFrom] = useState<{ qty: Record<string, number>; plan: HardwarePlan; counterFor?: string } | undefined>();

  useEffect(() => {
    let cancelled = false;
    publicQuotes
      .offer(token)
      .then((o) => !cancelled && setOffer(o))
      .catch((e) => !cancelled && setError(e instanceof PublicApiError ? e.message : "This quote link isn't working."));
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (!requestId || request?.id === requestId) return;
    publicQuotes
      .request(token, requestId)
      .then(setRequest)
      .catch(() => setRequestId(null));
  }, [token, requestId, request?.id, setRequestId]);

  const edit = useCallback(() => {
    if (request && offer) {
      // Back to the builder with what they picked (device software / first-station lines are derived, so skip them).
      const ids = new Map(offer.sections.flatMap((s) => s.items).map((i) => [i.sku, i.id]));
      const qty: Record<string, number> = {};
      for (const l of request.lines) {
        const id = ids.get(l.sku);
        if (id && (l.category === "hardware" || l.category === "lease" || l.category === "service" || l.category === "software")) {
          qty[id] = Math.max(qty[id] ?? 0, l.qty);
        }
      }
      // Devices: the hardware line carries the device count. Editing an existing
      // request sends the changes back as its next revision, not a new request.
      setEditFrom({ qty, plan: request.hardwarePlan, counterFor: request.status === "EXECUTED" ? undefined : request.id });
    }
    setRequest(null);
    setRequestId(null);
  }, [request, offer, setRequestId]);

  return (
    <div className="min-h-dvh bg-muted/40">
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <BrandMark size={30} />
            <span className="text-base font-semibold tracking-[-0.01em] text-foreground">Innowi</span>
          </div>
          {offer?.preparedBy && <span className="hidden text-xs text-muted-foreground sm:block">Your contact: {offer.preparedBy}</span>}
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:py-8">
        {error ? (
          <div className="mx-auto max-w-md rounded-xl border border-border bg-background p-6 text-center">
            <h1 className="text-lg font-semibold text-foreground">This link isn&apos;t available</h1>
            <p className="mt-1 text-sm text-muted-foreground">{error}</p>
          </div>
        ) : !offer ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner /> Loading your quote…
          </div>
        ) : request ? (
          <Proposal token={token} request={request} onChange={setRequest} onEdit={edit} />
        ) : (
          <>
            <div className="mb-6">
              <h1 className="text-2xl font-semibold tracking-[-0.011em] text-foreground sm:text-3xl">
                Build your Innowi setup for {offer.restaurantName}
              </h1>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                {offer.showPrices
                  ? "Choose your stations, devices and services. Your price updates as you go, and you get a proposal right away."
                  : "Choose your stations, devices and services and send it over. Your Innowi contact will come back with your pricing."}
              </p>
              {offer.message && (
                <div className="mt-4 max-w-2xl whitespace-pre-line rounded-xl border border-primary-border bg-primary-subtle/60 p-4 text-sm text-foreground">
                  {offer.message}
                </div>
              )}
              {offer.latestRequest && (
                <p className="mt-3 text-sm text-muted-foreground">
                  You sent {offer.latestRequest.number} on {formatDate(offer.latestRequest.createdAt)}.{" "}
                  <button type="button" className="font-medium text-primary underline underline-offset-4" onClick={() => setRequestId(offer.latestRequest!.id)}>
                    View it
                  </button>
                </p>
              )}
            </div>
            <Builder
              key={editFrom ? JSON.stringify(editFrom) : "new"}
              token={token}
              offer={offer}
              initial={editFrom}
              onSubmitted={(r) => {
                setRequest(r);
                setRequestId(r.id);
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
            />
          </>
        )}
      </main>
      <footer className="mx-auto max-w-6xl px-4 pb-8 text-xs text-muted-foreground">
        innowi.com · (510) 588-7102 · info@innowi.com
      </footer>
    </div>
  );
}
