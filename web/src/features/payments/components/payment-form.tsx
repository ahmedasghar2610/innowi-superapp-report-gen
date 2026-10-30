"use client";

import { useEffect, useState } from "react";
import { Button, Dialog, Field, Input, Select, Textarea, useToast } from "@/components/ui";
import { useAddPayment, useDeletePayment, useUpdatePayment, type PaymentInput } from "../api";
import { money, monthLabel } from "../lib";
import type { PaymentMonth } from "../types";

const STATUSES = ["Active", "Paused", "Not live yet", "Churned"];

interface Draft {
  month: string;
  status: string;
  packageType: string;
  contract: string;
  charged: string;
  ordersRevenue: string;
  commission: string;
  notes: string;
}

const num = (v: string): number | null => {
  const t = v.replace(/[$,\s]/g, "");
  return t === "" ? null : Number(t);
};
const str = (v: number | null | undefined) => (v == null ? "" : String(v));

function thisMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Add a month by hand, or change one (imported or not). One payment per merchant per month;
 * the variance is contract − charged.
 */
export function PaymentFormDialog({
  merchantId,
  open,
  onClose,
  editing,
  defaults,
  taken,
}: {
  merchantId: string;
  open: boolean;
  onClose: () => void;
  /** The month being edited; empty = add a new one. */
  editing?: PaymentMonth | null;
  /** Pre-fill a new month (e.g. from the latest one: same contract and package). */
  defaults?: Partial<PaymentMonth> | null;
  /** Months (YYYY-MM-01) that already have a payment. */
  taken: string[];
}) {
  const { toast } = useToast();
  const add = useAddPayment(merchantId);
  const update = useUpdatePayment(merchantId);
  const [d, setD] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const src = editing ?? defaults ?? {};
    setError(null);
    setD({
      month: editing ? editing.month.slice(0, 7) : thisMonth(),
      status: src.status ?? "Active",
      packageType: src.packageType ?? "Paid",
      contract: str(src.contract),
      charged: editing ? str(editing.charged) : str(src.contract),
      ordersRevenue: editing ? str(editing.ordersRevenue) : "",
      commission: editing ? str(editing.commission) : "",
      notes: editing ? (editing.notes ?? "") : "",
    });
  }, [open, editing, defaults]);

  if (!d) return null;
  const set = (patch: Partial<Draft>) => setD({ ...d, ...patch });
  const contract = num(d.contract);
  const charged = num(d.charged);
  const bad = [contract, charged, num(d.ordersRevenue), num(d.commission)].some((v) => v != null && (Number.isNaN(v) || v < 0));
  const clash = taken.includes(`${d.month}-01`) && (!editing || editing.month.slice(0, 7) !== d.month);
  const busy = add.isPending || update.isPending;

  const save = () => {
    const body: PaymentInput = {
      month: d.month,
      status: d.status || null,
      packageType: d.packageType.trim() || null,
      contract,
      charged,
      ordersRevenue: num(d.ordersRevenue),
      commission: num(d.commission),
      notes: d.notes.trim() || null,
    };
    const done = {
      onSuccess: () => {
        toast({ variant: "success", title: `${monthLabel(`${d.month}-01`)} ${editing ? "updated" : "added"}` });
        onClose();
      },
      onError: (e: { messages?: string[]; message: string }) => setError(e.messages?.[0] ?? e.message),
    };
    if (editing) update.mutate({ id: editing.id, body }, done);
    else add.mutate(body, done);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={editing ? `Edit ${monthLabel(editing.month)}` : "Add a payment"}
      description={editing?.sourceSheet ? `Imported from “${editing.sourceSheet}”. Importing that month again would replace these changes.` : "One month of billing for this merchant."}
      size="xl"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={busy} disabled={!d.month || bad || clash}>
            {editing ? "Save" : "Add payment"}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Month" required error={clash ? "This month is already recorded — edit it instead." : undefined}>
          <Input type="month" value={d.month} onChange={(e) => set({ month: e.target.value })} data-autofocus />
        </Field>
        <Field label="Status">
          <Select value={d.status} onChange={(e) => set({ status: e.target.value })}>
            {[...new Set([...STATUSES, d.status].filter(Boolean))].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Contract ($)" hint="What the merchant should pay this month">
          <Input inputMode="decimal" value={d.contract} onChange={(e) => set({ contract: e.target.value })} placeholder="199" />
        </Field>
        <Field label="Charged ($)" hint="What was actually charged">
          <Input inputMode="decimal" value={d.charged} onChange={(e) => set({ charged: e.target.value })} placeholder="199" />
        </Field>
        <Field label="Online-order revenue ($)">
          <Input inputMode="decimal" value={d.ordersRevenue} onChange={(e) => set({ ordersRevenue: e.target.value })} placeholder="0" />
        </Field>
        <Field label="Commission-based charge ($)">
          <Input inputMode="decimal" value={d.commission} onChange={(e) => set({ commission: e.target.value })} />
        </Field>
        <Field label="Package type">
          <Input value={d.packageType} onChange={(e) => set({ packageType: e.target.value })} placeholder="Paid" />
        </Field>
        <div className="flex flex-col justify-end pb-2 text-sm">
          <span className="text-xs text-muted-foreground">Variance (contract − charged)</span>
          <span className={contract != null && charged != null && contract - charged > 0 ? "font-semibold text-text-destructive" : "font-semibold text-foreground"}>
            {contract != null && charged != null && !bad ? money(contract - charged, true) : "—"}
          </span>
        </div>
        <Field label="Notes" className="sm:col-span-2">
          <Textarea rows={3} value={d.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="e.g. Payments team asked not to charge this month" />
        </Field>
      </div>
      {bad && <p className="mt-3 text-sm text-text-destructive">Amounts must be numbers (0 or more).</p>}
      {error && <p className="mt-3 text-sm text-text-destructive">{error}</p>}
    </Dialog>
  );
}

export function DeletePaymentDialog({ merchantId, payment, onClose }: { merchantId: string; payment: PaymentMonth | null; onClose: () => void }) {
  const { toast } = useToast();
  const del = useDeletePayment(merchantId);
  return (
    <Dialog
      open={!!payment}
      onClose={onClose}
      tone="danger"
      title={payment ? `Delete ${monthLabel(payment.month)}?` : ""}
      description="The month's contract, charge and order revenue are removed from this merchant. Importing the report for that month again would bring it back."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            loading={del.isPending}
            onClick={() =>
              payment &&
              del.mutate(payment.id, {
                onSuccess: () => {
                  toast({ variant: "success", title: `${monthLabel(payment.month)} deleted` });
                  onClose();
                },
                onError: (e) => toast({ variant: "error", title: "Couldn't delete it", description: e.messages?.[0] ?? e.message }),
              })
            }
          >
            Delete
          </Button>
        </>
      }
    />
  );
}
