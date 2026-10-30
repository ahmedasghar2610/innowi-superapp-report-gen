"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Dialog, Field, Input, Select, useToast } from "@/components/ui";
import { MerchantSelect, type MerchantValue } from "@/features/tickets/components/merchant-select";
import { useCreateLibraryPage } from "../api";
import { SECTION_LABEL, SECTION_ORDER, type LibraryPageSummary, type LibrarySection } from "../types";

/** New Library page: title, section, optional parent (one level), merchant for merchant pages. */
export function NewPageDialog({
  open,
  onClose,
  pages,
  defaultMerchant,
}: {
  open: boolean;
  onClose: () => void;
  pages: LibraryPageSummary[];
  defaultMerchant?: MerchantValue | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const create = useCreateLibraryPage();
  const [title, setTitle] = useState("");
  const [section, setSection] = useState<LibrarySection>("COMPANY");
  const [parentId, setParentId] = useState("");
  const [merchant, setMerchant] = useState<MerchantValue | null>(null);
  const [error, setError] = useState<string | null>(null);

  const defaultMerchantId = defaultMerchant?.id;
  useEffect(() => {
    if (!open) return;
    setTitle(defaultMerchant ? "Brand guidelines" : "");
    setSection(defaultMerchant ? "MERCHANT" : "COMPANY");
    setParentId("");
    setMerchant(defaultMerchant ?? null);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultMerchantId]);

  const parents = pages.filter((p) => p.section === section && !p.parentId);

  const submit = () => {
    setError(null);
    if (!title.trim()) return setError("Give the page a title");
    if (section === "MERCHANT" && !merchant) return setError("Choose the merchant this page is about");
    create.mutate(
      {
        title: title.trim(),
        section,
        parentId: parentId || null,
        merchantId: section === "MERCHANT" ? merchant?.id : null,
        body: "",
      },
      {
        onSuccess: (page) => {
          toast({ variant: "success", title: "Page created" });
          onClose();
          router.push(`/ops/library/${page.id}?edit=1`);
        },
        onError: (e) => setError(e.messages?.join(" · ") ?? e.message),
      },
    );
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title="New Library page"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="default" onClick={submit} loading={create.isPending}>
            Create and edit
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error ? (
          <p role="alert" className="rounded-lg bg-destructive-subtle px-3 py-2 text-sm text-text-destructive">
            {error}
          </p>
        ) : null}
        <Field label="Title" htmlFor="lp-title" required>
          <Input id="lp-title" value={title} maxLength={200} autoFocus onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Section" htmlFor="lp-section" required>
            <Select
              id="lp-section"
              value={section}
              onChange={(e) => {
                setSection(e.target.value as LibrarySection);
                setParentId("");
              }}
            >
              {SECTION_ORDER.map((s) => (
                <option key={s} value={s}>
                  {SECTION_LABEL[s]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Inside" htmlFor="lp-parent" hint="Optional — nest under another page">
            <Select id="lp-parent" value={parentId} onChange={(e) => setParentId(e.target.value)}>
              <option value="">Top level</option>
              {parents.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.merchant ? `${p.merchant.name} · ${p.title}` : p.title}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {section === "MERCHANT" ? (
          <Field label="Merchant" htmlFor="lp-merchant" required>
            <MerchantSelect id="lp-merchant" value={merchant} onChange={setMerchant} placeholder="Search a merchant…" />
          </Field>
        ) : null}
      </div>
    </Dialog>
  );
}
