"""
Port of src/common/auth/capabilities.ts verbatim. The permission matrix —
Central Marketing PRD §17.1. Every route declares a capability, never a role
list directly; this table is the only place a role is granted anything.
SUPER_ADMIN is not listed: it passes every capability unconditionally.
"""
from __future__ import annotations

from typing import Iterable, Literal

from app.models.enums import Role

Capability = Literal[
    "profile.view",
    "profile.edit",
    "merchant.create",
    "merchant.delete",
    "subscription.write",
    "accountManager.assign",
    "accountManager.manage",
    "users.manage",
    "audit.view",
    # Website intake (ported from the standalone website-api service). Not in
    # the NestJS original's capabilities.ts — that service had no auth at all.
    # Added here rather than reusing profile.* so website access can be granted
    # or revoked without touching merchant profiling.
    "website.view",
    "website.edit",
    "website.delete",
    # Making a site public (Live / Update required) or taking it down
    # (Inactive). Super App PRD §17: shown disabled with "Requires Website
    # publish permission — contact Admin" for roles without it.
    "website.publish",
    # Partner leads — applications from partners.innowi.com (ISOs, agents,
    # resellers who want to sell Innowi). The data lives in the partner
    # portal's public.partner_* tables; see modules/partner_leads.
    "partners.view",
    "partners.edit",
    # Permanently delete a partner lead (its notes and history go with it).
    "partners.delete",
    # Sales module (Salesforce data copied into the `salesforce` schema).
    # sales.view    - open the Sales screens; without sales.viewAll a user sees
    #                 only the Salesforce records their linked Salesforce user owns.
    # sales.viewAll - see every salesperson's records and the Team screen.
    # sales.manage  - run the sync, see its status, link logins to Salesforce users.
    "sales.view",
    "sales.viewAll",
    "sales.manage",
    "quotes.view",
    "quotes.edit",
    "quotes.discount",
    "quotes.pricing",
    # The home-screen AI assistant. Everyone may use it; what it can look up is
    # still limited by the person's other capabilities (see modules/assistant).
    "assistant.use",
    # Roadmap: everyone signed in reads it; admins plan it (phases, items, owners).
    # The owner of an item can also update its status, notes and target date.
    "roadmap.view",
    "roadmap.manage",
    # Ops CRM tickets. Every staff member can see tickets, comment, and work
    # the ones assigned to them (status, sub-tasks).
    "ticket.view",
    # Create, edit, reassign and delete any ticket. Held by NO role: it is
    # granted to individual people (auth.user.granted_capabilities) — for now
    # only Aima and Maheen. See USER_GRANTABLE below.
    "ticket.manage",
    # Ops CRM Meetings (Fathom recordings, summaries, transcripts): marketing
    # staff only — the sales roles see tickets, not the call transcripts.
    "meetings.view",
    # Ops CRM Library: read and write pages (a team wiki); deleting a page
    # stops at managers.
    "library.view",
    "library.edit",
    "library.delete",
    # Credentials vault: everyone sees *which* logins exist; revealing a
    # secret (always logged) and adding/changing them stops at managers.
    # credentials.reveal can also be granted to one person.
    "credentials.view",
    "credentials.reveal",
    "credentials.manage",
    # Workspace-wide Settings: workspace details, SLA targets, projects.
    # Personal settings (profile, password, notifications) need nothing.
    "settings.manage",
    # Google Business Profile reporting: everyone on staff reads the reports
    # and writes reporting notes; connecting the Google account, running a
    # sync and linking listings to merchants stops at managers.
    "gbp.view",
    "gbp.manage",
    # Google Ads reporting (modules/ads): every staff member reads the reports
    # and writes Analysis / Future Actions comments; managers connect Google,
    # run a sync, link accounts to merchants, edit ticket-size inputs, archive.
    "ads.view",
    "ads.manage",
    # SEO (modules/seo): every staff member reads the SEO pages and works
    # findings; managers connect Google, run a sync, change site settings,
    # tracked keywords and KPI targets; signing off and sending client
    # reports is seo.approve (managers, or granted to one person — the SEO lead).
    "seo.view",
    "seo.manage",
    "seo.approve",
    # Churned accounts (the win-back list). Everyone sees it; the sales roles
    # and managers work it; importing a churn workbook creates merchants, so it
    # stops at managers.
    "churn.view",
    "churn.manage",
    "churn.import",
    # The spine: organizations (ISOs, agents, resellers, contractors) and
    # deals (one attempt to put Innowi into one restaurant). Everyone sees
    # them; the sales roles and the marketing manager work them.
    "organizations.view",
    "organizations.manage",
    # Hand partners / an ISO's agents to salespeople (one at a time or in bulk).
    "organizations.assign",
    "deals.view",
    "deals.manage",
    # Requests (modules/requests): everyone submits ideas, bugs and complaints,
    # sees everyone's and upvotes; triage (review, approve onto the roadmap,
    # decline, ask for info) is held by NO role — Super Admins pass it, and it
    # is granted to individual people (Shayan, 2026-10-24: Shayan + Muhammad).
    "requests.view",
    "requests.create",
    "requests.triage",
    # Merchant Reports (modules/report_gen): every staff member opens the queue and
    # generates / edits drafts; approving and sending is report_gen.approve
    # (managers, or granted to one person). The generator of a version can never
    # approve that version (checked per report in the service).
    "report_gen.view",
    "report_gen.manage",
    "report_gen.approve",
]

