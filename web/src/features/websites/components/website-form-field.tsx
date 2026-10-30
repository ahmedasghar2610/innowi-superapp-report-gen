"use client";

import { useId, useRef, useState } from "react";
import { ImageIcon, Loader2, Upload, X } from "lucide-react";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { isApiError } from "@/lib/api/client";
import { cn } from "@/lib/utils/cn";
import type { WebsiteField } from "../types";
import { imagePreviewUrl, isUploadedImage, websitesApi } from "../api/client";
import { VALIDATE } from "../lib/website-values";
import { ChipsControl, EmojiControl, FontControl, SuggestControl } from "./picker-controls";

/** Mirrors the API's cap on POST /websites/assets on the hosted app (Vercel: 4 MB). */
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

interface WebsiteFormFieldProps {
  field: WebsiteField;
  /** Absolute dotted path — also the id used for error lookup. */
  path: string;
  value: string;
  error?: string;
  onChange: (path: string, value: string) => void;
  /** Surfaced for oversized uploads. */
  onNotice?: (message: string) => void;
  /** Governed by the linked merchant's Profile: read-only here. */
  locked?: boolean;
  /** Set when the visual editor changed this field on the website only: the Profile's value. */
  profileValue?: string;
}

function lockedHint(profileValue: string | undefined): string {
  return profileValue !== undefined
    ? `Changed on this website only in the visual editor. Profile: "${profileValue}" — editing the Profile replaces it.`
    : "From the merchant Profile — change it there. To change it on this website only, use the visual editor.";
}

/**
 * Renders one answer control from the schema. Every type maps onto a shared UI
 * primitive so the form inherits the design system's borders, focus ring,
 * invalid state and dark mode without restating any of it.
 */
