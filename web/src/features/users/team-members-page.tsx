"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, MailPlus, ShieldAlert, Users } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
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
  useToast,
} from "@/components/ui";
import { useAuth } from "@/features/auth/auth-context";
import { CAPABILITIES, hasCapability, type Capability } from "@/features/auth/capabilities";
import { GRANTABLE } from "@/features/settings/types";
import { ROLE_LABELS, type Role } from "@/features/auth/types";
import {
  invitations,
  users,
  type AppUser,
  type Invitation,
  type InvitableRole,
  type InvitationCreated,
} from "@/lib/api/resources/users";
import type { ApiError, PagedEnvelope } from "@/lib/api/client";
import { formatDateTime } from "@/lib/format";
import { usePartnerTeam, useUpdatePartnerTeamMember } from "@/features/partners/queries";
import type { PartnerTeamMember } from "@/features/partners/types";

const USERS_KEY = ["users", "list"] as const;
const INVITES_KEY = ["invitations", "list"] as const;

/** Order shown in every role picker — least access first. */
export const ASSIGNABLE_ROLES: InvitableRole[] = ["MARKETING_EXECUTIVE", "SALES_EXECUTIVE", "SALES_MANAGER", "MARKETING_MANAGER", "ADMIN"];

/** One line per role, shown under the picker so the admin knows what they're granting. */
export const ROLE_HELP: Record<InvitableRole, string> = {
  ADMIN: "Sees and edits everything, manages team members.",
  MARKETING_MANAGER: "Sees everything. Edits marketing; partner leads are read-only.",
  MARKETING_EXECUTIVE: "Marketing only — no partner leads or other sales screens.",
  SALES_EXECUTIVE: "Sales only: partner leads, plus their own Salesforce deals, visits and restaurants.",
  SALES_MANAGER: "Sales only, like a Sales Executive, but sees every salesperson's Salesforce records.",
};

/**
 * Team members (route: /team-members) — who can sign in to the Super App.
 * Admin / Super Admin only (capability users.manage; the API enforces it).
 *
 * New people are invited by e-mail: the admin enters the address and a role,
 * the API e-mails a one-time link (/invite?token=…), and the person picks
 * their own password there. The link is also shown here once so it can be
 * sent by hand if the e-mail doesn't arrive.
 */
