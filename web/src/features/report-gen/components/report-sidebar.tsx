"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CircleCheck,
  Eye,
  FileChartColumn,
  Gift,
  Globe,
  History,
  Info,
  Lock,
  Mail,
  MapPin,
  Megaphone,
  Pencil,
  PenLine,
  Search,
  Send,
  Star,
  Tag,
  Trash2,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { Button, Card, Dialog, Tabs, TabsContent, TabsList, TabsTrigger, useToast } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import { useApprove, useDeleteReport, useSendReport } from "../api";
import { dateTime, initials } from "../format";
import type { Report, ReportStatus, Snapshot } from "../types";
import { ExportButtons, PreviewOptions, PrivacyProtection, ReportSetup } from "./report-setup";
import { BTN, BTN_DELETE, BTN_PRIMARY, ICON_SEND } from "./sidebar-fx";
import { STATUS } from "./queue-page";

/**
 * The review page's right-hand column: one card, five tabs, one panel at a
 * time.
 *
 * Nothing about behaviour changed here — the same hooks, the same permission
 * checks and the same enabled/disabled rules as before. Only the arrangement,
 * the wording and the motion.
 *
 * The tab strip is a segmented control at every width: the selected tab is a
 * pill showing icon + label, the rest are icon-only with a tooltip and a
 * screen-reader label. The Tabs primitive's selected-underline is switched off
 * (`after:hidden`) because the pill is the selection cue here; its arrow-key
 * roving and ARIA wiring are untouched.
 */

const TABS = [
  { value: "review", label: "Review", tip: "Status, actions and recipients", Icon: CircleCheck },
  { value: "edit", label: "Edit", tip: "Edit the written text", Icon: Pencil },
  { value: "preview", label: "Preview", tip: "See it as the client does", Icon: Eye },
  { value: "details", label: "Details", tip: "Template, period and included services", Icon: Info },
  { value: "activity", label: "Activity", tip: "Full history, newest first", Icon: History },
] as const;

/** Segmented-control trigger. `group-aria-selected:` drives the label so the
 *  pill shows its name while the others stay icon-only. */
const TRIGGER = cn(
  "group h-8 rounded-md px-2 after:hidden",
  "motion-safe:transition-all motion-safe:duration-150 motion-safe:ease-out",
  "aria-selected:bg-card aria-selected:text-foreground aria-selected:shadow-sm",
  "text-muted-foreground hover:bg-card/60 hover:text-foreground",
  "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40",
);

/** The dot colour beside the status name, taken from the badge tone already
 *  used by the queue so the two screens agree. */
const DOT: Record<string, string> = {
  neutral: "bg-muted-foreground",
  accent: "bg-primary",
  warning: "bg-warning",
  success: "bg-success",
  "success-solid": "bg-success",
  danger: "bg-destructive",
};

/**
 * Icon per contracted service. Matched case-insensitively on a substring, so
 * the catalogue's real names work too ("SMS/Email", "Review Management",
 * "Rewards Flyer", "Google Review Badge"). First match wins, hence the order;
 * anything unrecognised keeps the neutral tag.
 */
const SERVICE_ICONS: [RegExp, LucideIcon][] = [
  [/seo/i, Search],
  [/blog/i, PenLine],
  [/gmb|business profile/i, MapPin],
  [/report/i, FileChartColumn],
  [/\bads?\b|google ads|advert/i, Megaphone],
  [/website/i, Globe],
  [/email|sms/i, Mail],
  [/reward/i, Gift],
  [/review/i, Star],
  [/sales/i, TrendingUp],
];
const serviceIcon = (name: string): LucideIcon => SERVICE_ICONS.find(([re]) => re.test(name))?.[1] ?? Tag;

/** At most this many chips; the rest collapse into a "+N more" chip. */
const MAX_CHIPS = 6;

/**
 * `dry-run: nothing was sent` is written by the API and is the audit record,
 * so it is translated for display only — the stored string is untouched.
 */
const NOTE_LABELS: Record<string, string> = { "dry-run: nothing was sent": "Test mode (no email sent)" };
const noteLabel = (note: string | null) => (note ? NOTE_LABELS[note] ?? note : null);

