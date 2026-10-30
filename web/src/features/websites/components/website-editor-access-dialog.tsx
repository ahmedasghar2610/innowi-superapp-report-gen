"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Eye, EyeOff, KeyRound, RotateCcw } from "lucide-react";
import { Button, Dialog, Field, Input, useToast } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { siteAdminUrl } from "../api/client";
import { useRebuildFromForm, useUpdateWebsite } from "../api/websites.queries";
import type { Website } from "../types";

interface WebsiteEditorAccessDialogProps {
  website: Website | null;
  onClose: () => void;
}

/**
 * Editor access for one website: the /<slug>/admin link, its password, and
 * "Rebuild from form".
 *
 * The editor lives on the public site template, reached only by adding /admin
 * to the site's URL. Whoever has this website's password can edit it there;
 * the password opens no other website and isn't a Super App login.
 */
export function WebsiteEditorAccessDialog({ website, onClose }: WebsiteEditorAccessDialogProps) {
  const { toast } = useToast();
  const update = useUpdateWebsite();
  const rebuild = useRebuildFromForm();
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [confirmRebuild, setConfirmRebuild] = useState(false);

  useEffect(() => {
    setPassword("");
    setShow(false);
    setConfirmRebuild(false);
  }, [website]);

  if (!website) return null;
  const adminUrl = siteAdminUrl(website.slug);
  const tooShort = password.length > 0 && password.length < 8;
  const busy = update.isPending || rebuild.isPending;

  const savePassword = (value: string) =>
    update.mutate(
      { id: website.id, input: { adminPassword: value } },
      {
        onSuccess: () => {
          toast({
            variant: "success",
            title: value ? "Editor password saved" : "Editing turned off",
            description: value ? "Anyone signed in to /admin with the old one has been signed out." : website.name,
          });
          setPassword("");
          onClose();
        },
        onError: (err) => toast({ variant: "error", title: "Couldn't save", description: err.messages.join(" · ") }),
      },
    );

  const doRebuild = () =>
    rebuild.mutate(website.id, {
      onSuccess: () => {
        toast({ variant: "success", title: "Rebuilt from the form", description: "The /admin edits were discarded." });
        onClose();
      },
      onError: (err) => toast({ variant: "error", title: "Couldn't rebuild", description: err.messages.join(" · ") }),
    });

  return (
    <Dialog
      open
      onClose={onClose}
      size="md"
      icon={<KeyRound />}
      title="Visual editor"
      description={`${website.name} can be edited visually at its own /admin address.`}
      dismissible={!busy}
      hideClose={busy}
      footer={
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Close
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2">
          <code className="min-w-0 flex-1 truncate text-table text-foreground">{adminUrl}</code>
          {website.hasAdminPassword && (
            <a
              href={adminUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-7 shrink-0 items-center gap-1 rounded-sm px-2 text-xs font-medium text-primary hover:bg-accent [&_svg]:size-4"
            >
              <ExternalLink aria-hidden />
              Open editor
            </a>
          )}
        </div>

        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (password.length >= 8) savePassword(password);
          }}
        >
          <Field
            label={website.hasAdminPassword ? "New editor password" : "Editor password"}
            htmlFor="editor-password"
            hint={
              website.hasAdminPassword
                ? "Editing is on. A new password signs everyone out of /admin."
                : "Editing is off until a password is set. At least 8 characters."
            }
            error={tooShort ? "At least 8 characters." : undefined}
          >
            <div className="flex gap-2">
              <Input
                id="editor-password"
                type={show ? "text" : "password"}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <Button
                variant="outline"
                size="icon"
                aria-label={show ? "Hide password" : "Show password"}
                onClick={() => setShow((v) => !v)}
              >
                {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </Button>
            </div>
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="default" size="sm" disabled={password.length < 8} loading={update.isPending}>
              {website.hasAdminPassword ? "Change password" : "Turn on editing"}
            </Button>
            {website.hasAdminPassword && (
              <Button variant="ghost" size="sm" onClick={() => savePassword("")} disabled={busy}>
                Turn off editing
              </Button>
            )}
          </div>
        </form>

        <div className="border-t border-border pt-4">
          {website.editorUpdatedAt ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-foreground">
                Edited in /admin · {formatDateTime(website.editorUpdatedAt)}
              </p>
              <p className="text-table text-muted-foreground">
                {website.editorBound
                  ? "The form and the visual editor stay in sync: text, links, images and list items changed in either one show on the live page. Rebuilding from the form is only needed to start the design over — it discards every /admin edit."
                  : "These pages were edited before form syncing existed, so changes in the website form aren't shown. Rebuild from the form once to switch this site over (this discards the /admin edits)."}
              </p>
              {confirmRebuild ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-table text-text-destructive">Discard all /admin edits?</span>
                  <Button variant="destructive" size="sm" onClick={doRebuild} loading={rebuild.isPending}>
                    Yes, rebuild
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setConfirmRebuild(false)} disabled={busy}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <div>
                  <Button variant="outline" size="sm" onClick={() => setConfirmRebuild(true)} disabled={busy}>
                    <RotateCcw className="size-4" />
                    Rebuild from form
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <p className="text-table text-muted-foreground">
              Not edited in /admin yet — the site is built from the website form. The first save in the editor
              switches it to the edited pages.
            </p>
          )}
        </div>
      </div>
    </Dialog>
  );
}
