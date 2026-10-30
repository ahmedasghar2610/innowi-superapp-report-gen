"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Ban, RefreshCw } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardBody,
  Dialog,
  ErrorState,
  Field,
  Input,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableMessageRow,
  TableRow,
  useToast,
} from "@/components/ui";
import { useAuth } from "@/features/auth/auth-context";
import { hasCapability } from "@/features/auth/capabilities";
import { formatDate, formatDateTime } from "@/lib/format";
import { MODE_LABEL, REQUEST_STATUS_LABEL, REQUEST_STATUS_TONE, usd } from "../format";
import { useNewLinkUrl, usePriceList, useQuoteLink, useQuoteRequests, useRevokeLink, useUpdateLink } from "../queries";
import type { LinkCreated } from "../types";
import { LinkUrlDialog } from "./link-url-dialog";
import { PricingEditor, draftToItems, itemsToDraft, type PricingDraft } from "./pricing-editor";

/** Route /quotes/links/[id]: one quote link — who it's for, its pricing, what came back. */
export function LinkPage({ id }: { id: string }) {
  const { user } = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const canEdit = hasCapability(user?.role, "quotes.edit");
  const canDiscount = hasCapability(user?.role, "quotes.discount");
  const link = useQuoteLink(id);
  const requests = useQuoteRequests({ linkId: id, limit: 50 });
  const priceList = usePriceList();
  const update = useUpdateLink();
  const revoke = useRevokeLink();
  const newUrl = useNewLinkUrl();
  const [draft, setDraft] = useState<PricingDraft>({});
  const [discount, setDiscount] = useState("");
  const [created, setCreated] = useState<LinkCreated | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  useEffect(() => {
    if (link.data) {
      setDraft(itemsToDraft(link.data.items));
      setDiscount(Number(link.data.discountPercent) ? String(Number(link.data.discountPercent)) : "");
    }
  }, [link.data]);

  if (link.isPending) return <Skeleton className="h-64" />;
  if (link.isError) return <ErrorState error={link.error} onRetry={() => link.refetch()} />;
  const l = link.data;
  const live = l.status === "ACTIVE" && !l.expired;

  const savePricing = () =>
    update.mutate(
      { id, input: { discountPercent: discount || "0", items: draftToItems(draft) } },
      {
        onSuccess: () => toast({ variant: "success", title: "Pricing saved", description: "Applies to their next quote; sent proposals keep their prices." }),
        onError: (e) => toast({ variant: "error", title: "Couldn't save", description: e.messages.join(" · ") }),
      },
    );

  return (
    <div className="flex max-w-5xl flex-col gap-5">
      <div>
        <Link href="/quotes" className="inline-flex items-center gap-1 text-table text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Quotes
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-[-0.011em] text-foreground">{l.restaurantName}</h1>
          <Badge tone={live ? "success" : l.status === "REVOKED" ? "neutral" : "warning"}>
            {live ? "Link active" : l.status === "REVOKED" ? "Turned off" : "Expired"}
          </Badge>
          <Badge tone="outline" icon={false}>
            {MODE_LABEL[l.mode]}
          </Badge>
        </div>
        <p className="mt-1 text-table text-muted-foreground">
          {[l.contactName, l.contactEmail, l.contactPhone].filter(Boolean).join(" · ") || "No contact details"} · sent by {l.createdByEmail} on{" "}
          {formatDate(l.createdAt)} · {l.expiresAt ? `works until ${formatDate(l.expiresAt)}` : "no expiry"} · opened {l.openCount}×
          {l.lastOpenedAt ? ` (last ${formatDateTime(l.lastOpenedAt)})` : ""}
        </p>
      </div>

      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            loading={newUrl.isPending}
            onClick={() =>
              newUrl.mutate(id, {
                onSuccess: setCreated,
                onError: (e) => toast({ variant: "error", title: "Couldn't make a new link", description: e.messages.join(" · ") }),
              })
            }
          >
            <RefreshCw className="size-4" /> {live ? "Get a new link" : "Re-open with a new link"}
          </Button>
          {live && (
            <Button variant="outline" onClick={() => setConfirmRevoke(true)}>
              <Ban className="size-4" /> Turn off link
            </Button>
          )}
        </div>
      )}

      <Card>
        <CardBody>
          <div className="mb-2 text-sm font-semibold text-foreground">What came back</div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Quote</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">One-time</TableHead>
                <TableHead className="text-right">Monthly</TableHead>
                <TableHead>Received</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!requests.data?.data.length ? (
                <TableMessageRow colSpan={5}>{requests.isPending ? "Loading…" : "Nothing yet."}</TableMessageRow>
              ) : (
                requests.data.data.map((r) => (
                  <TableRow key={r.id} interactive onClick={() => router.push(`/quotes/requests/${r.id}`)}>
                    <TableCell className="font-medium tabular-nums">{r.number}</TableCell>
                    <TableCell>
                      <Badge tone={REQUEST_STATUS_TONE[r.status]}>{REQUEST_STATUS_LABEL[r.status]}</Badge>
                    </TableCell>
                    <TableCell align="right" className="tabular-nums">{usd(r.totals.oneTime)}</TableCell>
                    <TableCell align="right" className="tabular-nums">{usd(r.totals.monthly)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDateTime(r.createdAt)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="flex flex-col gap-3">
          <div>
            <div className="text-sm font-semibold text-foreground">Special pricing on this link</div>
            <p className="text-xs text-muted-foreground">
              Changes apply to their next quote. Proposals already sent keep the prices they were made with.
            </p>
          </div>
          {canDiscount && (
            <Field label="Discount on everything (%)" htmlFor="lp-disc">
              <Input id="lp-disc" inputMode="decimal" placeholder="0" className="w-[120px]" value={discount} onChange={(e) => setDiscount(e.target.value.replace(/[^\d.]/g, ""))} />
            </Field>
          )}
          {priceList.data ? (
            <PricingEditor
              items={priceList.data.filter((i) => i.active)}
              draft={draft}
              onChange={setDraft}
              canDiscount={canDiscount}
              readOnly={!canDiscount}
            />
          ) : (
            <Skeleton className="h-40" />
          )}
          {!canDiscount && <p className="text-xs text-muted-foreground">Only managers can change a link&apos;s pricing.</p>}
          {canEdit && canDiscount && (
            <div>
              <Button variant="default" onClick={savePricing} loading={update.isPending}>
                Save pricing
              </Button>
            </div>
          )}
        </CardBody>
      </Card>

      {created && <LinkUrlDialog link={created.link} url={created.url} onClose={() => setCreated(null)} />}
      <Dialog
        open={confirmRevoke}
        onClose={() => setConfirmRevoke(false)}
        title="Turn off this link?"
        description="The restaurant won't be able to open it any more. You can re-open it later with a new link."
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmRevoke(false)}>
              Keep it
            </Button>
            <Button
              variant="destructive"
              loading={revoke.isPending}
              onClick={() =>
                revoke.mutate(id, {
                  onSuccess: () => {
                    setConfirmRevoke(false);
                    toast({ variant: "success", title: "Link turned off" });
                  },
                })
              }
            >
              Turn off
            </Button>
          </>
        }
      />
    </div>
  );
}
