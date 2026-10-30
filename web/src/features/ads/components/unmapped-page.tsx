"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Eye, EyeOff, FileUp, Link2, Plus } from "lucide-react";
import { Badge, Button, Card, Dialog, ErrorState, Field, Input, Skeleton, StatTile, Table, TableBody, TableCell, TableHead, TableHeader, TableMessageRow, TableRow, useToast } from "@/components/ui";
import { useAccountList, useAddAccount, useAdsStatus, useImportAccounts, useLinkMerchant, useUnmapped, useUpdateAnyAccount } from "../api";
import { fmtDay, fmtMoney, fmtRange } from "../lib";
import type { UnmappedRow } from "../types";
import { DemoBadge, Section } from "./parts";
import { LinkDialog } from "./merchant-link";

/** Google Ads accounts not linked to a merchant (no Innowi record), with
 *  name-based suggestions to confirm — plus importing the old sheet's
 *  account list and adding an account by hand. */
export function UnmappedPage() {
  const status = useAdsStatus();
  const q = useUnmapped();
  const canManage = !!status.data?.canManage;
  const u = q.data;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <Link href="/ads" className="mb-1 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" />
            Back to portfolio
          </Link>
          <h1 className="text-2xl font-semibold tracking-[-0.011em] text-foreground">Unmapped Accounts</h1>
          <p className="mt-1 max-w-3xl text-table text-muted-foreground">
            Google Ads accounts that aren&apos;t linked to a merchant, so the approved budget, ads-paid-by, address and client offers can&apos;t be shown. Accounts marked
            Needs Review have a likely match by name, which a person should confirm.
          </p>
        </div>
        {canManage && <Toolbar />}
      </div>
      {q.error ? (
        <ErrorState title="Couldn't load the accounts" description={q.error.messages?.[0] ?? q.error.message} />
      ) : !u ? (
        <Skeleton className="h-80 w-full" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Total accounts" value={u.summary.total} />
            <StatTile label="Needs review" value={u.summary.needsReview} tone={u.summary.needsReview ? "warning" : "neutral"} />
            <StatTile label="No match found" value={u.summary.noMatch} />
            <StatTile label="Monthly spend" value={fmtMoney(u.summary.monthlySpend, { cents: false })} hint={`Spend in the last 30 days of data (${fmtRange(u.spendWindow.start, u.spendWindow.end)}).`} />
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Google Ads account</TableHead>
                <TableHead>Customer ID</TableHead>
                <TableHead align="right">Campaigns</TableHead>
                <TableHead align="right">Est. monthly spend</TableHead>
                <TableHead>Mapping status</TableHead>
                <TableHead>Suggested match</TableHead>
                <TableHead>Last seen</TableHead>
                {canManage && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {u.rows.map((r) => (
                <Row key={r.id} r={r} canManage={canManage} />
              ))}
              {!u.rows.length && (
                <TableMessageRow colSpan={8}>
                  <p className="py-6 text-center text-sm text-muted-foreground">Every account is linked to a merchant.</p>
                </TableMessageRow>
              )}
            </TableBody>
          </Table>
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Why these still show metrics.</span> Spend, orders and — when the average ticket is entered on the account — revenue,
            ROI and ROAS work without a merchant. Approved budget, Budget Mismatch, ads-paid-by and client offers need the link.
          </p>
          {canManage && <Hidden />}
        </>
      )}
    </div>
  );
}

function Row({ r, canManage }: { r: UnmappedRow; canManage: boolean }) {
  const [open, setOpen] = useState(false);
  const { link } = useLinkMerchant();
  const hide = useUpdateAnyAccount();
  const { toast } = useToast();
  return (
    <TableRow>
      <TableCell>
        <Link href={`/ads/${r.id}`} className="font-medium text-foreground hover:underline">
          {r.name}
        </Link>
        <div className="flex gap-1">
          {r.source === "DEMO" && <DemoBadge />}
          {r.source === "SHEET" && <Badge tone="neutral" icon={false}>From sheet</Badge>}
          {!r.hasTicket && <span className="text-xs text-muted-foreground">No avg ticket</span>}
        </div>
      </TableCell>
      <TableCell className="font-mono text-xs">{r.customerId}</TableCell>
      <TableCell align="right">{r.campaigns}</TableCell>
      <TableCell align="right">{fmtMoney(r.estMonthlySpend, { cents: true })}</TableCell>
      <TableCell>{r.mappingStatus === "needs_review" ? <Badge tone="warning">Needs Review</Badge> : <Badge tone="neutral" icon={false}>Unmapped</Badge>}</TableCell>
      <TableCell>
        {r.suggestion ? (
          <div>
            <div className="font-medium text-foreground">{r.suggestion.name}</div>
            <div className="text-xs text-muted-foreground">{[r.suggestion.reason, r.suggestion.city].filter(Boolean).join(" · ")}</div>
          </div>
        ) : (
          <span className="text-muted-foreground">No match found</span>
        )}
      </TableCell>
      <TableCell className="whitespace-nowrap text-muted-foreground">{r.lastSeen ? fmtDay(r.lastSeen) : "—"}</TableCell>
      {canManage && (
        <TableCell className="whitespace-nowrap">
          {r.source !== "DEMO" && (
            <div className="flex justify-end gap-1">
              {r.suggestion && (
                <Button
                  size="xs"
                  loading={link.isPending}
                  onClick={() =>
                    link.mutate(
                      { id: r.id, merchantId: r.suggestion!.merchantId },
                      { onSuccess: () => toast({ variant: "success", title: "Linked", description: `${r.name} → ${r.suggestion!.name}` }) },
                    )
                  }
                >
                  Confirm match
                </Button>
              )}
              <Button size="xs" variant="outline" onClick={() => setOpen(true)}>
                <Link2 className="size-4" />
                Link…
              </Button>
              <Button
                size="xs"
                variant="ghost"
                title="Hide (test accounts, accounts we don't manage) — stops syncing it"
                loading={hide.isPending}
                onClick={() => hide.mutate({ id: r.id, patch: { state: "ignored" } }, { onSuccess: () => toast({ variant: "success", title: `${r.name} hidden` }) })}
              >
                <EyeOff className="size-4" />
              </Button>
            </div>
          )}
          {open && <LinkDialog accountId={r.id} name={r.name} onClose={() => setOpen(false)} />}
        </TableCell>
      )}
    </TableRow>
  );
}

