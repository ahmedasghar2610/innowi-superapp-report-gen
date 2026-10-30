"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CircleCheck, CircleDashed, Pencil, Plus, Search, Trash2 } from "lucide-react";
import {
  Badge,
  Button,
  Dialog,
  ErrorState,
  Field,
  Input,
  Select,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableMessageRow,
  TableRow,
  Textarea,
  useToast,
} from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import { useAddSite, useDeleteSite, useLinkOptions, useSeoSites, useSeoStatus, useUpdateSite } from "../api";
import { CADENCE, fmtAgo, PACKAGE } from "../lib";
import type { Cadence, Package, SeoStatus, SiteInput, SiteSettingsRow, SitesList } from "../types";
import { Chip, DemoBadge, InfoNote, PackageBadge, Section, Segmented } from "./parts";
import { usePager } from "./pager";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SOURCE: Record<string, string> = { GSC: "Search Console", GOOGLE: "Search Console", MANUAL: "Added by hand", DEMO: "Sample" };

/**
 * SEO → Site settings (/web/seo/site-settings): the optional SEO keys and every
 * site's settings (links, package, owner, report recipients). `?site=<id>` opens one.
 * The Google connection itself is in Settings → Integrations, with GBP and Ads.
 */
export function SeoSitesSettings() {
  const status = useSeoStatus();
  return (
    <div className="flex flex-col gap-5">
      {status.data && <KeysCard s={status.data} />}
      <SitesSection canManage={!!status.data?.canManage} />
    </div>
  );
}

function KeysCard({ s }: { s: SeoStatus }) {
  const rows = [
    { env: "PAGESPEED_API_KEY", on: s.keys.pagespeed, label: "PageSpeed Insights", what: "Mobile speed score and Core Web Vitals for the top pages (weekly)." },
    { env: "Gmail · gmail.send permission", on: s.keys.email, label: "Report email (Gmail)", what: s.email.configured && s.email.from ? `Signed-off client reports are sent from ${s.email.from}.` : "Sends signed-off client reports from the Google account connected for SEO.", href: "/settings/integrations#seo-email" },
  ];
  return (
    <Section title="Optional services" aside={<span className="text-xs text-muted-foreground">Keys go in the API .env (restart after); e-mail is set up in Settings → Integrations</span>}>
      <div className="grid gap-3 md:grid-cols-2">
        {rows.map((r) => (
          <div key={r.env} className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
            <div className="flex items-start gap-2">
              <span className="flex-1 text-sm font-semibold text-foreground">{r.label}</span>
              <Badge tone={r.on ? "success" : "neutral"} icon={r.on ? CircleCheck : CircleDashed}>
                {r.on ? "Configured" : "Not set"}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">{r.what}</p>
            <code className="w-fit rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{r.env}</code>
            {"href" in r && r.href && (
              <Link href={r.href} className="text-xs font-medium text-primary hover:underline">
                {r.on ? "Send a test e-mail" : "How to set it up"}
              </Link>
            )}
          </div>
        ))}
      </div>
    </Section>
  );
}