export function TeamMembersPage() {
  const { user } = useAuth();
  const isAdmin = hasCapability(user?.role, "users.manage");
  const qc = useQueryClient();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InvitableRole>("MARKETING_EXECUTIVE");
  const [lastLink, setLastLink] = useState<InvitationCreated | null>(null);

  const list = useQuery<PagedEnvelope<AppUser>, ApiError>({ queryKey: USERS_KEY, queryFn: () => users.list(), enabled: isAdmin });
  const pending = useQuery<Invitation[], ApiError>({ queryKey: INVITES_KEY, queryFn: () => invitations.list(), enabled: isAdmin });
  // Partner team: built from these people (sales roles + admins, signed up or invited).
  const team = usePartnerTeam({ enabled: isAdmin, staleTime: 0 });
  const teamByEmail = new Map((team.data ?? []).map((m) => [m.email.toLowerCase(), m]));
  const leadsCell = (email: string) =>
    team.isError ? (
      <span className="text-xs text-text-destructive">Couldn&apos;t load</span>
    ) : (
      <LeadSwitches member={teamByEmail.get(email.toLowerCase())} loading={team.isPending} />
    );
  const nobodyGetsLeads = team.isSuccess && !(team.data ?? []).some((m) => m.receivesNewLeads);

  const onInvited = (r: InvitationCreated) => {
    void qc.invalidateQueries({ queryKey: INVITES_KEY });
    void team.refetch(); // an invited sales person is on the partner team straight away
    setLastLink(r);
    toast({
      variant: "success",
      title: r.emailed ? "Invitation sent" : "Invitation created",
      description: r.emailed
        ? `We e-mailed ${r.invitation.email} a link to set their password.`
        : `The e-mail couldn't be sent right now — copy the link below and send it to ${r.invitation.email} yourself.`,
    });
  };
  const errToast = (title: string) => (err: ApiError) => toast({ variant: "error", title, description: err.messages.join(" · ") });

  const create = useMutation<InvitationCreated, ApiError, { email: string; role: InvitableRole }>({
    mutationFn: (v) => invitations.create(v.email, v.role),
    onSuccess: (r) => {
      setEmail("");
      onInvited(r);
    },
    onError: errToast("Couldn't send the invitation"),
  });
  const resend = useMutation<InvitationCreated, ApiError, string>({
    mutationFn: (id) => invitations.resend(id),
    onSuccess: onInvited,
    onError: errToast("Couldn't re-send"),
  });
  const revoke = useMutation<void, ApiError, string>({
    mutationFn: (id) => invitations.revoke(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: INVITES_KEY });
      void team.refetch();
      setLastLink(null);
      toast({ variant: "success", title: "Invitation cancelled", description: "That link no longer works." });
    },
    onError: errToast("Couldn't cancel"),
  });
  const update = useMutation<AppUser, ApiError, { id: string; role?: Role; status?: AppUser["status"]; grantedCapabilities?: string[] }>({
    mutationFn: ({ id, ...input }) => users.update(id, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: USERS_KEY });
      // A role or on/off change can add someone to the partner team or take them off it.
      void team.refetch();
    },
    onError: errToast("Couldn't save"),
  });

  if (user === undefined) return null;
  if (!isAdmin) {
    return (
      <Card>
        <EmptyState icon={ShieldAlert} title="Admins only" description="Ask an Admin to add or change team members." />
      </Card>
    );
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    create.mutate({ email: email.trim(), role });
  };
  const rows = list.data?.data ?? [];
  const invites = pending.data ?? [];

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-[-0.011em] text-foreground">Team members</h1>
        <p className="mt-1 text-table text-muted-foreground">
          Who can sign in to the Super App. Invite someone by e-mail — they choose their own password.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Partner leads:</span> Sales Managers and Sales Executives can be given leads
          automatically (admins too, if you switch it on), as soon as they&apos;re invited. &ldquo;New-lead e-mails&rdquo; sends each new
          application to that person with one-click &ldquo;Assign to …&rdquo; buttons.
        </p>
        {nobodyGetsLeads ? (
          <p className="mt-2 rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-xs text-warning-text" data-testid="no-lead-emails">
            Nobody gets the new-lead e-mails right now, so new partner applications won&apos;t be e-mailed to anyone (the
            Teams post still goes out). Turn &ldquo;New-lead e-mails&rdquo; on for at least one person below.
          </p>
        ) : null}
      </div>

      <Card>
        <form onSubmit={submit} className="flex flex-col gap-3 p-4">
          <p className="text-sm font-semibold text-foreground">Invite someone</p>
          <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr_auto] sm:items-end">
            <Field label="Email" htmlFor="inv-email" required>
              <Input id="inv-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@innowi.com" />
            </Field>
            <Field label="Role" htmlFor="inv-role">
              <Select id="inv-role" value={role} onChange={(e) => setRole(e.target.value as InvitableRole)}>
                {ASSIGNABLE_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </Select>
            </Field>
            <Button type="submit" variant="default" loading={create.isPending}>
              <MailPlus /> Send invite
            </Button>
          </div>
          <p className="text-xs text-muted-foreground" data-testid="role-help">
            <span className="font-medium text-foreground">{ROLE_LABELS[role]}:</span> {ROLE_HELP[role]}
          </p>
          {lastLink ? <InviteLink created={lastLink} /> : null}
        </form>
      </Card>

      {invites.length > 0 || pending.isError ? (
        <Card>
          <div className="px-4 pt-4 text-sm font-semibold text-foreground">Pending invitations</div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Sent</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Partner leads</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pending.isError ? (
                <TableMessageRow colSpan={6}>
                  <ErrorState title="Couldn't load invitations" error={pending.error} onRetry={() => pending.refetch()} />
                </TableMessageRow>
              ) : (
                invites.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell>
                      <div className="font-medium text-foreground">{inv.email}</div>
                      {inv.invitedBy ? <div className="text-xs text-muted-foreground">by {inv.invitedBy}</div> : null}
                    </TableCell>
                    <TableCell>{ROLE_LABELS[inv.role] ?? inv.role}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {inv.emailedAt ? formatDateTime(inv.emailedAt) : <Badge tone="neutral">Not e-mailed</Badge>}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{formatDateTime(inv.expiresAt)}</TableCell>
                    <TableCell>{leadsCell(inv.email)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="xs" variant="ghost" disabled={resend.isPending || revoke.isPending} onClick={() => resend.mutate(inv.id)}>
                          Re-send
                        </Button>
                        <Button size="xs" variant="ghost" disabled={resend.isPending || revoke.isPending} onClick={() => revoke.mutate(inv.id)}>
                          Cancel
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      ) : null}

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Person</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>
                <span title="Extra access for one person, on top of their role">Extra access</span>
              </TableHead>
              <TableHead>Last sign-in</TableHead>
              <TableHead>Partner leads</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.isError ? (
              <TableMessageRow colSpan={6}>
                <ErrorState title="Couldn't load team members" error={list.error} onRetry={() => list.refetch()} />
              </TableMessageRow>
            ) : list.isPending ? (
              Array.from({ length: 3 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 6 }).map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-3.5 w-24" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : rows.length === 0 ? (
              <TableMessageRow colSpan={6}>
                <EmptyState icon={Users} title="No team members yet" />
              </TableMessageRow>
            ) : (
              rows.map((u) => {
                const self = u.id === user?.id;
                const locked = self || u.role === "SUPER_ADMIN";
                return (
                  <TableRow key={u.id}>
                    <TableCell>
                      <div className="font-medium text-foreground">{[u.firstName, u.lastName].filter(Boolean).join(" ") || u.email}</div>
                      <div className="text-xs text-muted-foreground">
                        {u.email}
                        {self ? " · you" : ""}
                      </div>
                    </TableCell>
                    <TableCell>
                      {locked ? (
                        <span className="text-foreground">{ROLE_LABELS[u.role]}</span>
                      ) : (
                        <Select
                          value={u.role}
                          aria-label={`Role for ${u.email}`}
                          disabled={update.isPending}
                          onChange={(e) => update.mutate({ id: u.id, role: e.target.value as Role })}
                          className="w-[190px]"
                        >
                          {ASSIGNABLE_ROLES.map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABELS[r]}
                            </option>
                          ))}
                        </Select>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Badge tone={u.status === "ACTIVE" ? "success" : "neutral"}>{u.status === "ACTIVE" ? "Active" : "Turned off"}</Badge>
                        {!locked ? (
                          <Button
                            size="xs"
                            variant="ghost"
                            disabled={update.isPending}
                            onClick={() => update.mutate({ id: u.id, status: u.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" })}
                          >
                            {u.status === "ACTIVE" ? "Turn off" : "Turn on"}
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      <ExtraAccess
                        user={u}
                        locked={locked}
                        busy={update.isPending}
                        onChange={(grantedCapabilities) => update.mutate({ id: u.id, grantedCapabilities })}
                      />
                    </TableCell>
                    <TableCell className="text-muted-foreground">{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : "Never"}</TableCell>
                    <TableCell>{leadsCell(u.email)}</TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

const SALES_ROLES: Role[] = ["SALES_MANAGER", "SALES_EXECUTIVE"];

/**
 * Per-person extra access (ticket manager, reveal vault logins, SEO sign-off).
 * "With role" when the role already includes it; the vault is never offered
 * to the sales roles (the API ignores such a grant too).
 */
function ExtraAccess({
  user,
  locked,
  busy,
  onChange,
}: {
  user: AppUser;
  locked: boolean;
  busy: boolean;
  onChange: (granted: string[]) => void;
}) {
  const granted = user.grantedCapabilities ?? [];
  const items = GRANTABLE.filter((g) => !(g.key === "credentials.reveal" && SALES_ROLES.includes(user.role)));
  if (items.length === 0) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <div className="flex flex-col gap-1">
      {items.map((g) => {
        const viaRole = user.role === "SUPER_ADMIN" || CAPABILITIES[g.key as Capability]?.includes(user.role);
        const on = granted.includes(g.key);
        return (
          <label key={g.key} className="flex items-center gap-1.5 text-xs text-foreground" title={g.hint}>
            {viaRole ? (
              <span className="text-muted-foreground">
                {g.short}: <span className="italic">with role</span>
              </span>
            ) : (
              <>
                <input
                  type="checkbox"
                  className="size-3.5 accent-[var(--color-primary)]"
                  aria-label={`${g.label} for ${user.email}`}
                  checked={on}
                  disabled={locked || busy}
                  onChange={() => onChange(on ? granted.filter((c) => c !== g.key) : [...granted, g.key])}
                />
                {g.short}
              </>
            )}
          </label>
        );
      })}
    </div>
  );
}

/** The freshly issued link — shown once (only a hash is stored server-side). */
function InviteLink({ created }: { created: InvitationCreated }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(created.inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — the text is selectable */
    }
  };
  return (
    <div className="rounded-lg border border-border bg-muted/40 p-3" data-testid="invite-link">
      <p className="text-xs text-muted-foreground">
        {created.emailed ? "E-mailed to " : "Not e-mailed — send this link to "}
        <span className="font-medium text-foreground">{created.invitation.email}</span>
        {created.emailed ? ". You can also share the link yourself:" : " yourself:"}
      </p>
      <div className="mt-2 flex items-center gap-2">
        <Input readOnly value={created.inviteUrl} onFocus={(e) => e.currentTarget.select()} aria-label="Invitation link" className="font-mono text-xs" />
        <Button type="button" size="sm" variant="outline" onClick={copy}>
          {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">Works once, expires in 7 days. It won&apos;t be shown again — use Re-send for a new one.</p>
    </div>
  );
}

/**
 * The two partner-lead switches for one person. Shown only for people who can work
 * leads (sales roles and admins, signed up or invited); everyone else gets a dash.
 */
function LeadSwitches({ member, loading }: { member: PartnerTeamMember | undefined; loading: boolean }) {
  const { toast } = useToast();
  const save = useUpdatePartnerTeamMember();
  if (loading) return <Skeleton className="h-3.5 w-24" />;
  if (!member || (member.status !== "active" && member.status !== "invited")) {
    return <span className="text-xs text-muted-foreground" title="This role doesn't work partner leads">—</span>;
  }
  const set = (input: { assignable?: boolean; receivesNewLeads?: boolean }, done: string) =>
    save.mutate(
      { email: member.email, input },
      {
        onSuccess: () => toast({ variant: "success", title: done }),
        onError: (err) => toast({ variant: "error", title: "Couldn't save", description: err.messages.join(" · ") }),
      },
    );
  const who = member.name || member.email;
  return (
    <div className="flex flex-col gap-1 text-xs">
      <label className="inline-flex cursor-pointer items-center gap-1.5 text-foreground">
        <input
          type="checkbox"
          className="size-3.5 accent-primary"
          checked={member.assignable}
          disabled={save.isPending}
          aria-label={`${who} can be given partner leads`}
          onChange={(e) => set({ assignable: e.target.checked }, e.target.checked ? `${who} can now be given leads` : `${who} won't be offered leads`)}
        />
        Can be given leads
      </label>
      <label className="inline-flex cursor-pointer items-center gap-1.5 text-foreground">
        <input
          type="checkbox"
          className="size-3.5 accent-primary"
          checked={member.receivesNewLeads}
          disabled={save.isPending}
          aria-label={`${who} gets the new-lead e-mails`}
          onChange={(e) =>
            set({ receivesNewLeads: e.target.checked }, e.target.checked ? `${who} will get new-lead e-mails` : `${who} won't get new-lead e-mails`)
          }
        />
        New-lead e-mails
      </label>
    </div>
  );
}
