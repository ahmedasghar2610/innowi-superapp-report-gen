"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CircleAlert, CircleCheck, FolderUp, ImagePlus, Loader2, Palette, X } from "lucide-react";
import { Button, Select, useToast } from "@/components/ui";
import { isApiError } from "@/lib/api/client";
import { cn } from "@/lib/utils/cn";
import { websitesApi } from "../api/client";
import {
  BRAND_KEYS,
  buildSlots,
  isImageFile,
  matchFiles,
  MAX_IMAGE_BYTES,
  parseBrand,
  parseManifest,
  type BrandValues,
  type Match,
  type SlotKey,
} from "../lib/bulk-images";

interface Row {
  file: File;
  preview: string;
  slot: SlotKey | "";
  alt?: string;
  note?: string;
  status: "ready" | "uploading" | "done" | "error";
  error?: string;
}

const PROBLEM: Record<NonNullable<Match["problem"]>, string> = {
  "unknown-name": "Name not recognised — pick a slot",
  "no-such-slot": "This site has no such slot — pick one or skip",
  duplicate: "Another file already takes this slot",
  "too-large": "Larger than 4 MB — not uploaded",
};

const BRAND_LABEL: Record<(typeof BRAND_KEYS)[number], string> = {
  primary: "Primary",
  secondary: "Secondary",
  accent: "Accent",
  textColor: "Text",
  headingFont: "Heading font",
  bodyFont: "Body font",
};

interface WebsiteBulkImagesProps {
  dishNames: string[];
  pointTitles: string[];
  /** Current answer at a path (alt text is only filled when empty). */
  current: (path: string) => string;
  /** Write answers: [path, value] pairs. */
  onApply: (changes: [string, string][]) => void;
  disabled?: boolean;
}

/**
 * "Upload all images" (the .docx import's Images step): pick the whole images
 * folder produced by the Website Images workflow — or any files named
 * logo / hero / about / dish-01… / point-01… — and every image lands in its
 * slot. manifest.json (if included) decides the slot exactly; brand.json fills
 * the four colours and two fonts. Every match can be changed before placing.
 */
