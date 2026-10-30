"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Dialog, Textarea, useToast } from "@/components/ui";
import { useAddAgents } from "../queries";
import type { AddAgentsResult, AgentInput } from "../types";

const COLUMNS: { key: keyof AgentInput; words: string[] }[] = [
  { key: "name", words: ["agent", "name", "company", "business", "dba"] },
  { key: "contactName", words: ["contact", "person", "owner", "rep"] },
  { key: "email", words: ["email", "e-mail", "mail"] },
  { key: "phone", words: ["phone", "mobile", "cell", "tel"] },
  { key: "city", words: ["city", "town"] },
  { key: "state", words: ["state", "st", "province"] },
];
const DEFAULT_ORDER: (keyof AgentInput)[] = ["name", "contactName", "email", "phone", "city", "state"];

/** Rows pasted from Excel / Google Sheets (tabs) or a CSV. A header row is recognised by its words. */
export function parseAgents(text: string): { agents: AgentInput[]; header: boolean } {
  const lines = text.split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l.trim());
  if (!lines.length) return { agents: [], header: false };
  const split = (l: string) => (l.includes("\t") ? l.split("\t") : l.split(",")).map((c) => c.trim().replace(/^"|"$/g, ""));
  const first = split(lines[0]).map((c) => c.toLowerCase());
  const mapped = first.map((c) => COLUMNS.find((col) => col.words.some((w) => c === w || c.startsWith(w + " ") || c.endsWith(" " + w)))?.key);
  const header = mapped.filter(Boolean).length >= 2 || (mapped[0] === "name" && first.length === 1 && /^(agent|name)s?$/.test(first[0]));
  const order = header ? mapped : DEFAULT_ORDER;
  const agents: AgentInput[] = [];
  for (const l of header ? lines.slice(1) : lines) {
    const cells = split(l);
    const a: AgentInput = { name: "" };
    order.forEach((k, i) => {
      if (k && cells[i]) a[k] = cells[i];
    });
    if (!a.name && a.contactName) a.name = a.contactName;
    if (a.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a.email)) delete a.email;
    if (a.name) agents.push(a);
  }
  return { agents, header };
}

/** Paste an ISO's agent list. Agents already under the ISO (same name or e-mail) are skipped. */
export function AddAgentsDialog({ open, onClose, isoId, isoName }: { open: boolean; onClose: () => void; isoId: string; isoName: string }) {
  const { toast } = useToast();
  const add = useAddAgents();
  const [text, setText] = useState("");
  const [check, setCheck] = useState<AddAgentsResult | null>(null);
  useEffect(() => {
    if (open) {
      setText("");
      setCheck(null);
    }
  }, [open]);
  const parsed = useMemo(() => parseAgents(text), [text]);

  const run = (dryRun: boolean) =>
    add.mutate(
      { id: isoId, agents: parsed.agents, dryRun },
      {
        onSuccess: (r) => {
          if (dryRun) setCheck(r);
          else {
            toast({ variant: "success", title: `Added ${r.created} agent${r.created === 1 ? "" : "s"}`, description: r.skipped.length ? `${r.skipped.length} were already there.` : undefined });
            onClose();
          }
        },
        onError: (e) => toast({ variant: "error", title: "Couldn't add agents", description: e.messages.join(" · ") }),
      },
    );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Add agents to ${isoName}`}
      description="Paste rows from their agent list (Excel, Google Sheets or CSV). Columns: name, contact, e-mail, phone, city, state — or include a header row and any order works."
      size="xl"
      footerBordered
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          {check ? (
            <Button variant="default" size="sm" onClick={() => run(false)} loading={add.isPending} disabled={check.created === 0} data-testid="agents-add">
              Add {check.created} agent{check.created === 1 ? "" : "s"}
            </Button>
          ) : (
            <Button variant="default" size="sm" onClick={() => run(true)} loading={add.isPending} disabled={!parsed.agents.length} data-testid="agents-check">
              Check {parsed.agents.length || ""} row{parsed.agents.length === 1 ? "" : "s"}
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="add-agents-dialog">
        <Textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setCheck(null);
          }}
          rows={8}
          placeholder={"Name\tContact\tEmail\tPhone\tCity\tState\nSmith Payments\tJohn Smith\tjohn@smithpay.com\t555-0100\tAustin\tTX"}
          aria-label="Agent rows"
          className="font-mono text-xs"
        />
        {parsed.agents.length ? (
          <div className="rounded-lg border border-border">
            <p className="border-b border-border px-3 py-2 text-xs text-muted-foreground">
              {parsed.agents.length} agent{parsed.agents.length === 1 ? "" : "s"} read{parsed.header ? " (header row found)" : ""}. First few:
            </p>
            <ul className="divide-y divide-border">
              {parsed.agents.slice(0, 5).map((a, i) => (
                <li key={i} className="px-3 py-1.5 text-xs text-foreground">
                  <span className="font-medium">{a.name}</span>
                  <span className="text-muted-foreground"> {[a.contactName, a.email, a.phone, [a.city, a.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ")}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {check ? (
          <p className="text-table text-foreground" data-testid="agents-check-result">
            {check.created} new{check.skipped.length ? ` · ${check.skipped.length} already under ${isoName} (skipped)` : ""}.
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