# Access levels (Shayan, 2026-10-12):
#   Admin               — sees and edits everything; manages team members.
#   Marketing Manager   — sees everything (incl. partner leads, read-only); keeps marketing edit rights.
#   Marketing Executive — marketing only; no sales (partner leads hidden).
#   Sales Executive     — partner leads (view + manage) and future sales tools; no marketing.
#                         In the Sales (Salesforce) screens: only their own Salesforce records.
#   Sales Manager       — what a Sales Executive has, but every salesperson's Salesforce records.
STAFF: tuple[Role, ...] = (Role.ADMIN, Role.MARKETING_MANAGER, Role.MARKETING_EXECUTIVE)
SALES_VIEW: tuple[Role, ...] = (Role.ADMIN, Role.MARKETING_MANAGER, Role.SALES_MANAGER, Role.SALES_EXECUTIVE)
SALES_EDIT: tuple[Role, ...] = (Role.ADMIN, Role.SALES_MANAGER, Role.SALES_EXECUTIVE)
# "Sees everything" roles: every salesperson's Salesforce records, read-only.
SALES_SEE_ALL: tuple[Role, ...] = (Role.ADMIN, Role.MARKETING_MANAGER, Role.SALES_MANAGER)
MANAGERS: tuple[Role, ...] = (Role.ADMIN, Role.MARKETING_MANAGER)
ADMINS: tuple[Role, ...] = (Role.ADMIN,)
EVERYONE: tuple[Role, ...] = (Role.ADMIN, Role.MARKETING_MANAGER, Role.MARKETING_EXECUTIVE,
                              Role.SALES_MANAGER, Role.SALES_EXECUTIVE)