export function WebsiteBulkImages({ dishNames, pointTitles, current, onApply, disabled }: WebsiteBulkImagesProps) {
  const { toast } = useToast();
  const filesRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [brand, setBrand] = useState<BrandValues>({});
  const [applyBrand, setApplyBrand] = useState(true);
  const [busy, setBusy] = useState(false);

  const slots = useMemo(() => buildSlots(dishNames, pointTitles), [dishNames, pointTitles]);
  const slotByKey = useMemo(() => new Map(slots.map((s) => [s.key, s])), [slots]);

  // Thumbnails are object URLs — released when the list is replaced, cleared or closed.
  const previews = useRef<string[]>([]);
  const releasePreviews = () => {
    previews.current.forEach((u) => URL.revokeObjectURL(u));
    previews.current = [];
  };
  useEffect(() => {
    const p = previews;
    return () => p.current.forEach((u) => URL.revokeObjectURL(u));
  }, []);

  const reset = () => {
    releasePreviews();
    setRows([]);
    setBrand({});
    setApplyBrand(true);
  };

  const readJson = async (file: File | undefined): Promise<unknown> => {
    if (!file) return null;
    try {
      return JSON.parse(await file.text());
    } catch {
      toast({ variant: "warning", title: `${file.name} isn't valid JSON — ignored` });
      return null;
    }
  };

  const choose = async (list: FileList | null) => {
    if (!list?.length) return;
    const all = Array.from(list);
    // Inside a picked folder, only its images/ subfolder (if there is one) holds slot images.
    const inImagesDir = (f: File) => /(^|\/)images\//.test(f.webkitRelativePath || "");
    const hasImagesDir = all.some(inImagesDir);
    const images = all.filter((f) => isImageFile(f.name) && (!hasImagesDir || inImagesDir(f)));
    const manifest = parseManifest(await readJson(all.find((f) => f.name.toLowerCase() === "manifest.json")));
    const brandValues = parseBrand(await readJson(all.find((f) => f.name.toLowerCase() === "brand.json")));

    if (!images.length && !Object.keys(brandValues).length) {
      toast({ variant: "warning", title: "No images found", description: "Choose image files (.jpg, .png, .webp) or the images folder." });
      return;
    }
    const matches = matchFiles(images.map((f) => ({ name: f.name, size: f.size })), slots, manifest, dishNames, pointTitles);
    releasePreviews();
    const next: Row[] = matches.map((m) => ({
      file: images[m.index],
      preview: URL.createObjectURL(images[m.index]),
      slot: m.slot ?? "",
      alt: m.alt,
      note: m.problem ? PROBLEM[m.problem] : undefined,
      status: "ready",
    }));
    previews.current = next.map((r) => r.preview);
    setRows(next);
    setBrand(brandValues);
    setApplyBrand(true);
  };

  const setSlot = (i: number, slot: SlotKey | "") =>
    setRows((rs) =>
      rs.map((r, j) => {
        if (j === i) return { ...r, slot, note: undefined };
        // Taking a slot frees it from whichever row had it.
        return slot && r.slot === slot ? { ...r, slot: "", note: "Moved to another file — pick a slot" } : r;
      }),
    );

  const placeable = rows.filter((r) => r.slot && r.status !== "done" && r.file.size <= MAX_IMAGE_BYTES);
  const brandCount = Object.keys(brand).length;

  const place = async () => {
    setBusy(true);
    const changes: [string, string][] = [];
    let ok = 0;
    let failed = 0;
    const next = [...rows];
    // A few at a time: fast, without flooding the API.
    const queue = rows.map((r, i) => ({ r, i })).filter(({ r }) => r.slot && r.status !== "done" && r.file.size <= MAX_IMAGE_BYTES);
    const worker = async () => {
      for (let item = queue.shift(); item; item = queue.shift()) {
        const { r, i } = item;
        next[i] = { ...r, status: "uploading" };
        setRows([...next]);
        try {
          const asset = await websitesApi.uploadImage(r.file);
          const slot = slotByKey.get(r.slot as SlotKey);
          if (slot) {
            changes.push([slot.path, asset.url]);
            if (slot.altPath && r.alt && !current(slot.altPath).trim()) changes.push([slot.altPath, r.alt]);
          }
          next[i] = { ...r, status: "done" };
          ok++;
        } catch (err) {
          next[i] = { ...r, status: "error", error: isApiError(err) ? err.messages.join(" · ") : "Upload failed" };
          failed++;
        }
        setRows([...next]);
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    if (applyBrand) for (const k of BRAND_KEYS) if (brand[k]) changes.push([`brand.${k}`, brand[k] as string]);
    onApply(changes);
    setBusy(false);
    toast({
      variant: failed ? "warning" : "success",
      title: `${ok} image${ok === 1 ? "" : "s"} placed${applyBrand && brandCount ? " · colours and fonts applied" : ""}`,
      description: failed ? `${failed} failed — see the list.` : undefined,
    });
    if (!failed) reset();
  };

  return (
    <section className="rounded-lg border border-dashed border-primary/40 bg-primary/5 p-3 sm:col-span-2">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-semibold text-foreground">Upload all images</h4>
          <p className="mt-0.5 text-table text-muted-foreground">
            Pick the client&apos;s folder from <em>Website Images › output</em> (or its <em>images</em> folder). Files named{" "}
            <code>logo</code>, <code>hero</code>, <code>about</code>, <code>dish-01…</code>, <code>point-01…</code> go to their
            slot; <code>manifest.json</code> and <code>brand.json</code> are read too.
          </p>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <Button variant="outline" size="sm" onClick={() => folderRef.current?.click()} disabled={disabled || busy}>
            <FolderUp className="size-4" />
            Choose folder
          </Button>
          <Button variant="outline" size="sm" onClick={() => filesRef.current?.click()} disabled={disabled || busy}>
            <ImagePlus className="size-4" />
            Choose files
          </Button>
        </div>
        <input
          ref={filesRef}
          type="file"
          multiple
          accept="image/*,.json,application/json"
          hidden
          onChange={(e) => {
            void choose(e.target.files);
            e.target.value = "";
          }}
        />
        <input
          ref={folderRef}
          type="file"
          multiple
          hidden
          {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
          onChange={(e) => {
            void choose(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {(rows.length > 0 || brandCount > 0) && (
        <div className="mt-3 flex flex-col gap-2">
          {brandCount > 0 && (
            <label className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm">
              <input type="checkbox" checked={applyBrand} onChange={(e) => setApplyBrand(e.target.checked)} disabled={busy} />
              <Palette className="size-4 text-muted-foreground" aria-hidden />
              <span className="font-medium text-foreground">Colours and fonts from brand.json</span>
              <span className="flex flex-wrap items-center gap-1.5">
                {BRAND_KEYS.map((k) =>
                  brand[k] ? (
                    <span key={k} className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground" title={BRAND_LABEL[k]}>
                      {k.endsWith("Font") ? null : <span className="size-3 rounded-full border border-border" style={{ background: brand[k] }} />}
                      {brand[k]}
                    </span>
                  ) : null,
                )}
              </span>
            </label>
          )}

          {rows.length > 0 && (
            <ul className="flex max-h-80 flex-col divide-y divide-border overflow-y-auto rounded-md border border-border bg-card">
              {rows.map((r, i) => (
                <li key={`${r.file.name}-${i}`} className="flex items-center gap-3 px-3 py-2">
                  {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview */}
                  <img src={r.preview} alt="" className="size-10 shrink-0 rounded border border-border bg-muted object-cover" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground" title={r.file.name}>
                      {r.file.name}
                    </p>
                    {r.status === "error" ? (
                      <p className="truncate text-xs text-text-destructive">{r.error}</p>
                    ) : r.note ? (
                      <p className="truncate text-xs text-amber-700 dark:text-amber-400">{r.note}</p>
                    ) : r.alt ? (
                      <p className="truncate text-xs text-muted-foreground">Alt: {r.alt}</p>
                    ) : null}
                  </div>
                  <Select
                    aria-label={`Slot for ${r.file.name}`}
                    value={r.slot}
                    onChange={(e) => setSlot(i, e.target.value)}
                    disabled={busy || r.status === "done"}
                    className="w-56 shrink-0"
                  >
                    <option value="">Skip this file</option>
                    {slots.map((s) => (
                      <option key={s.key} value={s.key}>
                        {s.label}
                      </option>
                    ))}
                  </Select>
                  <span className="w-5 shrink-0" aria-live="polite">
                    {r.status === "uploading" ? (
                      <Loader2 className="size-4 animate-spin text-primary" aria-label="Uploading" />
                    ) : r.status === "done" ? (
                      <CircleCheck className="size-4 text-primary" aria-label="Placed" />
                    ) : r.status === "error" || r.note ? (
                      <CircleAlert className={cn("size-4", r.status === "error" ? "text-text-destructive" : "text-amber-600")} aria-hidden />
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => void place()} loading={busy} disabled={disabled || (!placeable.length && !(applyBrand && brandCount))}>
              Place {placeable.length} image{placeable.length === 1 ? "" : "s"}
              {applyBrand && brandCount ? " + brand" : ""}
            </Button>
            <Button variant="ghost" size="sm" onClick={reset} disabled={busy}>
              <X className="size-4" />
              Clear
            </Button>
            <span className="text-xs text-muted-foreground">
              {rows.filter((r) => !r.slot).length > 0 && `${rows.filter((r) => !r.slot).length} not placed · `}
              Existing images in those slots are replaced.
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