export function WebsiteFormField({ field, path, value, error, onChange, onNotice, locked, profileValue }: WebsiteFormFieldProps) {
  const id = useId();
  const invalid = Boolean(error);

  return (
    <Field
      label={field.label}
      htmlFor={id}
      required={field.required && VALIDATE}
      hint={locked ? lockedHint(profileValue) : field.hint}
      error={error}
      className={field.fullWidth ? "sm:col-span-2" : undefined}
    >
      {locked ? (
        field.type === "textarea" ? (
          <Textarea id={id} value={value} rows={3} readOnly aria-readonly className="cursor-not-allowed bg-muted text-muted-foreground" />
        ) : (
          <Input id={id} value={value} readOnly aria-readonly className="cursor-not-allowed bg-muted text-muted-foreground" />
        )
      ) : field.type === "textarea" ? (
        <Textarea
          id={id}
          value={value}
          rows={3}
          placeholder={field.placeholder}
          aria-invalid={invalid || undefined}
          onChange={(e) => onChange(path, e.target.value)}
        />
      ) : field.type === "select" ? (
        <Select
          id={id}
          value={value}
          aria-invalid={invalid || undefined}
          onChange={(e) => onChange(path, e.target.value)}
        >
          {(field.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </Select>
      ) : field.type === "font" ? (
        <FontControl id={id} value={value} invalid={invalid} placeholder={field.placeholder} onChange={(v) => onChange(path, v)} />
      ) : field.type === "emoji" ? (
        <EmojiControl id={id} value={value} invalid={invalid} onChange={(v) => onChange(path, v)} />
      ) : field.type === "chips" ? (
        <ChipsControl id={id} value={value} presets={field.options ?? []} invalid={invalid} onChange={(v) => onChange(path, v)} />
      ) : field.type === "suggest" ? (
        <SuggestControl
          id={id}
          value={value}
          invalid={invalid}
          placeholder={field.placeholder}
          suggestions={field.options ?? []}
          onChange={(v) => onChange(path, v)}
        />
      ) : field.type === "color" ? (
        <ColorControl id={id} value={value} invalid={invalid} onChange={(v) => onChange(path, v)} />
      ) : field.type === "image" ? (
        <ImageControl
          id={id}
          value={value}
          invalid={invalid}
          placeholder={field.placeholder}
          onChange={(v) => onChange(path, v)}
          onNotice={onNotice}
        />
      ) : (
        <Input
          id={id}
          type={field.type === "email" ? "email" : field.type === "tel" ? "tel" : "text"}
          value={value}
          placeholder={field.placeholder}
          aria-invalid={invalid || undefined}
          onChange={(e) => onChange(path, e.target.value)}
        />
      )}
    </Field>
  );
}

/* ------------------------------------------------------------------ colour */

/** Native swatch + hex box, kept in sync. */
function ColorControl({
  id,
  value,
  invalid,
  onChange,
}: {
  id: string;
  value: string;
  invalid: boolean;
  onChange: (value: string) => void;
}) {
  const safe = /^#[0-9a-f]{6}$/i.test(value) ? value : "#000000";

  return (
    <div className="flex items-center gap-2">
      <label
        className="relative size-8 shrink-0 cursor-pointer overflow-hidden rounded-md border border-border"
        style={{ background: safe }}
      >
        <span className="sr-only">Pick a colour</span>
        <input
          type="color"
          value={safe}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="absolute inset-0 cursor-pointer opacity-0"
        />
      </label>
      <Input
        id={id}
        value={value}
        placeholder="#000000"
        spellCheck={false}
        aria-invalid={invalid || undefined}
        onChange={(e) => onChange(e.target.value)}
        className="font-mono uppercase"
      />
    </div>
  );
}

/* ------------------------------------------------------------------- image */

/**
 * Paste a link or upload a file, with a thumbnail. Uploads go to the API's file
 * storage (POST /websites/assets) and the field keeps the returned URL — images
 * are no longer inlined into the record as data URLs (old ones still display).
 */
export function ImageControl({
  id,
  value,
  invalid,
  placeholder,
  onChange,
  onNotice,
}: {
  id: string;
  value: string;
  invalid: boolean;
  placeholder?: string;
  onChange: (value: string) => void;
  onNotice?: (message: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const uploaded = isUploadedImage(value);
  // `/images/…` lives on the site template, not here — see imagePreviewUrl.
  const preview = imagePreviewUrl(value);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_IMAGE_BYTES) {
      onNotice?.("That image is over 4 MB — try a smaller one.");
      return;
    }
    setUploading(true);
    try {
      const asset = await websitesApi.uploadImage(file);
      onChange(asset.url);
    } catch (err) {
      onNotice?.(isApiError(err) ? err.messages.join(" · ") : "The image couldn't be uploaded.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <span
        aria-hidden
        className={cn(
          "grid size-8 shrink-0 place-items-center overflow-hidden rounded-md border border-border bg-muted bg-cover bg-center text-muted-foreground",
        )}
        style={preview ? { backgroundImage: `url(${JSON.stringify(preview)})` } : undefined}
      >
        {!value && <ImageIcon className="size-4" />}
      </span>

      {uploaded ? (
        <div className="flex h-8 flex-1 items-center justify-between gap-2 rounded-md border border-border bg-muted px-2.5 text-table text-muted-foreground">
          <span className="truncate">{value.startsWith("data:") ? "Uploaded file" : "Uploaded image"}</span>
          <button
            type="button"
            onClick={() => onChange("")}
            aria-label="Remove image"
            className="grid size-5 shrink-0 place-items-center rounded-sm hover:bg-secondary hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
      ) : (
        <Input
          id={id}
          type="url"
          value={value}
          placeholder={placeholder ?? "https://… or upload →"}
          aria-invalid={invalid || undefined}
          onChange={(e) => onChange(e.target.value)}
        />
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          void handleFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <Button
        variant="outline"
        size="default"
        disabled={uploading}
        onClick={() => fileRef.current?.click()}
        className="shrink-0"
      >
        {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
        {uploading ? "Uploading…" : "Upload"}
      </Button>
    </div>
  );
}
