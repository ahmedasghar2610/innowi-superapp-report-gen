"use client";

import { useEffect, useMemo, useState } from "react";
import { Link2 } from "lucide-react";
import { Button, Dialog, Skeleton, useToast } from "@/components/ui";
import { useCan } from "@/features/auth/use-can";
import {
  useCreateMerchantFromWebsite,
  useLinkPreview,
  useLinkWebsite,
  useMerchantSuggestions,
} from "../api/websites.queries";
import type { ConflictResolution, MerchantChoice, Website } from "../types";
import { MerchantPicker } from "./merchant-picker";

interface WebsiteLinkMerchantDialogProps {
  website: Website | null;
  onClose: () => void;
  /** Called with the updated site after a successful link / create. */
  onLinked?: (website: Website) => void;
  /** Start with this merchant already chosen (workspace "Link existing site"). */
  preset?: MerchantChoice;
}

/**
 * "Link to merchant" for an existing (unassigned) website.
 *
 *   1. Pick the merchant — suggestions, search, or create one from the site.
 *   2. If the merchant Profile and the site disagree on a business field, choose
 *      which value the site shows, one field at a time. The Profile itself is
 *      never changed by linking — "This website" keeps the value on the site only.
 *   3. Link. From then on the Profile governs those fields (read-only in the
 *      form; the visual editor can still change them for the website only).
 */
export function WebsiteLinkMerchantDialog({ website, onClose, onLinked, preset }: WebsiteLinkMerchantDialogProps) {
  const { toast } = useToast();
  const can = useCan();
  const canCreateMerchant = can("merchant.create");
  const [choice, setChoice] = useState<MerchantChoice>({ mode: "none" });
  const [resolutions, setResolutions] = useState<Record<string, ConflictResolution>>({});

  useEffect(() => {
    if (website) {
      setChoice(preset ?? { mode: "none" });
      setResolutions({});
    }
  }, [website, preset]);

  const suggestions = useMerchantSuggestions(website?.id);
  const merchantId = choice.mode === "existing" ? choice.merchantId : undefined;
  const preview = useLinkPreview(website?.id, merchantId);
  const link = useLinkWebsite();
  const createMerchant = useCreateMerchantFromWebsite();
  const busy = link.isPending || createMerchant.isPending;

  const conflicts = useMemo(() => preview.data?.conflicts ?? [], [preview.data]);
  const unresolved = conflicts.filter((c) => !resolutions[c.field]).length;

  const fail = (title: string) => (err: { messages: string[] }) =>
    toast({ variant: "error", title, description: err.messages.join(" · ") });

  const submit = () => {
    if (!website) return;
    if (choice.mode === "new") {
      createMerchant.mutate(
        { id: website.id },
        {
          onSuccess: (updated) => {
            toast({ variant: "success", title: "Merchant created and linked", description: updated.merchantName ?? "" });
            onLinked?.(updated);
            onClose();
          },
          onError: fail("Couldn't create the merchant"),
        },
      );
      return;
    }
    if (choice.mode !== "existing") return;
    link.mutate(
      { id: website.id, input: { merchantId: choice.merchantId, resolutions } },
      {
        onSuccess: (updated) => {
          toast({ variant: "success", title: "Website linked", description: `${updated.name} → ${choice.merchantName}` });
          onLinked?.(updated);
          onClose();
        },
        onError: fail("Couldn't link the website"),
      },
    );
  };

  const canSubmit =
    (choice.mode === "new" && canCreateMerchant) ||
    (choice.mode === "existing" && preview.isSuccess && unresolved === 0);

  return (
    <Dialog
      open={Boolean(website)}
      onClose={onClose}
      size="lg"
      icon={<Link2 />}
      title={website ? `Link “${website.name}” to a merchant` : "Link to merchant"}
      description="Once linked, the merchant's Profile is the source of truth for the business name, phone, address and hours shown on the site."
      dismissible={!busy}
      footerBordered
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="default" onClick={submit} disabled={!canSubmit} loading={busy}>
            {choice.mode === "new" ? "Create merchant & link" : "Link website"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <MerchantPicker
          value={choice}
          onChange={(c) => {
            setChoice(c);
            setResolutions({});
          }}
          suggestions={suggestions.data ?? []}
          allowNew={canCreateMerchant}
          allowNone={false}
          disabled={busy}
        />

        {choice.mode === "existing" && (
          <div className="rounded-md border border-border p-3">
            {preview.isPending ? (
              <div className="flex flex-col gap-2">
                <Skeleton className="h-3.5 w-48" />
                <Skeleton className="h-3.5 w-64" />
              </div>
            ) : preview.isError ? (
              <p className="text-sm text-text-destructive">{preview.error.messages.join(" · ")}</p>
            ) : conflicts.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No conflicts — the site&apos;s business details match the Profile, or only one side has them.
                Empty fields on the site are filled from the Profile. The Profile itself is not changed.
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                <p className="text-sm text-foreground">
                  The Profile and the site disagree on {conflicts.length === 1 ? "one field" : `${conflicts.length} fields`}.
                  Choose which value the website shows. The merchant Profile is not changed either way.
                </p>
                {conflicts.map((c) => (
                  <fieldset key={c.field} className="flex flex-col gap-1.5">
                    <legend className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {c.label}
                    </legend>
                    {(
                      [
                        { side: "profile", label: "Merchant Profile", value: c.profileValue },
                        { side: "website", label: "This website only (Profile unchanged)", value: c.websiteValue },
                      ] as const
                    ).map((opt) => (
                      <label
                        key={opt.side}
                        className="flex cursor-pointer items-start gap-2 rounded-md border border-border px-3 py-2 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5"
                      >
                        <input
                          type="radio"
                          name={c.field}
                          className="mt-1"
                          checked={resolutions[c.field] === opt.side}
                          onChange={() => setResolutions((r) => ({ ...r, [c.field]: opt.side }))}
                        />
                        <span className="min-w-0">
                          <span className="block text-xs text-muted-foreground">{opt.label}</span>
                          <span className="block break-words text-foreground">{opt.value}</span>
                        </span>
                      </label>
                    ))}
                  </fieldset>
                ))}
              </div>
            )}
          </div>
        )}

        {choice.mode === "new" && (
          <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-table text-muted-foreground">
            A merchant named <strong>{website?.name}</strong> will be created with a primary location and an owner
            contact from the site&apos;s business details. Package, account manager and everything else stay empty
            and show in Data Quality until filled in.
          </p>
        )}
      </div>
    </Dialog>
  );
}
