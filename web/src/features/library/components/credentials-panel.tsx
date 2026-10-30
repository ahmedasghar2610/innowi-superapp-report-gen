"use client";

import { useEffect, useMemo, useState } from "react";
import { Copy, ExternalLink, Eye, KeyRound, Pencil, Plus, ShieldAlert, Trash2 } from "lucide-react";
import { Badge, Button, Card, CardBody, Dialog, Field, Input, Skeleton, Textarea, useToast } from "@/components/ui";
import { MerchantSelect, type MerchantValue } from "@/features/tickets/components/merchant-select";
import { formatDateTime } from "@/lib/format";
import { useCredentialLog, useCredentials, useDeleteCredential, useRevealCredential, useSaveCredential } from "../api";
import type { Credential } from "../types";

/**
 * Logins the team holds. Everyone sees which exist; revealing a secret needs
 * `credentials.reveal` (managers, or granted per person), asks why, and is
 * logged. Adding / changing / deleting needs `credentials.manage`.
 * `merchantId` narrows to one merchant ("none" = Innowi's own logins).
 */
export function CredentialsPanel({
  merchantId,
  title = "Credentials",
  compact,
}: {
  merchantId?: string;
  title?: string;
  compact?: boolean;
}) {
  const { data, isPending } = useCredentials(merchantId);
  const [editing, setEditing] = useState<Credential | "new" | null>(null);
  const [revealing, setRevealing] = useState<Credential | null>(null);
  const [deleting, setDeleting] = useState<Credential | null>(null);
  const del = useDeleteCredential();
  const { toast } = useToast();

  const groups = useMemo(() => {
    const m = new Map<string, { name: string; rows: Credential[] }>();
    for (const c of data?.data ?? []) {
      const k = c.merchant?.id ?? "innowi";
      if (!m.has(k)) m.set(k, { name: c.merchant?.name ?? "Innowi (internal)", rows: [] });
      m.get(k)!.rows.push(c);
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [data]);

  return (
    <Card>
      <CardBody className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <KeyRound className="size-4 text-muted-foreground" aria-hidden />
            {title}
          </h3>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Encrypted · every reveal is logged</span>
            {data?.canManage && data.configured ? (
              <Button variant="outline" size="sm" onClick={() => setEditing("new")}>
                <Plus className="size-4" />
                Add login
              </Button>
            ) : null}
          </div>
        </div>

        {data && !data.configured ? (
          <p className="flex items-start gap-2 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning-text">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            The vault isn&apos;t switched on yet: the API server needs a CREDENTIAL_ENCRYPTION_KEY before logins can be stored.
          </p>
        ) : null}

        {isPending ? (
          <Skeleton className="h-10 w-full" />
        ) : !data?.data.length ? (
          <p className="text-sm text-muted-foreground">No logins stored{merchantId ? " for this merchant" : ""}.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {groups.map((g) => (
              <div key={g.name} className="flex flex-col gap-1.5">
                {!merchantId ? <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{g.name}</p> : null}
                {g.rows.map((c) => (
                  <div key={c.id} className="flex flex-wrap items-center gap-3 rounded-lg bg-muted px-3 py-2 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-foreground">{c.label}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {c.username ? `${c.username} · ` : ""}
                        {c.url ? (
                          <a href={c.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-primary hover:underline">
                            {c.url.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                            <ExternalLink className="size-3" aria-hidden />
                          </a>
                        ) : null}
                        {!compact && c.notes ? ` · ${c.notes}` : ""}
                      </p>
                    </div>
                    <code className="tracking-[0.2em] text-muted-foreground" aria-hidden>
                      ••••••••
                    </code>
                    {data.canReveal ? (
                      <Button variant="outline" size="sm" onClick={() => setRevealing(c)} disabled={!data.configured}>
                        <Eye className="size-4" />
                        Reveal
                      </Button>
                    ) : (
                      <Badge tone="neutral" icon={false} title="Ask a manager to share it, or to grant you vault access">
                        Ask a manager
                      </Badge>
                    )}
                    {data.canManage ? (
                      <>
                        <Button variant="ghost" size="icon-sm" onClick={() => setEditing(c)} aria-label={`Edit ${c.label}`}>
                          <Pencil className="size-4" />
                        </Button>
                        <Button variant="ghost" size="icon-sm" onClick={() => setDeleting(c)} aria-label={`Delete ${c.label}`}>
                          <Trash2 className="size-4" />
                        </Button>
                      </>
                    ) : null}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </CardBody>

      <CredentialDialog
        open={editing !== null}
        credential={editing === "new" ? null : editing}
        defaultMerchantId={merchantId && merchantId !== "none" ? merchantId : undefined}
        onClose={() => setEditing(null)}
      />
      <RevealDialog credential={revealing} onClose={() => setRevealing(null)} />
      <Dialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        tone="danger"
        icon={<Trash2 className="size-5" />}
        title={`Delete “${deleting?.label ?? ""}”?`}
        description="The stored secret is destroyed. The access log keeps a record that it existed."
        footer={
          <>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              loading={del.isPending}
              onClick={() =>
                deleting &&
                del.mutate(deleting.id, {
                  onSuccess: () => {
                    toast({ variant: "success", title: "Login deleted" });
                    setDeleting(null);
                  },
                  onError: (e) => toast({ variant: "error", title: "Not deleted", description: e.message }),
                })
              }
            >
              Delete
            </Button>
          </>
        }
      />
    </Card>
  );
}

function RevealDialog({ credential, onClose }: { credential: Credential | null; onClose: () => void }) {
  const reveal = useRevealCredential();
  const { toast } = useToast();
  const [reason, setReason] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const [left, setLeft] = useState(30);

  useEffect(() => {
    setReason("");
    setSecret(null);
    reveal.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [credential?.id]);

  // Hide the secret again after 30 seconds.
  useEffect(() => {
    if (!secret) return;
    setLeft(30);
    const t = setInterval(() => setLeft((s) => s - 1), 1000);
    return () => clearInterval(t);
  }, [secret]);
  useEffect(() => {
    if (secret && left <= 0) setSecret(null);
  }, [left, secret]);

  const close = () => {
    setSecret(null);
    onClose();
  };

  return (
    <Dialog
      open={credential !== null}
      onClose={close}
      size="md"
      title={credential ? `Reveal ${credential.label}` : ""}
      description="Your name, the time and your reason are recorded in the vault's access log."
      footer={
        secret ? (
          <Button variant="outline" onClick={close}>
            Done
          </Button>
        ) : (
          <>
            <Button variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button
              variant="default"
              loading={reveal.isPending}
              disabled={reason.trim().length < 3}
              onClick={() =>
                credential &&
                reveal.mutate({ id: credential.id, reason: reason.trim() }, { onSuccess: (r) => setSecret(r.secret) })
              }
            >
              Reveal
            </Button>
          </>
        )
      }
    >
      {secret ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-muted px-3 py-2">
            <code className="min-w-0 flex-1 break-all font-mono text-sm text-foreground">{secret}</code>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Copy"
              onClick={() =>
                navigator.clipboard?.writeText(secret).then(
                  () => toast({ variant: "success", title: "Copied" }),
                  () => toast({ variant: "error", title: "Couldn't copy" }),
                )
              }
            >
              <Copy className="size-4" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Hidden again in {left}s.</p>
        </div>
      ) : (
        <Field
          label="Why do you need it?"
          htmlFor="reveal-reason"
          required
          hint="e.g. “OPS-1042 · posting the new logo”"
          error={reveal.error ? (reveal.error.messages?.join(" · ") ?? reveal.error.message) : undefined}
        >
          <Input id="reveal-reason" value={reason} maxLength={300} autoFocus onChange={(e) => setReason(e.target.value)} />
        </Field>
      )}
    </Dialog>
  );
}

function CredentialDialog({
  open,
  credential,
  defaultMerchantId,
  onClose,
}: {
  open: boolean;
  credential: Credential | null;
  defaultMerchantId?: string;
  onClose: () => void;
}) {
  const save = useSaveCredential();
  const { toast } = useToast();
  const [label, setLabel] = useState("");
  const [username, setUsername] = useState("");
  const [url, setUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [secret, setSecret] = useState("");
  const [merchant, setMerchant] = useState<MerchantValue | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLabel(credential?.label ?? "");
    setUsername(credential?.username ?? "");
    setUrl(credential?.url ?? "");
    setNotes(credential?.notes ?? "");
    setSecret("");
    setMerchant(credential?.merchant ?? null);
    setError(null);
  }, [open, credential]);

  const submit = () => {
    setError(null);
    if (!label.trim()) return setError("Give the login a name, e.g. “Instagram · @cha2cha”");
    if (!credential && !secret) return setError("Enter the password or key to store");
    save.mutate(
      {
        id: credential?.id,
        input: {
          label: label.trim(),
          username: username.trim() || null,
          url: url.trim() || null,
          notes: notes.trim() || null,
          ...(secret ? { secret } : {}),
          ...(credential ? {} : { merchantId: merchant?.id ?? defaultMerchantId ?? null }),
        },
      },
      {
        onSuccess: () => {
          toast({ variant: "success", title: credential ? "Login updated" : "Login stored" });
          onClose();
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
      title={credential ? `Edit ${credential.label}` : "Add a login"}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="default" onClick={submit} loading={save.isPending}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {error ? (
          <p role="alert" className="rounded-lg bg-destructive-subtle px-3 py-2 text-sm text-text-destructive sm:col-span-2">
            {error}
          </p>
        ) : null}
        <Field label="Name" htmlFor="cr-label" required className="sm:col-span-2">
          <Input id="cr-label" value={label} maxLength={120} onChange={(e) => setLabel(e.target.value)} placeholder="Instagram · @cha2cha" />
        </Field>
        <Field label="Username or email" htmlFor="cr-user">
          <Input id="cr-user" value={username} maxLength={200} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
        </Field>
        <Field
          label={credential ? "New password or key" : "Password or key"}
          htmlFor="cr-secret"
          required={!credential}
          hint={credential ? "Leave empty to keep the current one" : undefined}
        >
          <Input id="cr-secret" type="password" value={secret} maxLength={2000} onChange={(e) => setSecret(e.target.value)} autoComplete="new-password" />
        </Field>
        <Field label="Login page" htmlFor="cr-url">
          <Input id="cr-url" value={url} maxLength={500} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />
        </Field>
        {!credential && !defaultMerchantId ? (
          <Field label="Merchant" htmlFor="cr-merchant" hint="Leave empty for an Innowi login">
            <MerchantSelect id="cr-merchant" value={merchant} onChange={setMerchant} placeholder="Innowi — or search a merchant…" />
          </Field>
        ) : null}
        <Field label="Notes" htmlFor="cr-notes" className="sm:col-span-2">
          <Textarea id="cr-notes" rows={2} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="2FA goes to Ivy's phone" />
        </Field>
      </div>
    </Dialog>
  );
}

/** Vault access log (managers). */
export function CredentialLog({ merchantId }: { merchantId?: string }) {
  const creds = useCredentials(merchantId);
  const canManage = !!creds.data?.canManage;
  const { data, isPending } = useCredentialLog(merchantId, canManage);
  if (!canManage) return null;
  const VERB = { CREATED: "added", UPDATED: "changed", REVEALED: "revealed", DELETED: "deleted" } as const;
  return (
    <Card>
      <CardBody className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-foreground">Access log</h3>
        {isPending ? (
          <Skeleton className="h-4 w-1/2" />
        ) : !data?.length ? (
          <p className="text-sm text-muted-foreground">Nothing yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border text-sm">
            {data.map((e) => (
              <li key={e.id} className="flex flex-wrap gap-x-2 py-2">
                <span className="font-medium text-foreground">{e.user?.name ?? e.userEmail ?? "Someone"}</span>
                <span className="text-muted-foreground">{VERB[e.action]}</span>
                <span className="text-foreground">{e.credentialLabel}</span>
                {e.reason ? <span className="text-muted-foreground">— “{e.reason}”</span> : null}
                <span className="ml-auto text-xs text-muted-foreground">{formatDateTime(e.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