export function ReportSidebar({
  r,
  snap,
  merchantView,
  onMerchantView,
  editing,
  onEditing,
  canEdit,
}: {
  r: Report;
  snap: Snapshot | null;
  merchantView: boolean;
  onMerchantView: (v: boolean) => void;
  editing: boolean;
  onEditing: (v: boolean) => void;
  canEdit: boolean;
}) {
  const [tab, setTab] = useState<string>("review");

  // Fade + 4px rise whenever the panel changes. Done with state rather than a
  // keyframe so it needs no global CSS, and `motion-reduce` switches it off.
  const [shown, setShown] = useState(true);
  useEffect(() => {
    setShown(false);
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, [tab]);

  return (
    // One card owns the padding, so the strip and the panel share an inner edge.
    // It is a flex column: the strip never scrolls, the panel below it does, so
    // the rounded bottom and the action buttons stay reachable on long content.
    <Card className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl p-4 shadow-sm">
      <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col gap-4">
        <TabsList className="shrink-0 gap-1 overflow-visible rounded-lg bg-muted p-1">
          {TABS.map(({ value, label, tip, Icon }) => (
            <TabsTrigger key={value} value={value} className={TRIGGER}>
              <span title={tip} className="flex items-center gap-1.5">
                <Icon aria-hidden />
                {/* one accessible name in both states: visible on the pill, sr-only otherwise */}
                <span className="hidden group-aria-selected:inline">{label}</span>
                <span className="sr-only group-aria-selected:hidden">{label}</span>
              </span>
            </TabsTrigger>
          ))}
        </TabsList>

        <div
          className={cn(
            // the panel area scrolls; a stable gutter stops a 6px jump when a
            // scrollbar appears, and the thumb is themed rather than default grey
            "min-h-0 flex-1 overflow-y-auto pr-0.5 [scrollbar-gutter:stable] [scrollbar-width:thin]",
            "[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border",
            "[&::-webkit-scrollbar-track]:bg-transparent",
            // a floor so switching tabs does not resize the card
            "min-h-[15rem]",
            "motion-safe:transition-all motion-safe:duration-150 motion-safe:ease-out",
            shown ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0",
          )}
        >
          <TabsContent className="outline-none focus:outline-none focus-visible:outline-none" value="review">
            <ReviewTab r={r} snap={snap} />
          </TabsContent>
          <TabsContent className="outline-none focus:outline-none focus-visible:outline-none" value="edit">
            <EditTab r={r} editing={editing} onEditing={onEditing} canEdit={canEdit} />
          </TabsContent>
          <TabsContent className="outline-none focus:outline-none focus-visible:outline-none" value="preview">
            <PreviewOptions merchantView={merchantView} onChange={onMerchantView} />
          </TabsContent>
          <TabsContent className="outline-none focus:outline-none focus-visible:outline-none" value="details">
            <div className="flex flex-col gap-4">
              {snap ? <ReportSetup r={r} snap={snap} /> : <p className="text-xs text-muted-foreground">No snapshot yet.</p>}
              <PrivacyProtection />
            </div>
          </TabsContent>
          <TabsContent className="outline-none focus:outline-none focus-visible:outline-none" value="activity">
            <ActivityTab r={r} />
          </TabsContent>
        </div>
      </Tabs>
    </Card>
  );
}

/* ----------------------------------------------------------- services ---- */
/**
 * The services this merchant actually contracted, from `snap.services`.
 *
 * Only contracted services are drawn. There is deliberately no placeholder,
 * greyed-out or struck-through chip for a service the merchant has not taken —
 * that comparison belongs to the Details tab, which shows which report
 * *sections* are included. Here, absence is absence.
 */
function ServicesBlock({ services }: { services: string[] }) {
  if (!services.length) return <p className="text-xs text-muted-foreground">No services on file</p>;

  const shown = services.slice(0, MAX_CHIPS);
  const hidden = services.slice(MAX_CHIPS);

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-foreground">Services</span>
        <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums text-muted-foreground">{services.length}</span>
      </div>
      <ul aria-label="Contracted services" className="flex flex-wrap gap-1.5">
        {shown.map((name) => {
          const Icon = serviceIcon(name);
          return (
            <li
              key={name}
              className="inline-flex items-center gap-1.5 rounded-full bg-accent px-2.5 py-1 text-xs font-medium text-primary-subtle-foreground motion-safe:transition-colors hover:bg-accent-hover"
            >
              <Icon className="size-3.5" aria-hidden />
              {name}
            </li>
          );
        })}
        {hidden.length > 0 && (
          <li
            title={hidden.join(", ")}
            className="inline-flex items-center rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground motion-safe:transition-colors hover:bg-accent-hover"
          >
            +{hidden.length} more
          </li>
        )}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------- review ---- */
function ReviewTab({ r, snap }: { r: Report; snap: Snapshot | null }) {
  const approve = useApprove();
  const del = useDeleteReport();
  const send = useSendReport();
  const { toast } = useToast();
  const [confirm, setConfirm] = useState<"delete" | "send" | null>(null);

  // Unchanged rules: only a draft can be approved, only an approved (or a
  // failed-after-approval) report can be sent, and a sent report is never
  // deletable.
  const isDraft = r.status === "draft" || r.status === "edited";
  const canSend = r.canApprove && (r.status === "approved" || (r.status === "failed" && !!r.approvedAt)) && !r.sentAt;
  const canDelete = r.canManage && ["draft", "edited", "approved", "failed"].includes(r.status);
  const live = r.sendMode === "live";
  const tone = (STATUS[r.status as ReportStatus] ?? { label: r.status, tone: "neutral" }).tone;
  const name = r.merchant?.name ?? "Merchant";

  return (
    <>
      <div className="flex flex-col gap-3.5">
        {/* a. back link */}
        <Link
          href="/report-gen"
          className="inline-flex w-fit items-center gap-1 rounded-md text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
        >
          <ArrowLeft className="size-3.5" /> All reports
        </Link>

        {/* b. header */}
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent text-sm font-semibold text-primary"
          >
            {initials(name)}
          </span>
          <div className="flex min-w-0 flex-col gap-1">
            <h2 title={name} className="truncate text-base font-semibold tracking-[-0.006em] text-foreground">{name}</h2>
            <p className="text-xs text-muted-foreground">{r.period.label} · monthly report</p>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-foreground">
                <span className={cn("size-1.5 rounded-full", DOT[tone] ?? "bg-muted-foreground")} aria-hidden />
                {STATUS[r.status as ReportStatus]?.label ?? r.status}
              </span>
              <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">Version {r.version}</span>
            </div>
          </div>
        </div>

        {/* c. services actually contracted */}
        <ServicesBlock services={snap?.services ?? []} />

        {/* d. info */}
        <div className="flex flex-col gap-1.5 text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">
          <div>
            Recipients:{" "}
            {r.defaultRecipients.length ? r.defaultRecipients.join(", ") : "none on file (add an OWNER or MARKETING contact with an e-mail)"}
          </div>
          {r.missing.length > 0 && (
            <div>
              {r.missing.length} metric{r.missing.length === 1 ? "" : "s"} unavailable
            </div>
          )}
          <p className="flex items-start gap-2">
            <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            Personal data, internal notes, billing and pipeline data are excluded automatically.
          </p>
          {r.error && <p className="text-text-destructive">{r.error}</p>}
        </div>

        {/* e. divider */}
        <div className="h-px bg-border" />

        {/* f. actions, last */}
        <div className="flex flex-col gap-2">
          {isDraft && r.canApprove && (
            <Button
              variant="default"
              className={cn(BTN, BTN_PRIMARY)}
              loading={approve.isPending}
              disabled={!!r.approveBlocked}
              title={r.approveBlocked ?? undefined}
              onClick={() =>
                approve.mutate(r.id, {
                  onSuccess: () => toast({ variant: "success", title: "Approved — snapshot frozen" }),
                  onError: (e) => toast({ variant: "error", title: "Couldn't approve", description: e.message }),
                })
              }
            >
              <CircleCheck /> Approve
            </Button>
          )}
          {isDraft && r.approveBlocked && <p className="text-xs text-muted-foreground">{r.approveBlocked}</p>}
          <ExportButtons r={r} />
          {canSend && (
            <Button variant="outline" className={cn(BTN, ICON_SEND)} onClick={() => setConfirm("send")}>
              <Send /> {live ? "Send to merchant" : "Send (test mode)"}
            </Button>
          )}
          {canDelete && (
            <Button variant="ghost" className={cn(BTN, BTN_DELETE)} onClick={() => setConfirm("delete")}>
              <Trash2 /> Delete
            </Button>
          )}
        </div>
      </div>

      <Dialog
        open={confirm === "delete"}
        onClose={() => setConfirm(null)}
        title="Delete this report?"
        description="The draft is hidden from the queue. Its history stays, and a new report can be generated for the same month."
        tone="danger"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              loading={del.isPending}
              onClick={() =>
                del.mutate(r.id, {
                  onSuccess: () => {
                    setConfirm(null);
                    toast({ variant: "success", title: "Report deleted" });
                  },
                  onError: (e) => toast({ variant: "error", title: "Couldn't delete", description: e.message }),
                })
              }
            >
              Delete
            </Button>
          </>
        }
      />

      <Dialog
        open={confirm === "send"}
        onClose={() => setConfirm(null)}
        title={live ? "Send the approved report?" : "Send in test mode"}
        description={
          live
            ? `The approved version goes to ${r.defaultRecipients.join(", ") || "nobody"}.`
            : "Dry run: the recipients and subject are recorded, nothing is e-mailed, and the report stays approved."
        }
        tone="primary"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="default"
              loading={send.isPending}
              onClick={() =>
                send.mutate(
                  { id: r.id },
                  {
                    onSuccess: (res) => {
                      setConfirm(null);
                      toast({
                        variant: "success",
                        title: res.send.status === "sent" ? "Sent" : "Dry run recorded",
                        description: `${res.send.subject} → ${res.send.recipients.join(", ")}`,
                      });
                    },
                    onError: (e) => toast({ variant: "error", title: "Couldn't send", description: e.message }),
                  },
                )
              }
            >
              {live ? "Send" : "Run dry run"}
            </Button>
          </>
        }
      />
    </>
  );
}

