"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Shuffle, Users } from "lucide-react";
import { Button, Dialog, Field, Input, Select, Skeleton, useToast } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import { useAssignOrganizations } from "../queries";
import type { AssignInput, AssignResult } from "../types";
import { useSalesPeople } from "./partner-ui";

export type AssignScope =
  | { parentId: string; label: string }
  | { organizationIds: string[]; label: string };

/**
 * Hand many partners (or an ISO's agents) to the sales team at once.
 *
 * Pick the people, then either split evenly or type how many each gets
 * (20 / 30 / 20…). The preview updates as you go and shows which states each
 * person ends up with — agents in the same state stay with one person where the
 * numbers allow — and what they already look after. Nothing is saved until
 * "Assign".
 */
export function AssignDialog({ open, onClose, scope }: { open: boolean; onClose: () => void; scope: AssignScope }) {
  const { toast } = useToast();
  const { sales, others, isPending: peoplePending } = useSalesPeople();
  const preview = useAssignOrganizations();
  const apply = useAssignOrganizations();
  const [picked, setPicked] = useState<string[]>([]);
  const [mode, setMode] = useState<"even" | "counts">("even");
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [onlyUnassigned, setOnlyUnassigned] = useState(true);
  const [keepTogether, setKeepTogether] = useState<"state" | "city" | "none">("state");
  const [balance, setBalance] = useState(false);
  const [showOthers, setShowOthers] = useState(false);
  const [result, setResult] = useState<AssignResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // An ISO's agents: hand out the ones nobody has yet. A picked list: assign exactly those.
  const byIso = "parentId" in scope;

  useEffect(() => {
    if (!open) return;
    setPicked([]);
    setMode("even");
    setCounts({});
    setOnlyUnassigned(byIso);
    setKeepTogether("state");
    setBalance(false);
    setResult(null);
    setError(null);
  }, [open]);

  // A stable key, so a new scope object on every parent render doesn't re-run the preview.
  const scopeKey = "parentId" in scope ? `iso:${scope.parentId}` : `ids:${scope.organizationIds.join(",")}`;
  const scopeInput = useMemo(
    () => ("parentId" in scope ? { parentId: scope.parentId } : { organizationIds: scope.organizationIds }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scopeKey],
  );


  const input = (dryRun: boolean): AssignInput => ({
    ...scopeInput,
    onlyUnassigned,
    keepTogether,
    balanceLoad: mode === "even" && balance,
    people: picked.map((userId) => (mode === "counts" ? { userId, count: Math.max(0, Number(counts[userId] || 0)) } : { userId })),
    dryRun,
  });

  // A dry run for the totals as soon as the dialog opens (nobody picked yet: use a placeholder-free count call).
  const [pool, setPool] = useState<number | null>(null);
  useEffect(() => {
    if (!open) return;
    setPool(null);
  }, [open, onlyUnassigned]);

  // Live preview, debounced.
  useEffect(() => {
    if (!open) return;
    if (timer.current) clearTimeout(timer.current);
    if (picked.length === 0) {
      setResult(null);
      setError(null);
      return;
    }
    timer.current = setTimeout(() => {
      preview.mutate(input(true), {
        onSuccess: (r) => {
          setResult(r);
          setPool(r.total);
          setError(null);
        },
        onError: (e) => {
          setResult(null);
          setError(e.messages.join(" · "));
        },
      });
    }, 300);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, picked, mode, counts, onlyUnassigned, keepTogether, balance, scopeInput]);

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const typed = picked.reduce((n, id) => n + Math.max(0, Number(counts[id] || 0)), 0);
  const total = result?.total ?? pool;

  /** Spread whatever isn't typed yet evenly over the people with no number. */
  const fillRest = () => {
    if (total == null) return;
    const empty = picked.filter((id) => !counts[id]);
    const targets = empty.length ? empty : picked;
    const base = empty.length ? total - typed : total;
    if (base <= 0 || targets.length === 0) return;
    const each = Math.floor(base / targets.length);
    let extra = base - each * targets.length;
    const next = { ...counts };
    for (const id of targets) {
      next[id] = String(each + (extra > 0 ? 1 : 0));
      extra -= 1;
    }
    setCounts(next);
  };

  const doApply = () =>
    apply.mutate(input(false), {
      onSuccess: (r) => {
        toast({ variant: "success", title: `Assigned ${r.assigned}`, description: r.leftOver ? `${r.leftOver} left without an owner.` : undefined });
        onClose();
      },
      onError: (e) => toast({ variant: "error", title: "Couldn't assign", description: e.messages.join(" · ") }),
    });

  const person = (p: { id: string; name: string }) => {
    const on = picked.includes(p.id);
    const row = result?.people.find((x) => x.user.id === p.id);
    return (
      <li key={p.id} className={cn("flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2", on ? "border-primary" : "border-border")}>
        <label className="flex min-w-0 flex-1 items-center gap-2 text-table text-foreground">
          <input type="checkbox" className="size-4" checked={on} onChange={() => toggle(p.id)} data-testid={`assign-person-${p.id}`} />
          <span className="truncate">{p.name}</span>
          {row && row.existing > 0 ? <span className="text-xs text-muted-foreground">has {row.existing}</span> : null}
        </label>
        {on && mode === "counts" ? (
          <Input
            type="number"
            min={0}
            inputMode="numeric"
            value={counts[p.id] ?? ""}
            onChange={(e) => setCounts({ ...counts, [p.id]: e.target.value })}
            className="w-20"
            aria-label={`How many for ${p.name}`}
            placeholder="0"
          />
        ) : null}
        {on && mode === "even" ? (
          <span className="w-20 text-right text-table font-medium tabular text-foreground">{row ? row.count : "…"}</span>
        ) : null}
      </li>
    );
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Assign ${scope.label}`}
      size="xl"
      footerBordered
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={doApply}
            loading={apply.isPending}
            disabled={!result || result.assigned === 0 || preview.isPending || !!error}
            data-testid="assign-apply"
          >
            {result?.assigned ? `Assign ${result.assigned}` : "Assign"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4" data-testid="assign-dialog">
        <p className="text-table text-muted-foreground">
          {total == null ? "Pick who gets them." : `${total} to hand out${result?.skippedAlreadyOwned ? ` · ${result.skippedAlreadyOwned} already have an owner and stay as they are` : ""}.`}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <div role="radiogroup" aria-label="How to split" className="inline-flex rounded-sm border border-border p-0.5">
            {(["even", "counts"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                onClick={() => setMode(m)}
                className={cn("h-7 rounded-[3px] px-3 text-xs font-medium", mode === m ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-accent")}
              >
                {m === "even" ? "Split evenly" : "Set numbers"}
              </button>
            ))}
          </div>
          {mode === "counts" ? (
            <Button variant="outline" size="sm" onClick={fillRest} disabled={!picked.length || total == null}>
              <Shuffle className="size-3.5" /> Fill the rest evenly
            </Button>
          ) : (
            <label className="flex items-center gap-2 text-xs text-foreground">
              <input type="checkbox" className="size-4" checked={balance} onChange={(e) => setBalance(e.target.checked)} />
              Even out with what they already own
            </label>
          )}
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold text-foreground">Sales team</p>
          {peoplePending ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <ul className="flex flex-col gap-1.5">{sales.map(person)}</ul>
          )}
          {others.length ? (
            <div className="mt-2">
              <button type="button" className="text-xs font-medium text-muted-foreground underline underline-offset-4" onClick={() => setShowOthers((v) => !v)}>
                {showOthers ? "Hide everyone else" : `Show everyone else (${others.length})`}
              </button>
              {showOthers ? <ul className="mt-2 flex flex-col gap-1.5">{others.map(person)}</ul> : null}
            </div>
          ) : null}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Keep together" hint="Where the numbers allow">
            <Select value={keepTogether} onChange={(e) => setKeepTogether(e.target.value as "state" | "city" | "none")} aria-label="Keep together">
              <option value="state">Same state with one person</option>
              <option value="city">Same city with one person</option>
              <option value="none">Don&apos;t group</option>
            </Select>
          </Field>
          <Field label="Which ones">
            <label className="flex h-8 items-center gap-2 text-sm text-foreground">
              <input type="checkbox" className="size-4" checked={onlyUnassigned} onChange={(e) => setOnlyUnassigned(e.target.checked)} />
              Only those without an owner
            </label>
          </Field>
        </div>

        {mode === "counts" && picked.length > 0 && total != null ? (
          <p className={cn("text-table", typed > total ? "text-text-destructive" : "text-muted-foreground")} data-testid="assign-tally">
            {typed} of {total} given out{typed < total ? ` · ${total - typed} stay unassigned` : typed > total ? ` · ${typed - total} too many` : ""}
          </p>
        ) : null}

        {error ? <p className="text-table text-text-destructive">{error}</p> : null}

        {result && result.people.some((p) => p.count > 0) ? (
          <div className="rounded-lg border border-border" data-testid="assign-preview">
            <p className="border-b border-border px-3 py-2 text-xs font-semibold text-foreground">
              <Users className="mr-1 inline size-3.5" aria-hidden /> Preview
            </p>
            <ul className="divide-y divide-border">
              {result.people.map((p) => (
                <li key={p.user.id} className="flex flex-col gap-0.5 px-3 py-2">
                  <span className="text-table text-foreground">
                    <span className="font-medium">{p.user.name}</span> gets <span className="tabular">{p.count}</span>
                    {p.existing ? <span className="text-muted-foreground"> · will have {p.existing + p.count}</span> : null}
                  </span>
                  {p.groups.length ? <span className="text-xs text-muted-foreground">{p.groups.join(" · ")}</span> : null}
                </li>
              ))}
            </ul>
            {result.leftOver ? (
              <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">{result.leftOver} stay without an owner.</p>
            ) : null}
          </div>
        ) : null}

      </div>
    </Dialog>
  );
}