CAPABILITIES: dict[Capability, tuple[Role, ...]] = {
    "profile.view": STAFF,
    "profile.edit": STAFF,
    "merchant.create": MANAGERS,
    "merchant.delete": ADMINS,
    "subscription.write": MANAGERS,
    "accountManager.assign": MANAGERS,
    "accountManager.manage": MANAGERS,
    "users.manage": ADMINS,
    # Marketing Manager "sees everything" — includes reading the audit log.
    "audit.view": MANAGERS,
    "website.view": STAFF,
    "website.edit": STAFF,
    # Deleting a website takes its public URL offline, so it stops at manager.
    "website.delete": MANAGERS,
    "website.publish": MANAGERS,
    "partners.view": SALES_VIEW,
    # Status, owner and notes on a partner lead.
    "partners.edit": SALES_EDIT,
    "partners.delete": ADMINS,
    # Salesforce data: an Executive sees their own records, managers see everyone's.
    "sales.view": SALES_VIEW,
    "sales.viewAll": SALES_SEE_ALL,
    "sales.manage": ADMINS,
    # Quote builder: see quotes, send quote links, give special pricing, edit the price list.
    "quotes.view": SALES_VIEW,
    "quotes.edit": SALES_VIEW,
    "quotes.discount": (Role.ADMIN, Role.MARKETING_MANAGER, Role.SALES_MANAGER),
    "quotes.pricing": ADMINS,
    "assistant.use": (Role.ADMIN, Role.MARKETING_MANAGER, Role.MARKETING_EXECUTIVE, Role.SALES_MANAGER,
                      Role.SALES_EXECUTIVE),
    "roadmap.view": EVERYONE,
    "roadmap.manage": ADMINS,
    # Ops CRM (Shayan, 2026-10-19): the sales roles also see tickets and the
    # Library, but never the credentials vault.
    "ticket.view": EVERYONE,
    "ticket.manage": (),
    "meetings.view": STAFF,
    "library.view": EVERYONE,
    "library.edit": STAFF,
    "library.delete": MANAGERS,
    "credentials.view": STAFF,
    "credentials.reveal": MANAGERS,
    "credentials.manage": MANAGERS,
    "settings.manage": ADMINS,
    "gbp.view": STAFF,
    "gbp.manage": MANAGERS,
    "ads.view": STAFF,
    "ads.manage": MANAGERS,
    "seo.view": STAFF,
    "seo.manage": MANAGERS,
    "seo.approve": MANAGERS,
    "churn.view": EVERYONE,
    "churn.manage": SALES_VIEW,
    "churn.import": (Role.ADMIN, Role.MARKETING_MANAGER, Role.SALES_MANAGER),
    "organizations.view": EVERYONE,
    "organizations.manage": SALES_VIEW,
    "organizations.assign": (Role.ADMIN, Role.SALES_MANAGER),
    "deals.view": EVERYONE,
    "deals.manage": SALES_VIEW,
    "requests.view": EVERYONE,
    "requests.create": EVERYONE,
    "requests.triage": (),
    "report_gen.view": STAFF,
    "report_gen.manage": STAFF,
    "report_gen.approve": MANAGERS,
}

# Capabilities that can be granted to one person on top of their role, via
# auth.user.granted_capabilities (scripts/grant_capability.py, or PATCH
# /users/:id with `grantedCapabilities`). Anything else in that column is
# ignored, so a stray value can never widen access.
USER_GRANTABLE: frozenset[str] = frozenset({"ticket.manage", "credentials.reveal", "seo.approve", "requests.triage",
                                            "organizations.assign", "report_gen.approve"})

# Grants that never apply to some roles, whatever is stored for the person
# (Shayan, 2026-10-19: the sales roles never get into the credentials vault).
GRANT_BLOCKED: dict[str, frozenset[str]] = {
    "credentials.reveal": frozenset({Role.SALES_MANAGER.value, Role.SALES_EXECUTIVE.value}),
}


def has_capability(
    role: str | Role | None,
    capability: Capability,
    grants: Iterable[str] | None = None,
) -> bool:
    """True when `role` holds `capability`, or it was granted to this person
    (`grants`, from auth.user.granted_capabilities). SUPER_ADMIN holds
    everything. A user with no role holds nothing, grants included."""
    if not role:
        return False
    role_value = role.value if isinstance(role, Role) else role
    if role_value == Role.SUPER_ADMIN.value:
        return True
    allowed = {r.value for r in CAPABILITIES[capability]}
    if role_value in allowed:
        return True
    if role_value in GRANT_BLOCKED.get(capability, ()):
        return False
    return capability in USER_GRANTABLE and capability in set(grants or ())


def capability_roles(capability: Capability) -> tuple[Role, ...]:
    return CAPABILITIES[capability]