function Toolbar() {
  const fileRef = useRef<HTMLInputElement>(null);
  const imp = useImportAccounts();
  const { toast } = useToast();
  const [adding, setAdding] = useState(false);
  return (
    <div className="flex flex-wrap gap-2">
      <input
        ref={fileRef}
        type="file"
        accept=".xlsx"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          imp.mutate(f, {
            onSuccess: (r) =>
              toast({
                variant: "success",
                title: "Sheet imported",
                description: `${r.created} accounts added, ${r.updated} updated, ${r.linked} linked to a merchant by exact name. Average-ticket inputs filled from Total Sales ÷ No of Orders.`,
              }),
            onError: (err) => toast({ variant: "error", title: "Import failed", description: err.messages?.[0] ?? err.message }),
          });
        }}
      />
      <Button variant="outline" loading={imp.isPending} onClick={() => fileRef.current?.click()} title='The old "Automation - Google Ads Results.xlsx" — reads the "GBP Dashboard" tab'>
        <FileUp className="size-4" />
        Import from sheet
      </Button>
      <Button variant="outline" onClick={() => setAdding(true)}>
        <Plus className="size-4" />
        Add account
      </Button>
      {adding && <AddDialog onClose={() => setAdding(false)} />}
    </div>
  );
}

function AddDialog({ onClose }: { onClose: () => void }) {
  const add = useAddAccount();
  const { toast } = useToast();
  const [cid, setCid] = useState("");
  const [name, setName] = useState("");
  const digits = cid.replace(/\D/g, "");
  return (
    <Dialog
      open
      onClose={onClose}
      title="Add a Google Ads account"
      description="Normally accounts appear by themselves from the manager account on the next refresh. Add one by hand only if it isn't there yet."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={digits.length !== 10 || !name.trim()}
            loading={add.isPending}
            onClick={() =>
              add.mutate(
                { customerId: digits, name: name.trim() },
                {
                  onSuccess: () => {
                    toast({ variant: "success", title: "Account added" });
                    onClose();
                  },
                  onError: (e) => toast({ variant: "error", title: "Couldn't add", description: e.messages?.[0] ?? e.message }),
                },
              )
            }
          >
            Add
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Customer ID" htmlFor="ads-cid" hint="10 digits, e.g. 284-030-8978">
          <Input id="ads-cid" value={cid} onChange={(e) => setCid(e.target.value)} placeholder="123-456-7890" />
        </Field>
        <Field label="Account name" htmlFor="ads-name">
          <Input id="ads-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}

function Hidden() {
  const [show, setShow] = useState(false);
  const list = useAccountList(show ? "ignored" : undefined);
  const restore = useUpdateAnyAccount();
  const rows = show ? (list.data ?? []) : [];
  return (
    <Section
      title="Hidden accounts"
      aside={
        <Button size="sm" variant="ghost" onClick={() => setShow((v) => !v)}>
          <Eye className="size-4" />
          {show ? "Hide list" : "Show"}
        </Button>
      }
    >
      {show && (
        <Card className="p-0">
          {list.isPending ? (
            <Skeleton className="h-20 w-full" />
          ) : !rows.length ? (
            <p className="p-4 text-sm text-muted-foreground">No hidden accounts.</p>
          ) : (
            <ul className="divide-y divide-border">
              {rows.map((a) => (
                <li key={a.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                  <span className="flex-1">
                    {a.name} <span className="font-mono text-xs text-muted-foreground">{a.customerId}</span>
                  </span>
                  <Button size="xs" variant="outline" loading={restore.isPending} onClick={() => restore.mutate({ id: a.id, patch: { state: "active" } })}>
                    Restore
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </Section>
  );
}
