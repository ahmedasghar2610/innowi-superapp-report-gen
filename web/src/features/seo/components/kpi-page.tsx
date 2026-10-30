"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Badge, type BadgeTone, Button, Dialog, ErrorState, Field, Input, Select, Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, useToast } from "@/components/ui";
import { useAddKpi, useDeleteKpi, useKpis, useSeoStatus, useUpdateKpi } from "../api";
import type { Kpi, KpiCurrent } from "../types";
import { HeadHint, InfoNote, Section } from "./parts";

const STATUS: Record<Kpi["status"], { label: string; tone: BadgeTone }> = {
  proposed: { label: "Proposed", tone: "neutral" },
  active: { label: "Active", tone: "success" },
  retired: { label: "Retired", tone: "outline" },
};
const GRADER: Record<Kpi["grader"], string> = {
  score: "Score (0–100)",
  band: "Band (in range)",
  sla: "SLA (on time)",
  gate: "Gate (yes / no)",
  trend: "Trend (up / down)",
};
const CURRENT_CLASS: Record<KpiCurrent["tone"], string> = {
  neutral: "text-foreground",
  ok: "text-success-subtle-foreground",
  warning: "text-warning-text",
  hold: "text-muted-foreground",
};

/** /web/seo/kpis — KPI Studio: the four KPI sets, their targets, and where each one stands today. */
export function KpiPage() {
  const q = useKpis();
  const status = useSeoStatus();
  const canManage = !!status.data?.canManage;
  const [adding, setAdding] = useState<number | null>(null);

  if (q.error) return <ErrorState title="Couldn't load KPI Studio" description={q.error.message} />;
  if (!q.data) return <Skeleton className="h-96 w-full" />;

  return (
    <>
      <InfoNote>
        Targets are drafts until the team agrees them — mark a KPI Active once it&apos;s signed off. &quot;Today&quot; is computed from the synced data across all active sites; KPIs
        that need an on-hold source (link data, the page editor, ordering data) show as on hold rather than a guess.
      </InfoNote>
      {q.data.sets.map((s) => (
        <Section
          key={s.set}
          title={s.label}
          aside={
            <span className="flex items-center gap-2">
              <span className="hidden text-xs text-muted-foreground md:inline">{s.note}</span>
              {canManage && (
                <Button size="sm" variant="outline" onClick={() => setAdding(s.set)}>
                  <Plus className="size-4" />
                  Add KPI
                </Button>
              )}
            </span>
          }
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">Key</TableHead>
                <TableHead className="min-w-64">KPI</TableHead>
                <TableHead>
                  <HeadHint label="Grader" hint="How the KPI is judged against its target" />
                </TableHead>
                <TableHead className="w-44">Target</TableHead>
                <TableHead>Source</TableHead>
                <TableHead className="min-w-56">Today</TableHead>
                <TableHead className="w-36">Status</TableHead>
                {canManage && <TableHead className="w-10" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {s.kpis.map((k) => (
                <KpiRow key={k.key} k={k} canManage={canManage} />
              ))}
            </TableBody>
          </Table>
        </Section>
      ))}
      <AddKpiDialog set={adding} label={q.data.sets.find((s) => s.set === adding)?.label} onClose={() => setAdding(null)} />
    </>
  );
}

function KpiRow({ k, canManage }: { k: Kpi; canManage: boolean }) {
  const update = useUpdateKpi();
  const del = useDeleteKpi();
  const { toast } = useToast();
  const [target, setTarget] = useState(k.target);
  const save = (body: { target?: string; status?: string }) =>
    update.mutate(
      { key: k.key, ...body },
      {
        onSuccess: () => toast({ variant: "success", title: `${k.key} updated` }),
        onError: (e) => toast({ variant: "error", title: "Couldn't update", description: e.messages?.[0] ?? e.message }),
      },
    );
  return (
    <TableRow className={k.status === "retired" ? "opacity-60" : undefined}>
      <TableCell className="font-mono text-xs text-muted-foreground">{k.key}</TableCell>
      <TableCell>
        <span className="text-sm text-foreground">{k.name}</span>
        {k.custom && (
          <Badge tone="outline" icon={false} className="ml-1.5">
            Custom
          </Badge>
        )}
      </TableCell>
      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{GRADER[k.grader]}</TableCell>
      <TableCell>
        {canManage ? (
          <Input
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            onBlur={() => target.trim() && target.trim() !== k.target && save({ target: target.trim() })}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            className="h-8 text-xs"
            aria-label={`Target for ${k.key}`}
          />
        ) : (
          <span className="text-xs">{k.target}</span>
        )}
      </TableCell>
      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{k.source}</TableCell>
      <TableCell className="text-xs">
        {k.current ? (
          k.current.tone === "hold" ? (
            <Badge tone="outline" icon={false}>
              {k.current.text}
            </Badge>
          ) : (
            <span className={CURRENT_CLASS[k.current.tone]}>{k.current.text}</span>
          )
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell>
        {canManage ? (
          <Select value={k.status} onChange={(e) => save({ status: e.target.value })} className="h-8 text-xs" aria-label={`Status of ${k.key}`}>
            {(Object.keys(STATUS) as Kpi["status"][]).map((s) => (
              <option key={s} value={s}>
                {STATUS[s].label}
              </option>
            ))}
          </Select>
        ) : (
          <Badge tone={STATUS[k.status].tone}>{STATUS[k.status].label}</Badge>
        )}
      </TableCell>
      {canManage && (
        <TableCell>
          {k.custom && (
            <Button size="icon" variant="ghost" aria-label={`Delete ${k.key}`} loading={del.isPending} onClick={() => del.mutate(k.key, { onSuccess: () => toast({ variant: "success", title: `${k.key} deleted` }) })}>
              <Trash2 className="size-4" />
            </Button>
          )}
        </TableCell>
      )}
    </TableRow>
  );
}

function AddKpiDialog({ set, label, onClose }: { set: number | null; label?: string; onClose: () => void }) {
  const add = useAddKpi();
  const { toast } = useToast();
  const [form, setForm] = useState({ name: "", grader: "score", target: "", source: "" });
  const close = () => {
    setForm({ name: "", grader: "score", target: "", source: "" });
    onClose();
  };
  const ok = form.name.trim().length >= 2 && form.target.trim() && form.source.trim();
  return (
    <Dialog
      open={set != null}
      onClose={close}
      title="Add a KPI"
      description={label}
      footer={
        <>
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button
            disabled={!ok}
            loading={add.isPending}
            onClick={() =>
              add.mutate(
                { set: set!, ...form },
                {
                  onSuccess: () => {
                    toast({ variant: "success", title: "KPI added as Proposed" });
                    close();
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
        <Field label="Name" required>
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Menu pages indexed" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Grader">
            <Select value={form.grader} onChange={(e) => setForm({ ...form, grader: e.target.value })}>
              {(Object.keys(GRADER) as Kpi["grader"][]).map((g) => (
                <option key={g} value={g}>
                  {GRADER[g]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Target" required>
            <Input value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} placeholder="≥ 90%" />
          </Field>
        </div>
        <Field label="Source" required hint="Where the number comes from, e.g. Search Console, GA4, PageSpeed.">
          <Input value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} />
        </Field>
        <p className="text-xs text-muted-foreground">Custom KPIs are tracked by hand — &quot;Today&quot; stays empty until a calculation is added for them.</p>
      </div>
    </Dialog>
  );
}