/* --------------------------------------------------------------- edit ---- */
/**
 * The editor itself stays in the document, where the text being changed is.
 * This tab is its entry point and its status line.
 */
function EditTab({ r, editing, onEditing, canEdit }: { r: Report; editing: boolean; onEditing: (v: boolean) => void; canEdit: boolean }) {
  const frozen = r.status === "approved" || r.status === "sent";
  const edited = r.snapshot && "edited" in r.snapshot ? (r.snapshot as Snapshot).edited?.keys ?? [] : [];
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-foreground">Edit</h2>
      {canEdit ? (
        <>
          <p className="text-xs leading-5 text-muted-foreground">
            You can change the summary, the recommendations and the bottom line. Figures never change through an edit.
          </p>
          <Button
            variant={editing ? "outline" : "default"}
            size="sm"
            className={cn("self-start", BTN, !editing && BTN_PRIMARY)}
            onClick={() => onEditing(!editing)}
          >
            <Pencil /> {editing ? "Stop editing" : "Edit the written text"}
          </Button>
          {editing && <p className="text-xs text-muted-foreground">The editor is open in the document on the left.</p>}
        </>
      ) : (
        <p className="text-xs leading-5 text-muted-foreground">
          {frozen
            ? "This version is approved, so its text is frozen. Generate a new version to make changes."
            : r.status === "deleted"
              ? "This report is deleted."
              : "Only a draft can be edited, and you need the manage permission."}
        </p>
      )}
      {edited.length > 0 && (
        <p className="border-t border-border pt-2.5 text-xs text-muted-foreground">Edited so far: {edited.join(", ")}</p>
      )}
    </section>
  );
}

