"use client";

import { useState } from "react";
import { Check, Copy, Mail } from "lucide-react";
import { Button, Dialog, Input } from "@/components/ui";
import type { QuoteLink } from "../types";

function mailto(link: QuoteLink, url: string): string {
  const first = link.contactName?.split(" ")[0];
  const subject = `Your Innowi quote for ${link.restaurantName}`;
  const body = [
    first ? `Hi ${first},` : "Hi,",
    "",
    link.mode === "SHOW_PRICES"
      ? "Here's a link where you can build your Innowi setup, see your pricing as you go, and get a proposal right away:"
      : "Here's a link where you can pick the stations, devices and services you need. Send it over and I'll come back with your pricing:",
    "",
    url,
    "",
    "Any questions, just reply to this e-mail.",
  ].join("\n");
  const to = link.contactEmail ? encodeURIComponent(link.contactEmail) : "";
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** Shows a quote link's URL once (only a hash is stored): copy it, or open a ready-made e-mail. */
export function LinkUrlDialog({ link, url, onClose }: { link: QuoteLink; url: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — the field is selectable */
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title="Quote link ready"
      description={`Send this to ${link.contactName || link.restaurantName}. Copy it now: for security it's shown only this once (you can always make a new one).`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Done
          </Button>
          <a
            href={mailto(link, url)}
            className="inline-flex h-8 items-center gap-1 rounded-lg bg-primary px-2.5 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
          >
            <Mail className="size-4" /> Write the e-mail
          </a>
        </>
      }
    >
      <div className="flex gap-2">
        <Input readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label="Quote link" className="font-mono text-xs" />
        <Button variant="outline" onClick={copy}>
          {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </Dialog>
  );
}
