"use client";

import { useState } from "react";
import { Bookmark, Trash2 } from "lucide-react";
import { Button, Dialog, Field, Input, Select, useToast } from "@/components/ui";
import { useDeleteView, useSaveView, useSavedViews } from "../api";
import type { SavedView } from "../types";

export type ViewFilters = Record<string, string | boolean | number | undefined>;

function clean(f: ViewFilters): Record<string, string | boolean | number> {
  const out: Record<string, string | boolean | number> = {};
  for (const [k, v] of Object.entries(f)) if (v !== undefined && v !== "" && v !== false && v !== null) out[k] = v;
  return out;
}

function same(a: ViewFilters, b: ViewFilters) {
  const x = clean(a);
  const y = clean(b);
  const kx = Object.keys(x).sort();
  return kx.length === Object.keys(y).length && kx.every((k) => x[k] === y[k]);
}

/** Saved filter sets for the Tickets list ("My urgent", "Design overdue"…). Per person. */
export function SavedViews({ current, onApply }: { current: ViewFilters; onApply: (filters: SavedView["filters"]) => void }) {
  const { toast } = useToast();
  const views = useSavedViews();
  const save = useSaveView();
  const del = useDeleteView();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");

  const active = (views.data ?? []).find((v) => same(v.filters, current));

  const submit = () => {
    const n = name.trim();
    if (!n) return;
    save.mutate(
      { name: n, filters: clean(current) },
      {
        onSuccess: (v) => {
          toast({ variant: "success", title: `View “${v.name}” saved` });
          setNaming(false);
          setName("");
        },
        onError: (e) => toast({ variant: "error", title: "View not saved", description: e.message }),
      },
    );
  };

  return (
    <div className="flex items-center gap-1.5">
      <label htmlFor="saved-view" className="sr-only">
        Saved view
      </label>
      <Select
        id="saved-view"
        className="w-44"
        value={active?.id ?? ""}
        onChange={(e) => {
          const v = views.data?.find((x) => x.id === e.target.value);
          if (v) onApply(v.filters);
        }}
      >
        <option value="">{views.data?.length ? (active ? active.name : "Saved views…") : "No saved views"}</option>
        {(views.data ?? []).map((v) => (
          <option key={v.id} value={v.id}>
            {v.name}
          </option>
        ))}
      </Select>
      {active ? (
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Delete view ${active.name}`}
          onClick={() => del.mutate(active.id, { onSuccess: () => toast({ variant: "success", title: `View “${active.name}” deleted` }) })}
        >
          <Trash2 className="size-4" />
        </Button>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setNaming(true)}>
          <Bookmark className="size-4" />
          Save view
        </Button>
      )}
      <Dialog
        open={naming}
        onClose={() => setNaming(false)}
        title="Save this view"
        description="Keeps the current team tab and filters so you can come back to them in one click. Only you see your views."
        footer={
          <>
            <Button variant="outline" onClick={() => setNaming(false)}>
              Cancel
            </Button>
            <Button variant="default" onClick={submit} loading={save.isPending} disabled={!name.trim()}>
              Save view
            </Button>
          </>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Field label="Name" htmlFor="view-name">
            <Input id="view-name" autoFocus maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. My urgent" />
          </Field>
        </form>
      </Dialog>
    </div>
  );
}