function SitesSection({ canManage }: { canManage: boolean }) {
  const q = useSeoSites();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"" | "nogsc" | "noga4" | "nomerchant" | "norecipients" | "paused">("");
  const [adding, setAdding] = useState(false);
  const openId = params.get("site");

  const setOpen = (id: string | null) => {
    const sp = new URLSearchParams(params.toString());
    if (id) sp.set("site", id);
    else sp.delete("site");
    router.replace(`${pathname}${sp.toString() ? `?${sp}` : ""}`, { scroll: false });
  };

  const d = q.data;
  const rows = useMemo(() => {
    if (!d) return [];
    const t = search.trim().toLowerCase();
    return d.data.filter(
      (s) =>
        (!t || s.name.toLowerCase().includes(t) || s.domain.includes(t)) &&
        (filter === "" ||
          (filter === "nogsc" && !s.gscProperty) ||
          (filter === "noga4" && !s.ga4Property) ||
          (filter === "nomerchant" && !s.merchant) ||
          (filter === "norecipients" && s.allRecipients.length === 0) ||
          (filter === "paused" && s.status === "paused")),
    );
  }, [d, search, filter]);
  const pg = usePager(rows);

  if (q.error) return <ErrorState title="Couldn't load the sites" description={q.error.message} />;
  if (!d) return <Skeleton className="h-72 w-full" />;
  const open = d.data.find((s) => s.id === openId) ?? null;
  const count = (f: (s: SiteSettingsRow) => boolean) => d.data.filter(f).length;

  return (
    <Section
      title="Sites"
      aside={
        canManage && (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus className="size-4" />
            Add site
          </Button>
        )
      }
    >
      <InfoNote>
        Sites appear automatically for every Search Console property the Google account can read. Link each one to its merchant, GBP listing, Ads account and GA4 property, and
        set the package and who gets the report.
      </InfoNote>
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative w-full max-w-xs">
          <span className="sr-only">Search sites</span>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Site or domain" className="pl-8" />
        </label>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter">
          <Chip on={filter === ""} onClick={() => setFilter("")} count={d.data.length}>
            All
          </Chip>
          <Chip on={filter === "nogsc"} onClick={() => setFilter("nogsc")} count={count((s) => !s.gscProperty)}>
            No Search Console
          </Chip>
          <Chip on={filter === "noga4"} onClick={() => setFilter("noga4")} count={count((s) => !s.ga4Property)}>
            No GA4
          </Chip>
          <Chip on={filter === "nomerchant"} onClick={() => setFilter("nomerchant")} count={count((s) => !s.merchant)}>
            No merchant
          </Chip>
          <Chip on={filter === "norecipients"} onClick={() => setFilter("norecipients")} count={count((s) => s.allRecipients.length === 0)}>
            No report recipients
          </Chip>
          <Chip on={filter === "paused"} onClick={() => setFilter("paused")} count={count((s) => s.status === "paused")}>
            Paused
          </Chip>
        </div>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-56">Site</TableHead>
            <TableHead>Package</TableHead>
            <TableHead>Search Console</TableHead>
            <TableHead>GA4</TableHead>
            <TableHead>Merchant</TableHead>
            <TableHead>Report</TableHead>
            <TableHead>Sync</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {pg.rows.map((s) => (
            <TableRow key={s.id} interactive onClick={() => setOpen(s.id)}>
              <TableCell>
                <div className="flex flex-col">
                  <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                    {s.name}
                    {s.isDemo && <DemoBadge />}
                    {s.status === "paused" && <Badge tone="neutral">Paused</Badge>}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {[s.name !== s.domain && s.domain, s.source !== "DEMO" && (SOURCE[s.source] ?? s.source)].filter(Boolean).join(" · ")}
                  </span>
                </div>
              </TableCell>
              <TableCell>
                <PackageBadge p={s.package} />
              </TableCell>
              <TableCell>{s.gscProperty ? <Linked title={`${s.gscProperty}${s.gscPermission ? ` · ${s.gscPermission}` : ""}`}>Linked</Linked> : <Badge tone="warning">Not linked</Badge>}</TableCell>
              <TableCell>{s.ga4Property ? <Linked title={s.ga4Property}>{s.ga4Name ?? s.ga4Property}</Linked> : <Badge tone="warning">Not linked</Badge>}</TableCell>
              <TableCell className="text-xs">{s.merchant?.name ?? <span className="text-muted-foreground">—</span>}</TableCell>
              <TableCell className="text-xs">
                <span className="flex flex-col">
                  <span>{CADENCE[s.reportCadence]}</span>
                  <span
                    className={cn(s.allRecipients.length ? "text-muted-foreground" : "text-warning-text")}
                    title={s.allRecipients.join(", ") || undefined}
                  >
                    {s.allRecipients.length ? `${s.allRecipients.length} recipient${s.allRecipients.length > 1 ? "s" : ""}` : "No recipients"}
                    {s.merchantRecipients.length > 0 && ` · ${s.merchantRecipients.length} from merchant`}
                  </span>
                </span>
              </TableCell>
              <TableCell className="whitespace-nowrap text-xs">
                {s.syncState === "issue" ? (
                  <Badge tone="danger" title={s.syncError ?? s.syncWarning ?? undefined}>
                    Issue
                  </Badge>
                ) : s.syncState === "never" ? (
                  <span className="text-muted-foreground">Not yet</span>
                ) : (
                  <span className="text-muted-foreground">{fmtAgo(s.lastSyncedAt)}</span>
                )}
              </TableCell>
              <TableCell align="right">
                <Pencil className="size-4 text-muted-foreground" aria-hidden />
              </TableCell>
            </TableRow>
          ))}
          {rows.length === 0 && (
            <TableMessageRow colSpan={8}>
              <p className="py-6 text-center text-sm text-muted-foreground">{d.data.length ? "No sites match." : "No sites yet — connect Search Console & GA4 above or add one by hand."}</p>
            </TableMessageRow>
          )}
        </TableBody>
      </Table>
      {pg.bar}
      <SiteDrawer site={open} meta={d} canManage={canManage} onClose={() => setOpen(null)} />
      <AddSiteDialog open={adding} onClose={() => setAdding(false)} onAdded={(id) => setOpen(id)} />
    </Section>
  );
}