/* ----------------------------------------------------------- activity ---- */
function ActivityTab({ r }: { r: Report }) {
  // Newest first for reading. The source order is left untouched.
  const rows = [...r.history].reverse();
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-foreground">Activity</h2>
      <div className="flex flex-col gap-1 text-xs text-muted-foreground">
        {r.generatedBy && (
          <div>
            Generated by {r.generatedBy.name} · {dateTime(r.generatedAt)}
          </div>
        )}
        {r.approvedBy && (
          <div>
            Approved by {r.approvedBy.name} · {dateTime(r.approvedAt)}
          </div>
        )}
        {r.sentAt && <div>Sent · {dateTime(r.sentAt)}</div>}
        {r.deletedBy && (
          <div>
            Deleted by {r.deletedBy.name} · {dateTime(r.deletedAt)}
          </div>
        )}
      </div>
      {rows.length ? (
        <ol className="flex flex-col gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
          {rows.map((h, i) => (
            <li key={i} className="flex flex-col rounded-md px-2 py-1 [overflow-wrap:anywhere] transition-colors hover:bg-muted/60">
              <span className="font-medium text-foreground">
                {h.action.replace("_", " ")} <span className="font-normal text-muted-foreground">v{h.version}</span>
              </span>
              <span>
                {dateTime(h.at)}
                {h.user ? ` · ${h.user.name}` : ""}
              </span>
              {noteLabel(h.note) && <span className="italic">{noteLabel(h.note)}</span>}
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-xs text-muted-foreground">Nothing has happened to this report yet.</p>
      )}
    </section>
  );
}