function Linked({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex max-w-44 items-center gap-1 text-xs text-foreground" title={title}>
      <CircleCheck className="size-3.5 shrink-0 text-success-subtle-foreground" aria-hidden />
      <span className="truncate">{children}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ edit drawer ---- */

interface Form {
  name: string;
  merchantId: string;
  gbpLocationId: string;
  adsAccountId: string;
  ga4Property: string;
  package: Package;
  segment: string;
  ownerId: string;
  reportCadence: Cadence;
  recipients: string;
  status: "active" | "paused";
}
const formOf = (s: SiteSettingsRow): Form => ({
  name: s.name,
  merchantId: s.merchant?.id ?? "",
  gbpLocationId: s.gbpLocation?.id ?? "",
  adsAccountId: s.adsAccount?.id ?? "",
  ga4Property: s.ga4Property ?? "",
  package: s.package,
  segment: s.segment,
  ownerId: s.owner?.id ?? "",
  reportCadence: s.reportCadence,
  recipients: s.reportRecipients.join(", "),
  status: s.status,
});

function SiteDrawer({ site, meta, canManage, onClose }: { site: SiteSettingsRow | null; meta: SitesList; canManage: boolean; onClose: () => void }) {
  const update = useUpdateSite();
  const del = useDeleteSite();
  const { toast } = useToast();
  const [form, setForm] = useState<Form | null>(null);
  const [q, setQ] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const opts = useLinkOptions(q, !!site && canManage);
  useEffect(() => {
    setForm(site ? formOf(site) : null);
    setQ("");
  }, [site]);

  if (!site || !form) return <Dialog open={false} onClose={onClose} />;
  const o = opts.data;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm({ ...form, [k]: v });
  const recipients = form.recipients.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
  const badEmails = recipients.filter((e) => !EMAIL_RE.test(e));

  const save = () => {
    const before = formOf(site);
    const body: SiteInput = {};
    if (form.name.trim() !== before.name) body.name = form.name.trim();
    if (form.merchantId !== before.merchantId) body.merchantId = form.merchantId || null;
    if (form.gbpLocationId !== before.gbpLocationId) body.gbpLocationId = form.gbpLocationId || null;
    if (form.adsAccountId !== before.adsAccountId) body.adsAccountId = form.adsAccountId || null;
    if (form.ga4Property !== before.ga4Property) body.ga4Property = form.ga4Property || null;
    if (form.package !== before.package) body.package = form.package;
    if (form.segment !== before.segment) body.segment = form.segment;
    if (form.ownerId !== before.ownerId) body.ownerId = form.ownerId || null;
    if (form.reportCadence !== before.reportCadence) body.reportCadence = form.reportCadence;
    if (form.status !== before.status) body.status = form.status;
    if (recipients.join(",") !== site.reportRecipients.join(",")) body.reportRecipients = recipients;
    if (!Object.keys(body).length) return onClose();
    update.mutate(
      { id: site.id, body },
      {
        onSuccess: () => {
          toast({ variant: "success", title: `${form.name} saved` });
          onClose();
        },
        onError: (e) => toast({ variant: "error", title: "Couldn't save", description: e.messages?.[0] ?? e.message }),
      },
    );
  };

  /** Keep the current value selectable even when the search doesn't return it. */
  const withCurrent = <T extends { id: string }>(list: T[] | undefined, current: { id: string; label: string } | null, label: (x: T) => string) => {
    const items = (list ?? []).map((x) => ({ id: x.id, label: label(x) }));
    if (current && !items.some((x) => x.id === current.id)) items.unshift(current);
    return items;
  };
  const merchants = withCurrent(o?.merchants, site.merchant ? { id: site.merchant.id, label: site.merchant.name ?? "" } : null, (m) => m.name ?? "");
  const locations = withCurrent(o?.gbpLocations, site.gbpLocation ? { id: site.gbpLocation.id, label: site.gbpLocation.title } : null, (l) => `${l.title}${l.city ? ` — ${l.city}` : ""}${l.isDemo ? " (sample)" : ""}`);
  const accounts = withCurrent(o?.adsAccounts, site.adsAccount ? { id: site.adsAccount.id, label: site.adsAccount.name ?? "" } : null, (a) => `${a.name}${a.isDemo ? " (sample)" : ""}`);
  const ga4 = (o?.ga4Properties ?? []).map((g) => ({ id: g.property, label: `${g.name}${g.hosts.length ? ` — ${g.hosts.join(", ")}` : ""}` }));
  if (site.ga4Property && !ga4.some((g) => g.id === site.ga4Property)) ga4.unshift({ id: site.ga4Property, label: site.ga4Name ?? site.ga4Property });

  return (
    <Dialog
      open
      onClose={onClose}
      size="xl"
      footerBordered
      title={site.name}
      description={`${site.domain} · ${SOURCE[site.source] ?? site.source}`}
      footer={
        canManage ? (
          <div className="flex w-full items-center gap-2">
            {site.source === "MANUAL" && (
              <Button variant="ghost" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="size-4" />
                Remove
              </Button>
            )}
            <Link href={`/web/seo/sites/${site.id}`} className="mr-auto text-sm font-medium text-primary hover:underline">
              Open scorecard
            </Link>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={save} loading={update.isPending} disabled={badEmails.length > 0 || !form.name.trim()}>
              Save
            </Button>
          </div>
        ) : undefined
      }
    >
      <fieldset disabled={!canManage} className="flex flex-col gap-4">
        {!canManage && <InfoNote>Only managers and admins can change site settings.</InfoNote>}
        {site.syncError && <p className="rounded-md bg-destructive-subtle px-3 py-2 text-sm text-text-destructive">Last sync failed: {site.syncError}</p>}
        <Field label="Name" required>
          <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Status">
            <Select value={form.status} onChange={(e) => set("status", e.target.value as Form["status"])}>
              <option value="active">Active</option>
              <option value="paused">Paused — no sync, no reports</option>
            </Select>
          </Field>
          <Field label="Owner">
            <Select value={form.ownerId} onChange={(e) => set("ownerId", e.target.value)}>
              <option value="">Not assigned</option>
              {site.owner && !(o?.owners ?? []).some((x) => x.id === site.owner!.id) && <option value={site.owner.id}>{site.owner.name}</option>}
              {(o?.owners ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Links</div>
        <Field label="Search merchants, GBP listings and Ads accounts" hint="Filters the three lists below.">
          <span className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={site.name} className="pl-8" />
          </span>
        </Field>
        <Field label="Merchant">
          <Select value={form.merchantId} onChange={(e) => set("merchantId", e.target.value)}>
            <option value="">Not linked</option>
            {merchants.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Google Business Profile listing" hint="Feeds the Local pillar (profile completeness, calls, directions).">
          <Select value={form.gbpLocationId} onChange={(e) => set("gbpLocationId", e.target.value)}>
            <option value="">Not linked</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Google Ads account">
          <Select value={form.adsAccountId} onChange={(e) => set("adsAccountId", e.target.value)}>
            <option value="">Not linked</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="GA4 property" hint={ga4.length ? "Properties the connected Google account can read." : "Connect Google with Analytics access to list properties."}>
          <Select value={form.ga4Property} onChange={(e) => set("ga4Property", e.target.value)}>
            <option value="">Not linked</option>
            {ga4.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Search Console">
          <span className="text-sm text-foreground">
            {site.gscProperty ? (
              <span className="font-mono text-xs">{site.gscProperty}</span>
            ) : (
              <span className="text-muted-foreground">Not linked — add {site.domain} to Search Console under the connected Google account; the next sync links it.</span>
            )}
          </span>
        </Field>

        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Package & reports</div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Package" hint={meta.packages[form.package]?.reports}>
            <Select
              value={form.package}
              onChange={(e) => {
                const p = e.target.value as Package;
                setForm({ ...form, package: p, reportCadence: meta.packages[p]?.cadence ?? form.reportCadence });
              }}
            >
              {(Object.keys(PACKAGE) as Package[]).map((p) => (
                <option key={p} value={p}>
                  {meta.packages[p]?.label ?? PACKAGE[p].label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Segment">
            <Select value={form.segment} onChange={(e) => set("segment", e.target.value)}>
              {!meta.segments.includes(form.segment) && <option value={form.segment}>{form.segment}</option>}
              {meta.segments.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Report cadence">
          <Segmented label="Report cadence" value={form.reportCadence} onChange={(c) => set("reportCadence", c)} options={meta.cadences.map((c) => ({ value: c, label: CADENCE[c] }))} />
        </Field>
        <MerchantRecipients site={site} merchantChanged={form.merchantId !== (site.merchant?.id ?? "")} />
        <Field
          label="Extra recipients (typed by hand)"
          hint="Added to the merchant's contacts above — e.g. a second inbox, or a site with no merchant linked. Up to 10, comma-separated."
          error={badEmails.length ? `Not an email address: ${badEmails.join(", ")}` : undefined}
        >
          <Textarea value={form.recipients} onChange={(e) => set("recipients", e.target.value)} rows={2} placeholder="manager@restaurant.com" />
        </Field>
      </fieldset>
      <Dialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        tone="danger"
        title={`Remove ${site.domain}?`}
        description="Its scores, findings, keywords and reports are deleted. Add it again any time."
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              loading={del.isPending}
              onClick={() =>
                del.mutate(site.id, {
                  onSuccess: () => {
                    setConfirmDelete(false);
                    onClose();
                    toast({ variant: "success", title: `${site.domain} removed` });
                  },
                  onError: (e) => toast({ variant: "error", title: "Couldn't remove", description: e.messages?.[0] ?? e.message }),
                })
              }
            >
              Remove
            </Button>
          </>
        }
      />
    </Dialog>
  );
}

function AddSiteDialog({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: (id: string) => void }) {
  const add = useAddSite();
  const { toast } = useToast();
  const [domain, setDomain] = useState("");
  const [name, setName] = useState("");
  const close = () => {
    setDomain("");
    setName("");
    onClose();
  };
  return (
    <Dialog
      open={open}
      onClose={close}
      title="Add a site by hand"
      description="For a site that isn't in Search Console yet. Pages are still checked, and PageSpeed and rank checks run if their keys are set."
      footer={
        <>
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button
            disabled={domain.trim().length < 3}
            loading={add.isPending}
            onClick={() =>
              add.mutate(
                { domain: domain.trim(), name: name.trim() || undefined },
                {
                  onSuccess: (r) => {
                    toast({ variant: "success", title: "Site added", description: "The next refresh checks its pages." });
                    close();
                    onAdded(r.id);
                  },
                  onError: (e) => toast({ variant: "error", title: "Couldn't add", description: e.messages?.[0] ?? e.message }),
                },
              )
            }
          >
            Add site
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Domain" required hint="e.g. primocafe.com">
          <Input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="primocafe.com" autoFocus />
        </Field>
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Primo Cafe" />
        </Field>
      </div>
    </Dialog>
  );
}

/** Report recipients that come from the linked merchant's contacts (Owner / Marketing roles with an email). */
function MerchantRecipients({ site, merchantChanged }: { site: SiteSettingsRow; merchantChanged: boolean }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-foreground">Recipients from the merchant (automatic)</span>
      {merchantChanged ? (
        <p className="text-xs text-muted-foreground">Save to load the contacts of the newly selected merchant.</p>
      ) : !site.merchant ? (
        <p className="text-xs text-muted-foreground">No merchant linked. Link one above and its Owner and Marketing contacts receive the report automatically.</p>
      ) : site.merchantRecipients.length === 0 ? (
        <p className="text-xs text-warning-text">
          {site.merchant.name ?? "This merchant"} has no Owner or Marketing contact with an email.{" "}
          <Link href={`/merchants/${site.merchant.id}/contacts`} className="font-medium text-primary hover:underline">
            Add one on the merchant
          </Link>
          , or type addresses below.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {site.merchantRecipients.map((c) => (
            <li key={c.email} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-1 text-xs">
              <span className="text-foreground">{c.name ? `${c.name} · ` : ""}{c.email}</span>
              <Badge tone="neutral" icon={false}>
                {c.role}
              </Badge>
            </li>
          ))}
        </ul>
      )}
      {site.merchant && !merchantChanged && (
        <p className="text-xs text-muted-foreground">
          Managed in{" "}
          <Link href={`/merchants/${site.merchant.id}/contacts`} className="font-medium text-primary hover:underline">
            {site.merchant.name ?? "the merchant"} → Contacts
          </Link>
          {" "}— changes there apply to the next report.
        </p>
      )}
    </div>
  );
}
